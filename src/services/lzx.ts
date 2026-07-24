/**
 * LZX Decompression Engine
 * Handles decompression of LZX-compressed CHM archive sections
 * Based on the LZX algorithm used in Microsoft HTML Help
 */

// LZX constants
const LZX_PRETEND_BYTE = 0;
const LZX_SYNC = 2;
const LZX_SYNC_STREAM = 3;

// LZX window sizes
const LZX_WINDOW_SIZES: Record<number, number> = {
  0: 0,    // Not used
  1: 0,    // Not used
  2: 512,
  3: 1024,
  4: 2048,
  5: 4096,
  6: 8192,
  7: 16384,
  8: 32768,
  9: 65536,
  10: 131072,
  11: 262144,
  12: 524288,
  13: 1048576,
  14: 2097152,
  15: 4194304,
  16: 8388608,
  17: 16777216
};

// LZX base tables
const LZX_MAIN_TABLES: Record<number, number>[] = [];
const LZX_LENGTH_TABLES: Record<number, number>[] = [];

// Pre-compute LZX tables
for (let i = 0; i < 3; i++) {
  const mainTable: Record<number, number> = {};
  const lengthTable: Record<number, number> = {};
  
  for (let j = 0; j < 256; j++) {
    mainTable[j] = i === 0 ? 256 + (j * 4) : (LZX_MAIN_TABLES[i - 1][j] >> 2) * 3;
  }
  for (let j = 0; j < 27; j++) {
    lengthTable[j] = i === 0 ? (j ? (j - 1) * 4 : 1) : (LZX_LENGTH_TABLES[i - 1][j] >> 2) * 3;
  }
  
  LZX_MAIN_TABLES[i] = mainTable;
  LZX_LENGTH_TABLES[i] = lengthTable;
}

export class LZXDecompressor {
  private windowSize: number;
  private windowBuffer: Uint8Array;
  private windowPos: number = 0;
  private R0: number = 0;
  private R1: number = 0;
  private R2: number = 0;
  private mainTree: number[] = [];
  private lengthTree: number[] = [];
  private headerOverhead: number;
  private posStateMask: number;
  private alignedBitCount: number;
  private extraBits: number[];
  private positionBase: number[];
  
  // Bit buffer
  private bitBuffer: number = 0;
  private bitsInBuffer: number = 0;
  private inputData: Uint8Array | null = null;
  private inputPos: number = 0;
  private inputEnd: number = 0;
  private blockRemaining: number = 0;
  private blockType: number = LZX_SYNC;
  private eof: boolean = false;
  
  // State
  private state: number = 0;
  private blockSize: number = 0;
  private blockSizeRemaining: number = 0;
  private intelStart: number = 0;
  private intelCur: number = 0;
  private outputBuffer: Uint8Array = new Uint8Array(0);
  private outputPos: number = 0;
  
  constructor(windowBits: number) {
    this.windowSize = LZX_WINDOW_SIZES[windowBits] || 32768;
    this.windowBuffer = new Uint8Array(this.windowSize);
    this.headerOverhead = windowBits <= 1 ? 0 : (windowBits <= 3 ? 2 : (windowBits <= 6 ? 4 : (windowBits <= 13 ? 8 : 16)));
    this.posStateMask = 0xFF;
    this.alignedBitCount = windowBits <= 1 ? 0 : (windowBits <= 6 ? 0 : (windowBits <= 8 ? 3 : (windowBits <= 11 ? 4 : (windowBits <= 14 ? 5 : 6))));
    
    // Pre-compute position bases and extra bits
    this.extraBits = [];
    this.positionBase = [];
    let extra = 0;
    let base = 0;
    for (let i = 0; i < 50; i++) {
      this.extraBits[i] = extra;
      this.positionBase[i] = base;
      if (extra < 17) extra++;
      if (extra === 1) extra = 2;
      base += (1 << extra);
    }
    
    this.initTrees();
  }
  
  private initTrees(): void {
    this.mainTree = new Array(512).fill(0);
    this.lengthTree = new Array(32).fill(0);
  }
  
  private readBits(numBits: number): number {
    while (this.bitsInBuffer < numBits && this.inputPos < this.inputEnd) {
      this.bitBuffer |= this.inputData![this.inputPos++] << this.bitsInBuffer;
      this.bitsInBuffer += 8;
    }
    const result = this.bitBuffer & ((1 << numBits) - 1);
    this.bitBuffer >>= numBits;
    this.bitsInBuffer -= numBits;
    return result;
  }
  
  private readByte(): number {
    if (this.inputPos >= this.inputEnd) return 0;
    return this.inputData![this.inputPos++];
  }
  
  private readBlock(): void {
    if (this.eof) return;
    
    // Check for sync markers
    if (this.blockType === LZX_SYNC || this.blockType === LZX_SYNC_STREAM) {
      // Look for sync marker
      let markerFound = false;
      const savedPos = this.inputPos;
      
      // Simple sync detection - look for aligned zero bytes
      if (this.inputPos + 2 <= this.inputEnd) {
        const b1 = this.inputData![this.inputPos];
        const b2 = this.inputData![this.inputPos + 1];
        if (b1 === 0 && b2 === 0) {
          this.inputPos += 2;
          markerFound = true;
        }
      }
      
      if (!markerFound && this.inputPos < this.inputEnd) {
        this.inputPos = savedPos;
      }
    }
    
    this.blockType = this.readBits(3);
    this.blockSizeRemaining = this.readBits(16);
    this.blockRemaining = this.blockSizeRemaining;
    
    switch (this.blockType) {
      case LZX_PRETEND_BYTE:
        this.readBits(8);
        this.blockRemaining = 0;
        break;
      case LZX_SYNC:
        this.state = 0;
        break;
      case LZX_SYNC_STREAM:
        this.state = 0;
        this.blockRemaining = 0;
        break;
      default:
        this.decodeHeader();
        break;
    }
  }
  
  private decodeHeader(): void {
    // Uncompressed block
    if (this.blockType === 0) {
      // Skip remainder of header
      this.readBits(16);
      this.readBits(16);
      this.state = 0;
      return;
    }
    
    // Read tree lengths
    const mainLengths = this.readTreeLengths(256 + (this.state === 0 ? 64 : 64));
    const lengthLengths = this.readTreeLengths(32);
    
    this.mainTree = this.buildTree(mainLengths, 512);
    this.lengthTree = this.buildTree(lengthLengths, 32);
    
    if (this.state !== 0) {
      this.state = 1;
    }
  }
  
  private readTreeLengths(count: number): number[] {
    const lengths = new Array(count).fill(0);
    let length = this.readBits(4);
    if (length === 15) {
      let zeroCount = this.readBits(4) + 3;
      while (zeroCount-- > 0 && count > 0) {
        lengths[--count] = 0;
      }
    }
    
    let i = 0;
    while (i < count && i < 256) {
      length = this.readBits(4);
      if (length === 15) {
        let runLength = this.readBits(4) + 3;
        while (runLength-- > 0 && i < count) {
          lengths[i++] = length;
        }
      } else {
        lengths[i++] = length;
      }
    }
    
    return lengths;
  }
  
  private buildTree(lengths: number[], size: number): number[] {
    const tree = new Array(size).fill(0);
    const blCount = new Array(20).fill(0);
    
    // Count bit lengths
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0) {
        blCount[lengths[i]]++;
      }
    }
    blCount[0] = 0;
    
    // Calculate code offsets
    const nextCode = new Array(20).fill(0);
    let code = 0;
    for (let bits = 1; bits < 20; bits++) {
      nextCode[bits] = code;
      code = (code + blCount[bits]) << 1;
    }
    
    // Build tree
    for (let i = 0; i < size; i++) {
      const len = lengths[i];
      if (len > 0) {
        let pos = nextCode[len]++;
        for (let j = len - 1; j >= 0; j--) {
          pos = (pos << 1) | ((pos >> (19 - j)) & 1);
        }
        tree[pos & 0x1FFFF] = i;
      }
    }
    
    return tree;
  }
  
  private decodeMain(): number {
    let symbol = this.readBits(10);
    
    if (symbol >= 256 + 64) {
      const lengthBase = (symbol - 256 - 64) >> 4;
      const extra = this.extraBits[lengthBase + 3] || 0;
      let length = this.positionBase[lengthBase + 3] + 1;
      
      if (extra > 0) {
        length += this.readBits(extra);
      }
      
      let offset = -1;
      symbol = 256 + ((symbol - 256 - 64) & 0xF);
      
      if (symbol < 2) {
        if (symbol === 0) offset = this.R0;
        else if (symbol === 1) offset = this.R1;
        else offset = this.R2;
      } else {
        offset = (1 << (symbol - 1)) + this.readBits(symbol - 1);
      }
      
      if (symbol >= 2) {
        this.R2 = this.R1;
        this.R1 = this.R0;
        this.R0 = offset;
      } else if (symbol === 0) {
        offset = this.R0;
        this.R0 = this.R1;
        this.R1 = this.R2;
        this.R2 = offset;
      } else {
        offset = this.R1;
        this.R1 = this.R0;
        this.R0 = offset;
      }
      
      return this.copyFromWindow(length, offset);
    }
    
    this.advanceWindow(1);
    return symbol;
  }
  
  private copyFromWindow(length: number, offset: number): number {
    const end = offset + length;
    for (let i = offset; i < end; i++) {
      const byte = this.windowBuffer[i & (this.windowSize - 1)];
      this.windowBuffer[this.windowPos] = byte;
      this.windowPos = (this.windowPos + 1) & (this.windowSize - 1);
    }
    return length;
  }
  
  private advanceWindow(count: number): void {
    this.windowPos = (this.windowPos + count) & (this.windowSize - 1);
  }
  
  decompress(data: Uint8Array, outputSize: number): Uint8Array {
    this.inputData = data;
    this.inputPos = 0;
    this.inputEnd = data.length;
    this.bitBuffer = 0;
    this.bitsInBuffer = 0;
    this.eof = false;
    this.outputBuffer = new Uint8Array(outputSize);
    this.outputPos = 0;
    
    // Reset state
    this.R0 = 0;
    this.R1 = 1;
    this.R2 = 2;
    this.windowPos = 0;
    this.initTrees();
    
    // Read initial header
    const windowBits = this.readBits(5);
    if (windowBits < 15 || windowBits > 21) {
      // Fall back to uncompressed
      return this.decompressUncompressed(data);
    }
    
    this.readBits(5); // Reset delta
    this.intelStart = this.readBits(16) + 1;
    this.intelCur = 0;
    
    // Decompress
    while (this.outputPos < outputSize && !this.eof) {
      if (this.blockRemaining === 0) {
        this.readBlock();
        if (this.blockType === LZX_SYNC || this.blockType === LZX_SYNC_STREAM) {
          if (this.outputPos >= outputSize) break;
        }
        continue;
      }
      
      if (this.blockType === 0) {
        // Uncompressed block
        const alignBits = 16 - (this.inputPos % 16) * 8;
        if (alignBits !== 16) {
          this.readBits(alignBits);
        }
        
        while (this.blockRemaining > 0 && this.outputPos < outputSize) {
          const byte = this.readByte();
          this.windowBuffer[this.windowPos] = byte;
          this.windowPos = (this.windowPos + 1) & (this.windowSize - 1);
          this.outputBuffer[this.outputPos++] = byte;
          this.blockRemaining--;
        }
      } else if (this.blockType === 1) {
        // Verbatim block
        while (this.blockRemaining > 0 && this.outputPos < outputSize) {
          const symbol = this.decodeMain();
          if (symbol === 256) {
            this.eof = true;
            break;
          }
          this.outputBuffer[this.outputPos++] = symbol;
          this.blockRemaining--;
        }
      } else if (this.blockType === 2) {
        // Aligned offset block
        while (this.blockRemaining > 0 && this.outputPos < outputSize) {
          if (this.alignedBitCount > 0 && this.bitsInBuffer < this.alignedBitCount + 1) {
            this.bitBuffer |= this.readByte() << this.bitsInBuffer;
            this.bitsInBuffer += 8;
          }
          
          const symbol = this.decodeMain();
          if (symbol === 256) {
            this.eof = true;
            break;
          }
          this.outputBuffer[this.outputPos++] = symbol;
          this.blockRemaining--;
        }
      }
    }
    
    return this.outputBuffer.slice(0, this.outputPos);
  }
  
  private decompressUncompressed(data: Uint8Array): Uint8Array {
    // Simple passthrough for uncompressed data
    return data.slice(0, Math.min(data.length, this.outputBuffer.length));
  }
}

export function decompressLZX(data: Uint8Array, outputSize: number): Uint8Array {
  const decompressor = new LZXDecompressor(16); // Common CHM window size
  return decompressor.decompress(data, outputSize);
}
