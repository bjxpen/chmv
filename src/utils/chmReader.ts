import SevenZip, { SevenZipModule } from '7z-wasm';

export interface ChmFileEntry {
  path: string;
  size: number;
}

export class ChmReader {
  private static instancePromise: Promise<SevenZipModule> | null = null;
  private module: SevenZipModule | null = null;
  private currentFiles: ChmFileEntry[] = [];
  private currentHash: string = '';

  static getModule(): Promise<SevenZipModule> {
    if (!this.instancePromise) {
      // Configure print/printErr to prevent dumping trash in console during extraction
      this.instancePromise = SevenZip({
        locateFile: (filename: string) => {
          return `/${filename}`;
        },
        print: () => {},
        printErr: () => {}
      });
    }
    return this.instancePromise;
  }

  async initialize(): Promise<void> {
    if (!this.module) {
      this.module = await ChmReader.getModule();
    }
  }

  /**
   * Unpack the CHM file array buffer in memory.
   */
  async loadArchive(buffer: ArrayBuffer, filename: string): Promise<ChmFileEntry[]> {
    await this.initialize();
    if (!this.module) {
      throw new Error('7z-wasm module not loaded');
    }

    const m = this.module;
    const fs = m.FS;

    // 1. Clean up old input/output to save memory
    this.cleanupFS();

    // Generate a file hash to track reading progress
    this.currentHash = await this.calculateHash(buffer, filename);

    // 2. Write input archive to virtual FS
    const uint8 = new Uint8Array(buffer);
    fs.writeFile('/input.chm', uint8);

    // Create target extraction directory
    try {
      fs.mkdir('/extracted');
    } catch (e) {
      // already exists or error, handle gracefully
    }

    // 3. Extract the file using 7zz with full paths
    try {
      m.callMain(['x', '/input.chm', '-o/extracted', '-y']);
    } catch (e) {
      // 7z callMain can throw an ExitStatus on success (exit code 0).
      // We can inspect if the output exists to see if it succeeded.
    }

    // 4. Verify extraction by walking `/extracted`
    this.currentFiles = [];
    try {
      this.walkFS('/extracted', '/extracted');
    } catch (err) {
      console.error('Error walking extracted CHM files:', err);
    }

    return this.currentFiles;
  }

  private walkFS(dirPath: string, rootDir: string): void {
    const fs = this.module!.FS;
    const files = fs.readdir(dirPath);
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      const fullPath = dirPath + '/' + file;
      const stat = fs.stat(fullPath);
      if (fs.isDir(stat.mode)) {
        this.walkFS(fullPath, rootDir);
      } else {
        // Strip the rootDir + 1 (the trailing slash) to get a relative path
        const relPath = fullPath.substring(rootDir.length + 1);
        this.currentFiles.push({
          path: relPath,
          size: stat.size
        });
      }
    }
  }

  getFileList(): ChmFileEntry[] {
    return this.currentFiles;
  }

  getHash(): string {
    return this.currentHash;
  }

  /**
   * Read raw bytes for a relative file path.
   */
  getRawBytes(relPath: string): Uint8Array {
    if (!this.module) {
      throw new Error('Module not initialized');
    }
    const fs = this.module.FS;
    const normalized = relPath.startsWith('/') ? relPath : '/' + relPath;
    const fullPath = '/extracted' + normalized;
    return fs.readFile(fullPath);
  }

  /**
   * Helper to clean up memory
   */
  cleanupFS(): void {
    if (!this.module) return;
    const fs = this.module.FS;

    // Delete `/input.chm`
    try {
      fs.unlink('/input.chm');
    } catch (e) {}

    // Recursively delete `/extracted`
    try {
      this.deleteRecursive('/extracted');
    } catch (e) {}
  }

  private deleteRecursive(path: string): void {
    const fs = this.module!.FS;
    let stat;
    try {
      stat = fs.stat(path);
    } catch (e) {
      return; // does not exist
    }

    if (fs.isDir(stat.mode)) {
      const files = fs.readdir(path);
      for (const file of files) {
        if (file === '.' || file === '..') continue;
        this.deleteRecursive(path + '/' + file);
      }
      try {
        fs.rmdir(path);
      } catch (e) {}
    } else {
      try {
        fs.unlink(path);
      } catch (e) {}
    }
  }

  /**
   * Detect encoding of raw bytes, falling back to UTF-8 or active selection
   */
  detectEncoding(bytes: Uint8Array): string {
    // Decode first 2000 bytes as latin1 to inspect HTML content for charset
    const slice = bytes.subarray(0, Math.min(bytes.length, 2048));
    let latin1Text = '';
    for (let i = 0; i < slice.length; i++) {
      latin1Text += String.fromCharCode(slice[i]);
    }

    // Look for <meta charset="...">
    const charsetMatch = latin1Text.match(/<meta[^>]*charset=["']?([a-zA-Z0-9_-]+)/i);
    if (charsetMatch && charsetMatch[1]) {
      const parsed = charsetMatch[1].toLowerCase();
      if (this.isValidEncoding(parsed)) {
        return parsed;
      }
    }

    // Look for content-type meta tags: content="text/html; charset=..."
    const contentTypeMatch = latin1Text.match(/content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i);
    if (contentTypeMatch && contentTypeMatch[1]) {
      const parsed = contentTypeMatch[1].toLowerCase();
      if (this.isValidEncoding(parsed)) {
        return parsed;
      }
    }

    // Check if the file starts with UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return 'utf-8';
    }
    // UTF-16 LE BOM
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return 'utf-16le';
    }
    // UTF-16 BE BOM
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return 'utf-16be';
    }

    // Heuristics for CJK legacy encodings
    // If we detect CJK bytes (e.g. high-order bits), we could suggest GBK / Big5
    // But default fallback is utf-8 as required.
    return 'utf-8';
  }

  private isValidEncoding(encoding: string): boolean {
    try {
      new TextDecoder(encoding);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Decodes a document to string with a specified or detected encoding
   */
  decodeText(bytes: Uint8Array, encodingOverride?: string): string {
    const encoding = encodingOverride || this.detectEncoding(bytes);
    try {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(bytes);
    } catch (e) {
      // Fallback to utf-8 if encoding fails
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(bytes);
    }
  }

  private async calculateHash(buffer: ArrayBuffer, filename: string): Promise<string> {
    try {
      const crypto = window.crypto || (globalThis as any).crypto;
      if (crypto && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {
      // fallback if web crypto not available (e.g. in non-secure context or certain environments)
    }
    // simple string hash fallback
    let hash = 0;
    const str = filename + buffer.byteLength.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'simple-' + Math.abs(hash).toString(16);
  }
}
