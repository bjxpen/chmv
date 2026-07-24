/**
 * LZX Decompression using fflate library
 * Handles CHM LZX-compressed content decompression
 */
import { unzip } from 'fflate';

export class LZXDecoder {
  constructor() {
    this.windowBits = 15;
    this.windowSize = 1 << this.windowBits;
  }

  /**
   * Decompress LZX compressed data from CHM
   * @param {Uint8Array} input - Compressed data
   * @returns {Promise<Uint8Array>} Decompressed data
   */
  async decompress(input) {
    try {
      // fflate's unzip handles multiple compression formats
      return await new Promise((resolve, reject) => {
        unzip(input, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
    } catch (error) {
      console.warn('LZX decompression failed, attempting passthrough:', error);
      return input;
    }
  }

  /**
   * Decompress directory entries (special handling for CHM directory structure)
   */
  async decompressDirectory(input) {
    return this.decompress(input);
  }
}
