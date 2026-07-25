import { describe, it, expect, vi } from 'vitest';
import { ChmReader } from './chmReader';

describe('ChmReader encoding and decoding', () => {
  it('should detect UTF-8 encoding by BOM', () => {
    const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x3C, 0x68, 0x74, 0x6D, 0x6C, 0x3E]); // UTF-8 BOM + <html>
    const reader = new ChmReader();
    const detected = reader.detectEncoding(bytes);
    expect(detected).toBe('utf-8');
  });

  it('should detect encoding from meta tag', () => {
    const text = '<html><head><meta charset="gbk"></head></html>';
    const bytes = new TextEncoder().encode(text);
    const reader = new ChmReader();
    const detected = reader.detectEncoding(bytes);
    expect(detected).toBe('gbk');
  });

  it('should detect encoding from Content-Type meta tag', () => {
    const text = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"></head></html>';
    const bytes = new TextEncoder().encode(text);
    const reader = new ChmReader();
    const detected = reader.detectEncoding(bytes);
    expect(detected).toBe('big5');
  });

  it('should fallback to utf-8 if no meta tag', () => {
    const text = '<html><head></head><body>Hello World</body></html>';
    const bytes = new TextEncoder().encode(text);
    const reader = new ChmReader();
    const detected = reader.detectEncoding(bytes);
    expect(detected).toBe('utf-8');
  });

  it('should decode text correctly using override encoding', () => {
    // Let's encode some Chinese characters in GBK / GB18030
    // "中文" in GBK: [0xd6, 0xd0, 0xce, 0xc4]
    const gbkBytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const reader = new ChmReader();

    // Decoding with GBK override
    const decoded = reader.decodeText(gbkBytes, 'gbk');
    expect(decoded).toBe('中文');
  });

  it('should fallback to utf-8 if override encoding is invalid', () => {
    const text = 'Hello';
    const bytes = new TextEncoder().encode(text);
    const reader = new ChmReader();
    const decoded = reader.decodeText(bytes, 'invalid-encoding');
    expect(decoded).toBe('Hello');
  });
});
