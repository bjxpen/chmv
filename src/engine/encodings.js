/*
 * encodings.js — charset aliases, sniffing and detection heuristics.
 * Shared between the worker (initial detection) and the UI (re-decode).
 */

'use strict';

/** Encodings surfaced in the UI toggle. */
export const UI_ENCODINGS = [
  { value: '', label: 'Auto detect' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK (简体)' },
  { value: 'gb18030', label: 'GB18030 (简体)' },
  { value: 'big5', label: 'Big5 (繁體)' },
  { value: 'shift_jis', label: 'Shift-JIS (日本語)' },
  { value: 'euc-jp', label: 'EUC-JP (日本語)' },
  { value: 'euc-kr', label: 'EUC-KR (한국어)' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'windows-1251', label: 'Windows-1251 (кириллица)' },
];

export const LCID_CHARSETS = {
  0x0804: 'gbk', 0x1004: 'gbk', 0x0c04: 'big5', 0x0404: 'big5', 0x1404: 'big5',
  0x0411: 'shift_jis', 0x0412: 'euc-kr',
  0x0419: 'windows-1251', 0x0405: 'windows-1250', 0x040e: 'windows-1250',
  0x0408: 'windows-1253', 0x041f: 'windows-1254', 0x040d: 'windows-1255',
  0x0401: 'windows-1256', 0x041e: 'windows-874',
};

const CHARSET_ALIASES = {
  'gb2312': 'gbk', 'gb_2312': 'gbk', 'gb-2312': 'gbk', 'csgb2312': 'gbk', 'x-gbk': 'gbk',
  'gb18030': 'gb18030', 'gbk': 'gbk', 'hz-gb-2312': 'gbk',
  'big5': 'big5', 'big-5': 'big5', 'big5-hkscs': 'big5', 'cn-big5': 'big5', 'csbig5': 'big5', 'x-x-big5': 'big5',
  'shift_jis': 'shift_jis', 'shift-jis': 'shift_jis', 'sjis': 'shift_jis',
  'x-sjis': 'shift_jis', 'ms_kanji': 'shift_jis', 'windows-31j': 'shift_jis', 'cp932': 'shift_jis',
  'euc-jp': 'euc-jp', 'x-euc-jp': 'euc-jp',
  'euc-kr': 'euc-kr', 'ks_c_5601-1987': 'euc-kr', 'ksc5601': 'euc-kr', 'cp949': 'euc-kr',
  'utf-8': 'utf-8', 'utf8': 'utf-8', 'unicode': 'utf-8',
  'iso-8859-1': 'windows-1252', 'latin1': 'windows-1252', 'latin-1': 'windows-1252',
  'windows-1252': 'windows-1252', 'cp1252': 'windows-1252',
  'us-ascii': 'windows-1252', 'ascii': 'windows-1252',
  'windows-1251': 'windows-1251', 'cp1251': 'windows-1251', 'koi8-r': 'koi8-r',
  'windows-1250': 'windows-1250', 'windows-1253': 'windows-1253',
  'windows-1254': 'windows-1254', 'windows-1255': 'windows-1255',
  'windows-1256': 'windows-1256', 'windows-874': 'windows-874', 'tis-620': 'windows-874',
};

export function canonicalCharset(name) {
  if (!name) return null;
  return CHARSET_ALIASES[name.toLowerCase()] || null;
}

/** Look at the first 2KB (as latin-1) for a meta charset declaration. */
function sniffMetaCharset(bytes) {
  const head = bytes.subarray(0, 2048);
  let s = '';
  for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
  const m = s.match(/charset\s*=\s*["']?\s*([\w][\w.:-]*)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Validate a byte sample as UTF-8.
 * @returns {'multibyte' | 'ascii' | false}
 */
export function looksLikeValidUtf8(bytes) {
  const n = Math.min(bytes.length, 64 * 1024);
  let i = 0;
  let multibyte = false;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    let len;
    if ((b & 0xe0) === 0xc0) len = 2;
    else if ((b & 0xf0) === 0xe0) len = 3;
    else if ((b & 0xf8) === 0xf0) len = 4;
    else return false;
    if (i + len > n) break; /* truncated at sample edge: fine */
    for (let k = 1; k < len; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) return false;
    }
    multibyte = true;
    i += len;
  }
  return multibyte ? 'multibyte' : 'ascii';
}

function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/**
 * Sniff a document's own encoding declaration/shape.
 * Order: explicit meta charset -> UTF-8 BOM -> valid multibyte UTF-8.
 * @returns {{encoding: string, source: string} | null}
 */
export function sniffEncoding(bytes) {
  const meta = canonicalCharset(sniffMetaCharset(bytes));
  if (meta) return { encoding: meta, source: 'meta' };
  if (hasUtf8Bom(bytes)) return { encoding: 'utf-8', source: 'bom' };
  if (looksLikeValidUtf8(bytes) === 'multibyte') return { encoding: 'utf-8', source: 'heuristic' };
  return null;
}

/**
 * Pick the best encoding for a document's raw bytes.
 * @param {string|null} override user-selected encoding ('' / null = auto)
 * @param {string} bookDefault book-level detected encoding
 */
export function effectiveEncoding(bytes, override, bookDefault) {
  return override || sniffEncoding(bytes)?.encoding || bookDefault || 'utf-8';
}

export function decodeBytes(bytes, encoding) {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
