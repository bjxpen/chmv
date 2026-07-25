/**
 * Encoding Engine - Auto-detection and conversion for CJK encodings
 * Supports GBK, GB18030, Big5, Shift-JIS, and more
 */

const ENCODINGS = ['UTF-8', 'GBK', 'GB18030', 'Big5', 'Shift-JIS', 'EUC-JP', 'Windows-1252'];

export class EncodingEngine {
  constructor() {
    this.current = 'UTF-8';
    this.autoDetect = true;
  }

  detect(data) {
    if (!data?.length) return 'UTF-8';

    // Check BOM
    if (data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) return 'UTF-8';
    if (data[0] === 0xFF && data[1] === 0xFE) return 'UTF-16LE';
    if (data[0] === 0xFE && data[1] === 0xFF) return 'UTF-16BE';

    const sample = data.slice(0, Math.min(4096, data.length));
    let gb = 0, big5 = 0, sjis = 0, high = 0;

    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b >= 0x80) {
        high++;
        if (b >= 0x81 && b <= 0xFE && i + 1 < sample.length) {
          const next = sample[i + 1];
          if (next >= 0x40 && next <= 0xFE) gb++;
        }
        if (b >= 0xA1 && b <= 0xFE && i + 1 < sample.length) {
          const next = sample[i + 1];
          if ((next >= 0x40 && next <= 0x7E) || (next >= 0xA1 && next <= 0xFE)) big5++;
        }
        if (((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) && i + 1 < sample.length) {
          const next = sample[i + 1];
          if ((next >= 0x40 && next <= 0x7E) || (next >= 0x80 && next <= 0xFC)) sjis++;
        }
      }
    }

    if (high / sample.length < 0.01) return 'UTF-8';
    if (gb >= big5 && gb >= sjis && gb > 0) return 'GB18030';
    if (big5 >= sjis && big5 > 0) return 'Big5';
    if (sjis > 0) return 'Shift-JIS';
    return 'UTF-8';
  }

  decode(data, encoding) {
    try {
      return new TextDecoder(encoding || 'UTF-8').decode(data);
    } catch {
      console.warn(`Encoding ${encoding} failed, fallback to UTF-8`);
      return new TextDecoder('UTF-8').decode(data);
    }
  }

  autoDecode(data) {
    const enc = this.autoDetect ? this.detect(data) : this.current;
    this.current = enc;
    return { text: this.decode(data, enc), encoding: enc };
  }

  setEncoding(enc) {
    if (ENCODINGS.includes(enc)) {
      this.current = enc;
      this.autoDetect = false;
    }
  }

  getSupported() {
    return [...ENCODINGS];
  }
}
