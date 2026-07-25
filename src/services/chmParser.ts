/**
 * CHM Parser Service
 * Handles parsing of Microsoft Compiled HTML Help (.chm) files
 * Supports ITSS/PMGL format used by CHM archives
 */

import { decompressLZX } from './lzx';
import type { 
  CHMHeader, CHMDirectoryEntry, CHMFileEntry, 
  CHMTOCEntry, CHMIndexEntry, EncodingType, CHMIndexReference
} from '../types';

// CHM file signatures
const CHM_SIGNATURE = 'ITSF';
const CHM_DIR_SIGNATURE = 'ITSP';
const CHM_CONTENT_SIGNATURE = 'CONT';

// PMGL/PMGI directory block markers
const PMGL_SIGNATURE = 0x50; // 'P'
const PMGI_SIGNATURE = 0x51; // 'Q'

interface DirectoryHeader {
  signature: string;
  version: number;
  headerLength: number;
  unknown1: number;
  blockSize: number;
  unknown2: number;
  unknown3: number;
}

interface DirectoryBlock {
  header: DirectoryHeader;
  entries: Map<string, CHMDirectoryEntry>;
  nextBlock: number;
}

export class CHMParser {
  private data: ArrayBuffer;
  private view: DataView;
  private decoder: TextDecoder;
  private encoding: EncodingType = 'utf-8';
  
  constructor(data: ArrayBuffer) {
    this.data = data;
    this.view = new DataView(data);
    this.decoder = new TextDecoder('utf-8');
  }
  
  setEncoding(encoding: EncodingType): void {
    this.encoding = encoding;
    this.decoder = new TextDecoder(encoding === 'utf-8' ? 'utf-8' : encoding);
  }
  
  parseHeader(): CHMHeader {
    const signature = this.getString(0, 4);
    if (signature !== CHM_SIGNATURE) {
      throw new Error(`Invalid CHM signature: ${signature}`);
    }
    
    return {
      signature,
      version: this.view.getUint32(4, true),
      headerLength: this.view.getUint32(8, true),
      unknown1: this.view.getUint32(12, true),
      unknown2: this.view.getUint32(16, true),
      lastModified: Number(this.view.getBigUint64(20, true)),
      unknown3: this.view.getUint32(28, true),
      unknown4: this.view.getUint32(32, true)
    };
  }
  
  parseDirectory(): Map<string, CHMDirectoryEntry> {
    const header = this.parseHeader();
    const entries = new Map<string, CHMDirectoryEntry>();
    
    // Find ITSP (directory header) after main header
    const itspOffset = this.findSignature('ITSP', header.headerLength);
    
    if (itspOffset === -1) {
      return this.parseDirectoryAlternate(header.headerLength);
    }
    
    // Find PMGL blocks starting from ITSP offset
    let currentOffset = itspOffset;
    let pmglCount = 0;
    
    try {
      while (currentOffset < this.data.byteLength && pmglCount < 100) {
        const pmglOffset = this.findSignature('PMGL', currentOffset);
        if (pmglOffset === -1) break;
        
        // Try to decompress and parse the PMGL block
        const blockEntries = this.parsePMGLBlock(pmglOffset);
        blockEntries.forEach((entry, path) => entries.set(path, entry));
        
        pmglCount++;
        
        // Calculate next block offset
        const blockSize = 0x2000;
        const nextOffset = this.view.getUint32(pmglOffset + blockSize - 4, true);
        
        if (nextOffset === 0 || nextOffset >= this.data.byteLength || nextOffset <= pmglOffset) {
          break;
        }
        currentOffset = nextOffset;
      }
    } catch {
      return this.parseDirectoryAlternate(header.headerLength);
    }
    
    return entries;
  }
  
  private findSignature(sig: string, startOffset: number): number {
    const bytes = new TextEncoder().encode(sig);
    for (let i = startOffset; i < Math.min(startOffset + 0x10000, this.data.byteLength - bytes.length); i++) {
      let found = true;
      for (let j = 0; j < bytes.length; j++) {
        if (this.view.getUint8(i + j) !== bytes[j]) {
          found = false;
          break;
        }
      }
      if (found) return i;
    }
    return -1;
  }
  
  private parseDirectoryBlock(offset: number): Map<string, CHMDirectoryEntry> {
    const entries = new Map<string, CHMDirectoryEntry>();
    
    // Quick check for block type
    const quickRef = this.view.getUint8(offset);
    
    // Try PMGL format first
    if (quickRef === PMGL_SIGNATURE || quickRef === 0) {
      return this.parsePMGLBlock(offset);
    }
    
    return entries;
  }
  
  private parsePMGLBlock(offset: number): Map<string, CHMDirectoryEntry> {
    const entries = new Map<string, CHMDirectoryEntry>();
    
    try {
      // Read block header
      const blockHeader = this.getString(offset, 4);
      if (blockHeader !== 'PMGL') {
        return entries;
      }
      
      // PMGL entries are LZX compressed
      // Extract the compressed data (skip 12-byte header + 8-byte section marker)
      const compressedStart = offset + 12 + 8;
      const compressedSize = 0x2000 - 12 - 8;
      
      const compressedData = new Uint8Array(this.data, compressedStart, compressedSize);
      
      // Try to decompress
      let decompressedData: Uint8Array;
      try {
        decompressedData = decompressLZX(compressedData, 0x2000);
      } catch {
        // Decompression failed, try raw parsing
        decompressedData = compressedData;
      }
      
      // Parse decompressed entries
      // Format: name_len(1) + name + 0x00 + offset(4) + length(4)
      const dataView = new DataView(decompressedData.buffer);
      let pos = 0;
      let consecutiveSkips = 0;
      
      while (pos < decompressedData.length - 20 && consecutiveSkips < 20) {
        // Skip invalid entries
        if (decompressedData[pos] < 2 || decompressedData[pos] > 100) {
          pos++;
          consecutiveSkips++;
          continue;
        }
        consecutiveSkips = 0;
        
        // Read name length
        const nameLen = decompressedData[pos++];
        
        if (pos + nameLen > decompressedData.length) break;
        
        // Read name bytes
        const nameBytes = decompressedData.slice(pos, pos + nameLen);
        pos += nameLen;
        
        // Skip null byte
        if (decompressedData[pos] === 0) pos++;
        
        // Read offset
        if (pos + 4 > decompressedData.length) break;
        const fileOffset = dataView.getUint32(pos, true);
        pos += 4;
        
        // Read length
        if (pos + 4 > decompressedData.length) break;
        const fileLength = dataView.getUint32(pos, true);
        pos += 4;
        
        // Validate and add entry
        if (fileOffset > 0 && fileOffset < this.data.byteLength && 
            fileLength > 0 && fileLength < this.data.byteLength) {
          const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
          if (name && name.length > 0) {
            entries.set(name, {
              name,
              offset: fileOffset,
              length: fileLength,
              flags: 0
            });
          }
        }
      }
    } catch {
      // Parsing failed
    }
    
    return entries;
  }
  
  private parseDirectoryAlternate(offset: number): Map<string, CHMDirectoryEntry> {
    const entries = new Map<string, CHMDirectoryEntry>();
    
    // Try to find ITSP first
    const itspOffset = this.findSignature('ITSP', offset);
    if (itspOffset !== -1) {
      // Find and parse PMGL blocks
      let pos = itspOffset;
      for (let i = 0; i < 50; i++) {
        const pmglOffset = this.findSignature('PMGL', pos);
        if (pmglOffset === -1) break;
        
        const blockEntries = this.parsePMGLBlock(pmglOffset);
        blockEntries.forEach((entry, path) => entries.set(path, entry));
        
        pos = pmglOffset + 0x2000;
        if (entries.size > 0) break;
      }
      
      if (entries.size > 0) {
        return entries;
      }
    }
    
    // Last resort fallback: try to find any HTML-like content in the file
    // This handles CHMs with unusual formats or corrupted directories
    const searchPatterns = [
      '/start.htm',
      '/index.htm', 
      '/default.htm',
      '/default.html',
      '/index.html'
    ];
    
    // Search for common CHM entry paths
    for (const path of searchPatterns) {
      const pathBytes = new TextEncoder().encode(path);
      const pathPos = this.findBinary(pathBytes, offset);
      if (pathPos !== -1) {
        // Found a path reference, try to find its offset/length nearby
        const nearbyOffset = this.extractOffsetNear(pathPos + pathBytes.length);
        if (nearbyOffset && nearbyOffset > 0) {
          entries.set(path, {
            name: path,
            offset: nearbyOffset,
            length: 100000, // Estimated length
            flags: 0
          });
        }
      }
    }
    
    return entries;
  }
  
  private findBinary(pattern: Uint8Array, startOffset: number): number {
    for (let i = startOffset; i < this.data.byteLength - pattern.length; i++) {
      let found = true;
      for (let j = 0; j < pattern.length; j++) {
        if (this.view.getUint8(i + j) !== pattern[j]) {
          found = false;
          break;
        }
      }
      if (found) return i;
    }
    return -1;
  }
  
  private extractOffsetNear(pos: number): number {
    // Try to extract a valid offset from bytes near pos
    // Look for sequences that could be valid offsets
    for (let i = 0; i < 100; i++) {
      const offset = this.view.getUint32(pos + i, true);
      if (offset > 0 && offset < this.data.byteLength && offset > 1000) {
        // This looks like a valid offset
        return offset;
      }
    }
    return 0;
  }
  
  private decodeString(data: Uint8Array): string {
    try {
      // Try UTF-8 first
      const utf8Str = new TextDecoder('utf-8').decode(data);
      if (this.isValidUTF8(data)) {
        return utf8Str;
      }
    } catch {
      // Fall through
    }
    
    try {
      return this.decoder.decode(data);
    } catch {
      return '';
    }
  }
  
  private isValidUTF8(data: Uint8Array): boolean {
    let i = 0;
    while (i < data.length) {
      const byte = data[i];
      if (byte === 0) return false;
      
      if (byte <= 0x7F) {
        i++;
      } else if ((byte & 0xE0) === 0xC0) {
        if (i + 1 >= data.length || (data[i + 1] & 0xC0) !== 0x80) return false;
        i += 2;
      } else if ((byte & 0xF0) === 0xE0) {
        if (i + 2 >= data.length || (data[i + 1] & 0xC0) !== 0x80 || (data[i + 2] & 0xC0) !== 0x80) return false;
        i += 3;
      } else if ((byte & 0xF8) === 0xF0) {
        if (i + 3 >= data.length || (data[i + 1] & 0xC0) !== 0x80 || (data[i + 2] & 0xC0) !== 0x80 || (data[i + 3] & 0xC0) !== 0x80) return false;
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  }
  
  async getFileContent(entry: CHMDirectoryEntry): Promise<Uint8Array> {
    const { offset, length } = entry;
    
    if (offset >= this.data.byteLength) {
      throw new Error(`Invalid file offset: ${offset}`);
    }
    
    // Check if content is compressed
    const contentType = this.getContentType(offset);
    
    if (contentType === 'compressed') {
      // Need to decompress
      return this.decompressContent(offset, length);
    }
    
    // Uncompressed content
    return new Uint8Array(this.data, offset, length);
  }
  
  private getContentType(offset: number): 'compressed' | 'uncompressed' {
    if (offset + 4 > this.data.byteLength) return 'uncompressed';
    
    const marker = this.getString(offset, 4);
    return marker === CHM_CONTENT_SIGNATURE ? 'compressed' : 'uncompressed';
  }
  
  private decompressContent(offset: number, length: number): Uint8Array {
    if (offset + 8 > this.data.byteLength) {
      throw new Error('Invalid compressed content offset');
    }
    
    // Read compressed and uncompressed sizes
    const compressedSize = this.view.getUint32(offset + 4, true);
    const uncompressedSize = this.view.getUint32(offset + 8, true);
    
    // Read compressed data
    const compressedData = new Uint8Array(this.data, offset + 12, compressedSize);
    
    // Decompress
    try {
      return decompressLZX(compressedData, uncompressedSize);
    } catch {
      // If decompression fails, return raw data
      return compressedData;
    }
  }
  
  async getFile(path: string): Promise<CHMFileEntry | null> {
    const entries = this.parseDirectory();
    const entry = entries.get(path);
    
    if (!entry) {
      // Try alternate paths
      const alternates = [
        path.toLowerCase(),
        path.toUpperCase(),
        path.replace(/\\/g, '/'),
        path.replace(/\//g, '\\')
      ];
      
      for (const alt of alternates) {
        const altEntry = entries.get(alt);
        if (altEntry) {
          return this.loadFileEntry(alt, altEntry);
        }
      }
      return null;
    }
    
    return this.loadFileEntry(path, entry);
  }
  
  private async loadFileEntry(path: string, entry: CHMDirectoryEntry): Promise<CHMFileEntry> {
    const content = await this.getFileContent(entry);
    const contentType = this.getContentTypeFromPath(path);
    
    return {
      path,
      content,
      contentType
    };
  }
  
  private getContentTypeFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    
    const types: Record<string, string> = {
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'hhc': 'text/html',
      'hhk': 'text/html',
      'txt': 'text/plain'
    };
    
    return types[ext || ''] || 'application/octet-stream';
  }
  
  getString(offset: number, length: number): string {
    let str = '';
    for (let i = 0; i < length; i++) {
      const char = this.view.getUint8(offset + i);
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str;
  }
  
  getAllFiles(): string[] {
    const entries = this.parseDirectory();
    return Array.from(entries.keys());
  }
}

export async function parseCHMFile(file: File): Promise<{
  parser: CHMParser;
  entries: Map<string, CHMDirectoryEntry>;
}> {
  const buffer = await file.arrayBuffer();
  const parser = new CHMParser(buffer);
  const entries = parser.parseDirectory();
  
  return { parser, entries };
}

export async function parseTOCHTML(html: string): Promise<CHMTOCEntry[]> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const entries: CHMTOCEntry[] = [];
  
  // Handle different TOC formats
  const parseElement = (element: Element): CHMTOCEntry | null => {
    // Check for LI element with OBJECT or A child
    const objectEl = element.querySelector('object[type="text/sitemap"]');
    const anchorEl = element.querySelector('a[href]');
    
    const nameEl = objectEl || anchorEl;
    const hrefEl = anchorEl;
    
    if (!nameEl) return null;
    
    const name = objectEl 
      ? objectEl.querySelector('param[name="name"]')?.getAttribute('value') || ''
      : nameEl.textContent?.trim() || '';
    
    const path = hrefEl?.getAttribute('href')?.replace(/^.*::/, '').replace(/^\//, '') || '';
    
    if (!name) return null;
    
    // Recursively parse children (nested ULs)
    const childrenUL = element.querySelector(':scope > ul');
    const children: CHMTOCEntry[] = [];
    
    if (childrenUL) {
      childrenUL.querySelectorAll(':scope > li').forEach(li => {
        const child = parseElement(li);
        if (child) children.push(child);
      });
    }
    
    return { name, path, children };
  };
  
  doc.querySelectorAll(':root > body > ul > li, body > ul > li, ul > li').forEach(li => {
    const entry = parseElement(li);
    if (entry) entries.push(entry);
  });
  
  return entries;
}

export async function parseIndexHTML(html: string): Promise<CHMIndexEntry[]> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const entries: CHMIndexEntry[] = [];
  
  doc.querySelectorAll('ul > li, li').forEach(li => {
    const objectEl = li.querySelector('object[type="text/sitemap"]');
    const anchorEls = li.querySelectorAll('a[href]');
    
    if (!objectEl) return;
    
    const name = objectEl.querySelector('param[name="name"]')?.getAttribute('value') || '';
    if (!name) return;
    
    const references: CHMIndexReference[] = [];
    
    // Get primary reference from object
    const primaryUrl = objectEl.querySelector('param[name="local"]')?.getAttribute('value') || '';
    if (primaryUrl) {
      references.push({ name: 'Main', url: primaryUrl });
    }
    
    // Get additional references from anchors
    anchorEls.forEach(a => {
      const href = a.getAttribute('href')?.replace(/^.*::/, '').replace(/^\//, '') || '';
      const text = a.textContent?.trim() || '';
      if (href && text) {
        references.push({ name: text, url: href });
      }
    });
    
    if (references.length > 0) {
      entries.push({ name, references });
    }
  });
  
  return entries;
}
