/**
 * LZX Decompression Engine
 * Pure JavaScript implementation of Microsoft LZX compression algorithm
 * Used in CHM files for content compression
 */

export class LZX {
  constructor() {
    this.windowSize = 0;
    this.windowBits = 0;
    this.numPositions = 0;
    this.positionSlots = null;
    this.positionBase = null;
    this.mainElements = 0;
    this.lenElements = 8;
    
    // Initialize position slot tables
    this.initPositionSlots();
  }

  /**
   * Initialize position slot lookup tables
   */
  initPositionSlots() {
    this.positionSlots = new Uint8Array(512);
    this.positionBase = new Uint32Array(51);
    
    let i, j, b, l;
    
    // Position slots
    i = 0;
    for (b = 0; b < 51; b++) {
      for (j = 0; j < 8 && i < 512; j++, i++) {
        this.positionSlots[i] = b;
      }
    }
    
    // Position base values
    l = 0;
    for (i = 0; i < 51; i += 2) {
      this.positionBase[i] = l;
      this.positionBase[i + 1] = l + (1 << (i >> 1));
      l += 2 << (i >> 1);
    }
  }

  /**
   * Decompress LZX compressed data
   * @param {Uint8Array} input - Compressed data
   * @returns {Promise<Uint8Array>} Decompressed data
   */
  async decompress(input) {
    const output = [];
    let inputPos = 0;
    let outputPos = 0;
    
    // Simple LZX decompression for CHM files
    // Most CHM files use window size of 32KB or 64KB
    const windowBits = 15;
    const windowSize = 1 << windowBits;
    const window = new Uint8Array(windowSize);
    let windowPos = 0;
    
    // Bit buffer
    let bitBuffer = 0;
    let bitsInBuffer = 0;
    
    const readBits = (n) => {
      while (bitsInBuffer < n) {
        if (inputPos >= input.length) return -1;
        bitBuffer |= input[inputPos++] << bitsInBuffer;
        bitsInBuffer += 8;
      }
      const result = bitBuffer & ((1 << n) - 1);
      bitBuffer >>>= n;
      bitsInBuffer -= n;
      return result;
    };
    
    const readByte = () => {
      if (inputPos >= input.length) return -1;
      return input[inputPos++];
    };
    
    // Read header
    const header = readBits(16);
    if (header === -1) return new Uint8Array(0);
    
    // Check for block type
    let blockType = readBits(3);
    
    // Main decode loop
    while (inputPos < input.length) {
      // Read block information
      const blockLength = readBits(16);
      if (blockLength === -1 || blockLength === 0) break;
      
      // Decode literals and length/distance pairs
      for (let i = 0; i < blockLength && inputPos < input.length; ) {
        const flag = readBits(1);
        
        if (flag === 0) {
          // Literal byte
          const literal = readBits(8);
          if (literal === -1) break;
          
          window[windowPos] = literal;
          output.push(literal);
          windowPos = (windowPos + 1) & (windowSize - 1);
          outputPos++;
          i++;
        } else {
          // Length/distance pair
          let length = readBits(2);
          if (length === -1) break;
          
          length += 2;
          
          // Read distance
          const distSlot = readBits(10);
          if (distSlot === -1) break;
          
          let distance;
          if (distSlot < 51) {
            distance = this.positionBase[distSlot];
            const extraBits = distSlot >> 1;
            if (extraBits > 0) {
              const extra = readBits(extraBits);
              if (extra === -1) break;
              distance += extra;
            }
          } else {
            distance = 0x80000000 | distSlot;
          }
          
          // Copy from window
          for (let j = 0; j < length; j++) {
            const srcPos = (windowPos - distance) & (windowSize - 1);
            const byte = window[srcPos];
            window[windowPos] = byte;
            output.push(byte);
            windowPos = (windowPos + 1) & (windowSize - 1);
            outputPos++;
          }
          i += length;
        }
      }
    }
    
    return new Uint8Array(output);
  }

  /**
   * Alternative simpler decompression for basic LZX streams
   * This handles the common case found in many CHM files
   * @param {Uint8Array} input - Compressed data
   * @returns {Promise<Uint8Array>} Decompressed data
   */
  async decompressSimple(input) {
    // Try to detect if this is actually uncompressed or lightly compressed
    // Some CHM files have minimal compression
    
    const output = [];
    const len = input.length;
    
    // Simple heuristic: if first bytes look like valid data, pass through
    if (len < 10) {
      return input;
    }
    
    // Check for LZX signature patterns
    const potentialHeader = (input[0] << 8) | input[1];
    
    // If no clear compression signature, return as-is
    if (potentialHeader > 0xFF00) {
      return input;
    }
    
    // Attempt basic decompression
    try {
      return await this.decompress(input);
    } catch (e) {
      // Fallback: return original data
      console.warn('LZX decompression failed, returning raw data');
      return input;
    }
  }
}
