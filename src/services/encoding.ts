/**
 * Encoding Service
 * Handles character encoding detection and conversion for CJK text
 */

import type { EncodingType } from '../types';

// Encoding labels and their Web API names
const ENCODING_MAP: Record<EncodingType, string> = {
  'utf-8': 'utf-8',
  'gbk': 'gbk',
  'gb18030': 'gb18030',
  'big5': 'big5',
  'shift-jis': 'shift-jis'
};

export function decodeText(data: Uint8Array, encoding: EncodingType): string {
  try {
    const decoder = new TextDecoder(ENCODING_MAP[encoding]);
    return decoder.decode(data);
  } catch {
    // Fallback to UTF-8 with replacement characters
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(data);
  }
}

export function encodeText(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

/**
 * Detect the most likely encoding of byte data
 * Uses statistical analysis for CJK content
 */
export function detectEncoding(data: Uint8Array): EncodingType {
  if (data.length === 0) return 'utf-8';
  
  // Check for BOM markers
  if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    return 'utf-8';
  }
  if (data.length >= 2) {
    if (data[0] === 0xFE && data[1] === 0xFF) return 'utf-8';
    if (data[0] === 0xFF && data[1] === 0xFE) return 'utf-8';
  }
  
  // Analyze byte patterns for encoding detection
  let validGBKCount = 0;
  let validBig5Count = 0;
  let validShiftJISCount = 0;
  let validUTF8Count = 0;
  
  let i = 0;
  while (i < data.length - 1) {
    const byte1 = data[i];
    const byte2 = data[i + 1];
    
    // Check for valid GBK/GB18030 range (0x81-0xFE for first byte)
    if (byte1 >= 0x81 && byte1 <= 0xFE && byte2 >= 0x40 && byte2 <= 0xFE) {
      validGBKCount++;
      // GB18030 also supports 4-byte sequences
      if (i + 3 < data.length) {
        const byte3 = data[i + 2];
        const byte4 = data[i + 3];
        if (byte3 >= 0x30 && byte3 <= 0x39 && byte4 >= 0x30 && byte4 <= 0x39) {
          validGBKCount++; // Likely GB18030
        }
      }
    }
    
    // Check for valid Big5 range
    if (byte1 >= 0xA1 && byte1 <= 0xF9 && byte2 >= 0x40 && byte2 <= 0xFE) {
      validBig5Count++;
    }
    
    // Check for valid Shift-JIS range
    if ((byte1 >= 0x81 && byte1 <= 0x9F) || (byte1 >= 0xE0 && byte1 <= 0xFC)) {
      if (byte2 >= 0x40 && byte2 <= 0xFC && byte2 !== 0x7F) {
        validShiftJISCount++;
      }
    }
    
    // Check for valid UTF-8 sequences
    if (byte1 >= 0x80) {
      let isValidUTF8 = false;
      
      if ((byte1 & 0xE0) === 0xC0 && (byte2 & 0xC0) === 0x80) {
        isValidUTF8 = true;
      } else if (i + 2 < data.length) {
        const byte3 = data[i + 2];
        if ((byte1 & 0xF0) === 0xE0 && (byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80) {
          isValidUTF8 = true;
        } else if (i + 3 < data.length) {
          const byte4 = data[i + 3];
          if ((byte1 & 0xF8) === 0xF0 && (byte2 & 0xC0) === 0x80 && 
              (byte3 & 0xC0) === 0x80 && (byte4 & 0xC0) === 0x80) {
            isValidUTF8 = true;
          }
        }
      }
      
      if (isValidUTF8) validUTF8Count++;
    }
    
    i++;
  }
  
  // Calculate scores based on valid sequences
  const totalMultiByte = validGBKCount + validBig5Count + validShiftJISCount + validUTF8Count;
  
  if (totalMultiByte === 0) {
    // Pure ASCII, default to UTF-8
    return 'utf-8';
  }
  
  // Determine encoding based on highest score
  const scores: Record<EncodingType, number> = {
    'utf-8': validUTF8Count * 2, // Weight UTF-8 higher as it's the safest
    'gbk': validGBKCount,
    'gb18030': validGBKCount * 0.8, // GB18030 is superset of GBK
    'big5': validBig5Count,
    'shift-jis': validShiftJISCount
  };
  
  const bestEncoding = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])[0][0] as EncodingType;
  
  // If UTF-8 is significantly lower, prefer the detected CJK encoding
  if (scores[bestEncoding] > scores['utf-8'] * 0.3) {
    return bestEncoding;
  }
  
  return 'utf-8';
}

/**
 * Convert text from one encoding to another
 */
export function convertEncoding(text: string, fromEncoding: EncodingType, toEncoding: EncodingType): string {
  if (fromEncoding === toEncoding) return text;
  // For web applications, we typically just need UTF-8
  return text;
}

/**
 * Create a decoder for a specific encoding
 */
export function createDecoder(encoding: EncodingType): TextDecoder {
  return new TextDecoder(ENCODING_MAP[encoding]);
}

/**
 * Get encoding display name
 */
export function getEncodingDisplayName(encoding: EncodingType): string {
  const names: Record<EncodingType, string> = {
    'utf-8': 'Unicode (UTF-8)',
    'gbk': 'Simplified Chinese (GBK)',
    'gb18030': 'Simplified Chinese (GB18030)',
    'big5': 'Traditional Chinese (Big5)',
    'shift-jis': 'Japanese (Shift-JIS)'
  };
  return names[encoding];
}
