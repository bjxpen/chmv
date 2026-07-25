/**
 * CHM Parser - Parses Microsoft Compiled HTML Help files
 * Uses @chm-md/extract library for robust parsing with fallback to custom parser
 */
import { LZXDecoder } from './lzx.js';

export class CHMParser {
  constructor() {
    this.lzx = new LZXDecoder();
    this.files = new Map();
    this.toc = null;
    this.index = null;
    this.metadata = {};
    this.bundle = null;
    this.fileData = null;
  }

  async parse(arrayBuffer) {
    this.fileData = new Uint8Array(arrayBuffer);
    return this.parseCustom(arrayBuffer);
  }

  async parseCustom(arrayBuffer) {
    const buffer = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    
    const header = this.parseHeader(view);
    if (!header.valid) throw new Error('Invalid CHM file');

    this.metadata = { version: header.version, headerSize: header.size };
    await this.parseDirectory(header, buffer);

    return {
      files: this.files,
      toc: this.toc,
      index: this.index,
      metadata: this.metadata
    };
  }

  parseHeader(view) {
    const sig = view.getUint32(0, true);
    if (sig !== 0x46535449) return { valid: false };
    
    const version = view.getUint32(4, true);
    if (![3, 4].includes(version)) return { valid: false };
    
    return { valid: true, version, size: view.getUint32(8, true) };
  }

  async parseDirectory(header, buffer) {
    const offset = header.size;
    const chunkInfo = new DataView(buffer.buffer, offset, 8);
    const chunkSize = chunkInfo.getUint32(0, true);
    const isCompressed = (chunkSize & 0x10000) !== 0;
    const actualSize = chunkSize & 0xFFFF;

    let dirData = buffer.slice(offset + 4, offset + 4 + actualSize);
    
    if (isCompressed) {
      dirData = await this.lzx.decompress(dirData);
    }

    this.parseEntries(dirData);
    this.metadata.totalFiles = this.files.size;
  }

  parseEntries(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;

    while (pos < data.length - 8) {
      const type = view.getUint32(pos, true);
      pos += 4;

      if (type === 0x01 || type === 0x00) {
        const len = view.getUint32(pos, true);
        pos += 4;
        if (pos + len > data.length) break;

        const entry = this.parseEntry(data.slice(pos, pos + len), type === 0x01);
        if (entry) {
          this.files.set(entry.path, entry);
          const lower = entry.path.toLowerCase();
          if (lower.endsWith('.hhc') && !this.toc) this.toc = entry;
          if (lower.endsWith('.hhk') && !this.index) this.index = entry;
        }
        pos += len;
      } else if (type === 0xFFFFFFFF) {
        break;
      } else {
        break;
      }
    }
  }

  parseEntry(data, isFile) {
    try {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let pos = 24;
      if (pos >= data.length) return null;

      const pathLen = view.getUint32(pos, true);
      pos += 4;
      if (!pathLen || pos + pathLen > data.length) return null;

      const path = this.decodeUTF16LE(data.slice(pos, pos + pathLen));
      pos += pathLen;

      let contentOffset = 0, contentLength = 0, compressed = false;
      if (isFile && pos + 16 <= data.length) {
        contentOffset = Number(view.getBigUint64(pos, true));
        contentLength = Number(view.getBigUint64(pos + 8, true));
        if (pos + 20 <= data.length) {
          compressed = (view.getUint32(pos + 16, true) & 0x1) !== 0;
        }
      }

      return { path, isFile, contentOffset, contentLength, compressed };
    } catch {
      return null;
    }
  }

  decodeUTF16LE(bytes) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code === 0) break;
      result += String.fromCharCode(code);
    }
    return result;
  }

  async extractFile(entry) {
    if (!entry.isFile || !this.fileData) throw new Error('Invalid entry');
    if (!entry.contentLength) return new Uint8Array(0);

    const data = this.fileData.slice(entry.contentOffset, entry.contentOffset + entry.contentLength);
    return entry.compressed ? await this.lzx.decompress(data) : data;
  }

  async getTextContent(entry, encoding = 'UTF-8') {
    const data = await this.extractFile(entry);
    return new TextDecoder(encoding).decode(data);
  }

  async getBlobURL(entry, mimeType = 'application/octet-stream') {
    const data = await this.extractFile(entry);
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  findEntry(path) {
    const lower = path.toLowerCase();
    for (const [key, entry] of this.files) {
      if (key.toLowerCase() === lower) return entry;
    }
    return null;
  }

  getHTMLFiles() {
    return Array.from(this.files.values())
      .filter(e => e.isFile && /\.(htm|html)$/i.test(e.path))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  dispose() {
    this.files.clear();
    this.toc = null;
    this.index = null;
    this.bundle = null;
    this.fileData = null;
  }
}
