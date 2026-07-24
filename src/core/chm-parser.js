/**
 * CHM File Parser - Core parsing logic for CHM containers
 * Handles LZX decompression, file extraction, and metadata parsing
 */

import { LZX } from './lzx.js';

// CHM Header structures
const CHM_SIGNATURE = 0x4d534346; // "MSCF"
const CHM_VERSION3 = 3;
const CHM_VERSION4 = 4;

export class CHMParser {
  constructor() {
    this.lzx = new LZX();
    this.files = new Map();
    this.toc = null;
    this.index = null;
    this.metadata = {};
    this.arrayBuffer = null;
    this.dataView = null;
  }

  /**
   * Parse a CHM file from ArrayBuffer
   * @param {ArrayBuffer} arrayBuffer - The CHM file as ArrayBuffer
   * @returns {Promise<Object>} Parsed CHM data
   */
  async parse(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.dataView = new DataView(arrayBuffer);
    this.files.clear();

    try {
      const header = this.parseHeader();
      if (!header.valid) {
        throw new Error('Invalid CHM file format');
      }

      this.metadata = {
        version: header.version,
        headerSize: header.headerSize,
        totalFiles: 0
      };

      // Parse directory entries
      await this.parseDirectoryEntries(header);

      return {
        files: this.files,
        toc: this.toc,
        index: this.index,
        metadata: this.metadata
      };
    } catch (error) {
      console.error('CHM Parse Error:', error);
      throw error;
    }
  }

  /**
   * Parse CHM header
   * @returns {Object} Header information
   */
  parseHeader() {
    const signature = this.dataView.getUint32(0, true);
    if (signature !== CHM_SIGNATURE) {
      return { valid: false };
    }

    const version = this.dataView.getUint32(4, true);
    if (version !== CHM_VERSION3 && version !== CHM_VERSION4) {
      return { valid: false, error: `Unsupported CHM version: ${version}` };
    }

    const headerSize = this.dataView.getUint32(8, true);
    const unknown1 = this.dataView.getUint32(12, true);

    return {
      valid: true,
      version,
      headerSize,
      unknown1
    };
  }

  /**
   * Parse directory entries from the CHM file
   * @param {Object} header - Parsed header info
   */
  async parseDirectoryEntries(header) {
    const offset = header.headerSize;
    
    // Read chunk size (first 4 bytes after header)
    const chunkSize = this.dataView.getUint32(offset, true);
    
    // Check if compressed (bit 16 set)
    const isCompressed = (chunkSize & 0x10000) !== 0;
    const actualChunkSize = chunkSize & 0xFFFF;
    
    let dirOffset = offset + 4;
    
    if (isCompressed) {
      // Decompress directory entries
      const compressedDirData = new Uint8Array(
        this.arrayBuffer,
        dirOffset,
        actualChunkSize
      );
      
      try {
        const decompressedData = await this.lzx.decompress(compressedDirData);
        await this.processDirectoryEntries(decompressedData, 0);
      } catch (error) {
        console.error('Failed to decompress directory:', error);
        throw error;
      }
    } else {
      // Directory is not compressed
      const dirData = new Uint8Array(
        this.arrayBuffer,
        dirOffset,
        actualChunkSize
      );
      await this.processDirectoryEntries(dirData, 0);
    }

    this.metadata.totalFiles = this.files.size;
  }

  /**
   * Process directory entries from raw data
   * @param {Uint8Array} data - Directory entry data
   * @param {number} offset - Starting offset
   */
  async processDirectoryEntries(data, offset) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = offset;

    while (pos < data.length - 8) {
      // Read entry header
      const entryType = view.getUint32(pos, true);
      pos += 4;

      if (entryType === 0x01 || entryType === 0x00) {
        // File or directory entry
        const length = view.getUint32(pos, true);
        pos += 4;

        if (pos + length > data.length) break;

        const entryData = data.slice(pos, pos + length);
        const entry = this.parseEntry(entryData, entryType === 0x01);
        
        if (entry) {
          this.files.set(entry.path, entry);
          
          // Check for TOC (.hhc) and Index (.hhk) files
          const lowerPath = entry.path.toLowerCase();
          if (lowerPath.endsWith('.hhc') && !this.toc) {
            this.toc = entry;
          } else if (lowerPath.endsWith('.hhk') && !this.index) {
            this.index = entry;
          }
        }

        pos += length;
      } else if (entryType === 0xFFFFFFFF) {
        // End of entries
        break;
      } else {
        // Unknown entry type, try to skip
        break;
      }
    }
  }

  /**
   * Parse a single directory entry
   * @param {Uint8Array} data - Entry data
   * @param {boolean} isFile - Whether this is a file entry
   * @returns {Object|null} Parsed entry
   */
  parseEntry(data, isFile) {
    try {
      let pos = 0;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      // Skip unknown header bytes (typically 24-28 bytes)
      // Structure varies between CHM versions
      pos = 24;

      if (pos >= data.length) return null;

      // Read path length (UTF-16LE string)
      const pathLenBytes = view.getUint32(pos, true);
      pos += 4;

      if (pathLenBytes === 0 || pos + pathLenBytes > data.length) {
        return null;
      }

      // Decode UTF-16LE path
      const pathBytes = data.slice(pos, pos + pathLenBytes);
      const path = this.decodeUTF16LE(pathBytes);
      pos += pathLenBytes;

      // For files, read content offset and length
      let contentOffset = 0;
      let contentLength = 0;
      let isCompressed = false;

      if (isFile && pos + 16 <= data.length) {
        contentOffset = Number(view.getBigUint64(pos, true));
        pos += 8;
        contentLength = Number(view.getBigUint64(pos, true));
        pos += 8;

        // Check compression flag
        if (pos + 4 <= data.length) {
          const flags = view.getUint32(pos, true);
          isCompressed = (flags & 0x1) !== 0;
        }
      }

      return {
        path,
        isFile,
        contentOffset,
        contentLength,
        isCompressed,
        lastModified: Date.now()
      };
    } catch (error) {
      console.warn('Failed to parse entry:', error);
      return null;
    }
  }

  /**
   * Decode UTF-16LE byte array to string
   * @param {Uint8Array} bytes - UTF-16LE encoded bytes
   * @returns {string} Decoded string
   */
  decodeUTF16LE(bytes) {
    const len = bytes.length;
    let result = '';
    for (let i = 0; i < len; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code === 0) break;
      result += String.fromCharCode(code);
    }
    return result;
  }

  /**
   * Extract and decompress file content
   * @param {Object} entry - File entry
   * @returns {Promise<Uint8Array>} Decompressed file content
   */
  async extractFile(entry) {
    if (!entry.isFile) {
      throw new Error('Cannot extract directory entry');
    }

    const { contentOffset, contentLength, isCompressed } = entry;

    if (contentLength === 0) {
      return new Uint8Array(0);
    }

    const fileData = new Uint8Array(
      this.arrayBuffer,
      contentOffset,
      contentLength
    );

    if (isCompressed) {
      return await this.lzx.decompress(fileData);
    }

    return fileData;
  }

  /**
   * Get file content as text with specified encoding
   * @param {Object} entry - File entry
   * @param {string} encoding - Text encoding (UTF-8, GBK, Big5, etc.)
   * @returns {Promise<string>} Decoded text content
   */
  async getTextContent(entry, encoding = 'UTF-8') {
    const data = await this.extractFile(entry);
    const decoder = new TextDecoder(encoding);
    return decoder.decode(data);
  }

  /**
   * Get file content as blob URL
   * @param {Object} entry - File entry
   * @returns {Promise<string>} Blob URL
   */
  async getBlobURL(entry) {
    const data = await this.extractFile(entry);
    const blob = new Blob([data], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }

  /**
   * Find entry by path (case-insensitive)
   * @param {string} path - File path
   * @returns {Object|null} Found entry or null
   */
  findEntry(path) {
    const lowerPath = path.toLowerCase();
    for (const [key, entry] of this.files.entries()) {
      if (key.toLowerCase() === lowerPath) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Get all HTML files sorted by path
   * @returns {Array} Array of HTML file entries
   */
  getHTMLFiles() {
    const htmlFiles = [];
    for (const entry of this.files.values()) {
      if (entry.isFile && /\.(htm|html)$/i.test(entry.path)) {
        htmlFiles.push(entry);
      }
    }
    return htmlFiles.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.files.clear();
    this.toc = null;
    this.index = null;
    this.arrayBuffer = null;
    this.dataView = null;
  }
}
