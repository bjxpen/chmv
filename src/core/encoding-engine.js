/**
 * Encoding Detection and Conversion Engine
 * Handles automatic encoding detection and conversion for CJK text
 */

export class EncodingEngine {
  constructor() {
    this.supportedEncodings = [
      'UTF-8',
      'GBK',
      'GB18030',
      'Big5',
      'Shift-JIS',
      'EUC-JP',
      'EUC-KR',
      'ISO-2022-JP',
      'Windows-1252'
    ];
    
    this.currentEncoding = 'UTF-8';
    this.autoDetectEnabled = true;
  }

  /**
   * Detect encoding from byte data
   * @param {Uint8Array} data - Raw byte data
   * @returns {string} Detected encoding
   */
  detectEncoding(data) {
    if (!data || data.length === 0) {
      return 'UTF-8';
    }

    // Check for BOM markers
    if (data.length >= 3 && 
        data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
      return 'UTF-8';
    }
    
    if (data.length >= 2 && 
        data[0] === 0xFF && data[1] === 0xFE) {
      return 'UTF-16LE';
    }
    
    if (data.length >= 2 && 
        data[0] === 0xFE && data[1] === 0xFF) {
      return 'UTF-16BE';
    }

    // Statistical analysis for CJK encodings
    const sampleSize = Math.min(data.length, 4096);
    const sample = data.slice(0, sampleSize);
    
    // Count byte patterns
    let asciiCount = 0;
    let highByteCount = 0;
    let gbPattern = 0;
    let big5Pattern = 0;
    let sjisPattern = 0;
    
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      
      if (byte < 0x80) {
        asciiCount++;
      } else {
        highByteCount++;
        
        // Check for GB/GB18030 patterns (0x81-0xFE followed by 0x40-0xFE)
        if (byte >= 0x81 && byte <= 0xFE && i + 1 < sample.length) {
          const nextByte = sample[i + 1];
          if (nextByte >= 0x40 && nextByte <= 0xFE) {
            gbPattern++;
          }
        }
        
        // Check for Big5 patterns (0xA1-0xFE followed by 0x40-0x7E or 0xA1-0xFE)
        if (byte >= 0xA1 && byte <= 0xFE && i + 1 < sample.length) {
          const nextByte = sample[i + 1];
          if ((nextByte >= 0x40 && nextByte <= 0x7E) || 
              (nextByte >= 0xA1 && nextByte <= 0xFE)) {
            big5Pattern++;
          }
        }
        
        // Check for Shift-JIS patterns
        if (((byte >= 0x81 && byte <= 0x9F) || 
             (byte >= 0xE0 && byte <= 0xFC)) && i + 1 < sample.length) {
          const nextByte = sample[i + 1];
          if ((nextByte >= 0x40 && nextByte <= 0x7E) || 
              (nextByte >= 0x80 && nextByte <= 0xFC)) {
            sjisPattern++;
          }
        }
      }
    }
    
    // Determine most likely encoding
    const totalChars = asciiCount + highByteCount;
    if (totalChars === 0) return 'UTF-8';
    
    const cjkRatio = highByteCount / totalChars;
    
    if (cjkRatio < 0.01) {
      return 'UTF-8'; // Mostly ASCII
    }
    
    // Compare pattern counts
    const maxPattern = Math.max(gbPattern, big5Pattern, sjisPattern);
    
    if (maxPattern === gbPattern && gbPattern > 0) {
      return 'GB18030';
    } else if (maxPattern === big5Pattern && big5Pattern > 0) {
      return 'Big5';
    } else if (maxPattern === sjisPattern && sjisPattern > 0) {
      return 'Shift-JIS';
    }
    
    // Default fallback based on context
    return 'UTF-8';
  }

  /**
   * Decode bytes to string with specified encoding
   * @param {Uint8Array} data - Raw byte data
   * @param {string} encoding - Target encoding
   * @returns {string} Decoded string
   */
  decode(data, encoding = 'UTF-8') {
    try {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(data);
    } catch (error) {
      console.warn(`Failed to decode with ${encoding}, falling back to UTF-8`);
      const decoder = new TextDecoder('UTF-8');
      return decoder.decode(data);
    }
  }

  /**
   * Auto-detect and decode
   * @param {Uint8Array} data - Raw byte data
   * @returns {{text: string, encoding: string}} Decoded text and detected encoding
   */
  autoDecode(data) {
    const detectedEncoding = this.autoDetectEnabled ? 
      this.detectEncoding(data) : this.currentEncoding;
    
    const text = this.decode(data, detectedEncoding);
    this.currentEncoding = detectedEncoding;
    
    return {
      text,
      encoding: detectedEncoding
    };
  }

  /**
   * Set current encoding
   * @param {string} encoding - Encoding to use
   */
  setEncoding(encoding) {
    if (this.supportedEncodings.includes(encoding)) {
      this.currentEncoding = encoding;
      this.autoDetectEnabled = false;
    } else {
      console.warn(`Unsupported encoding: ${encoding}`);
    }
  }

  /**
   * Get current encoding
   * @returns {string} Current encoding
   */
  getEncoding() {
    return this.currentEncoding;
  }

  /**
   * Enable/disable auto-detection
   * @param {boolean} enabled - Whether to enable auto-detection
   */
  setAutoDetect(enabled) {
    this.autoDetectEnabled = enabled;
  }

  /**
   * Get list of supported encodings
   * @returns {string[]} Array of encoding names
   */
  getSupportedEncodings() {
    return [...this.supportedEncodings];
  }

  /**
   * Re-decode text with different encoding
   * @param {Uint8Array} originalData - Original byte data
   * @param {string} newEncoding - New encoding to use
   * @returns {string} Re-decoded text
   */
  redecode(originalData, newEncoding) {
    this.setEncoding(newEncoding);
    return this.decode(originalData, newEncoding);
  }
}
