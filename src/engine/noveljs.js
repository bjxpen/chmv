/*
 * noveljs.js — support for script-driven legacy novel CHMs.
 *
 * A very common 2000s CJK novel template (搜书吧 et al.) ships chapters as
 * /txt/NN_M.txt files containing `document.write("…html…")` JavaScript,
 * with navigation defined by a `pages[i] = ['01_1','第一章','字数','卷名']`
 * array in a .js file — and no .hhc/.hhk at all.
 *
 * We never execute scripts. Instead these helpers *statically* recover the
 * content: string literals are lexed out of document.write() calls, and
 * the pages array is parsed into a synthetic table of contents.
 */

'use strict';

import { decodeEntities, nodeFactory } from './hhc.js';
import { decodeBytes, looksLikeValidUtf8 } from './encodings.js';

/* ---------------- JS string-literal lexer ---------------- */

const unescapeJs = (s) => s.replace(
  /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[^ux])/g,
  (_, esc) => {
    if (esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }[esc] ?? esc;
  },
);

/**
 * Scan a bracketed/parenthesized group starting at `start` (index of the
 * opening delimiter), collecting every string literal it contains.
 * Non-literal tokens (variables, `+`, commas) are skipped; nesting of the
 * same delimiter pair is honored. Returns { literals, end }.
 */
function readGroupLiterals(src, start) {
  const open = src[start];
  const close = open === '[' ? ']' : ')';
  const literals = [];
  let i = start + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let lit = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          lit += src[j] + src[j + 1];
          j += 2;
        } else {
          lit += src[j++];
        }
      }
      literals.push(unescapeJs(lit));
      i = j + 1;
    } else if (ch === open) {
      depth++; i++;
    } else if (ch === close) {
      depth--; i++;
    } else {
      i++;
    }
  }
  return { literals, end: i };
}

/** Does this source text look like a document.write-driven chapter? */
export const isDocWriteJs = (text) =>
  /document\s*\.\s*write(ln)?\s*\(/.test(text.slice(0, 4096));

/**
 * Statically extract the HTML that a chapter script would have written.
 * Only string literals are honored — nothing is evaluated.
 */
export function docWriteToHtml(text) {
  const re = /document\s*\.\s*write(?:ln)?\s*\(/g;
  let html = '';
  let m;
  while ((m = re.exec(text)) !== null) {
    const { literals, end } = readGroupLiterals(text, m.index + m[0].length - 1);
    html += literals.join('');
    if (re.lastIndex < end) re.lastIndex = end;
  }
  return html;
}

/* ---------------- pages[] array parser ---------------- */

const stripTags = (s) =>
  decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Human-friendly chapter label: cut long intro blobs at punctuation. */
const tidyTitle = (s, max = 48) => {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const cut = Math.max(
    head.lastIndexOf('】'), head.lastIndexOf('。'), head.lastIndexOf('，'),
    head.lastIndexOf(' '),
  );
  return `${head.slice(0, cut > 8 ? cut + 1 : max).trimEnd()}…`;
};

/**
 * Parse `pages[N] = ['file','title','words','volume?']` entries.
 * @returns {Array<{file: string, title: string, volume: string|null}>}
 */
export function parsePagesArray(text) {
  const items = [];
  const re = /pages\s*\[\s*(\d+)\s*\]\s*=\s*\[/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const { literals: fields, end } = readGroupLiterals(text, m.index + m[0].length - 1);
    if (fields.length >= 2) {
      const rawVol = fields[3];
      items.push({
        index: Number(m[1]),
        file: fields[0].trim(),
        title: tidyTitle(stripTags(fields[1])) || fields[0],
        /* per the original template: pages[i][3] starting with '<' is an
         * inline image/intro block, not a volume header */
        volume: rawVol && !rawVol.trimStart().startsWith('<') ? stripTags(rawVol) : null,
      });
    }
    re.lastIndex = end;
  }
  items.sort((a, b) => a.index - b.index);
  return items;
}

/* ---------------- synthetic navigation ---------------- */

const naturalCompare = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Build a synthetic TOC + reading order for archives without .hhc.
 * Pure: operates on a ChmFile instance, safe in worker and Node.
 *
 * @param {import('./chm.js').ChmFile} chm
 * @param {string} encoding book-level encoding for decoding .js files
 * @returns {{tocTree: Array, docPaths: string[]} | null}
 */
export function synthesizeNovelNav(chm, encoding) {
  const txtEntries = chm.entries.filter(
    (e) => /\.txt$/i.test(e.path) && e.path.startsWith('/') && e.length > 0,
  );
  if (txtEntries.length < 3) return null;

  const byBase = new Map(
    txtEntries.map((e) => [e.path.split('/').pop().toLowerCase(), e.path]),
  );

  /* look for a pages[] definition in the archive's .js files */
  let pages = null;
  for (const e of chm.entries) {
    if (!/\.js$/i.test(e.path) || e.length === 0 || e.length > 512 * 1024) continue;
    let text;
    try {
      const raw = chm.retrieve(e);
      text = decodeBytes(raw, looksLikeValidUtf8(raw) === 'multibyte' ? 'utf-8' : encoding);
    } catch {
      continue;
    }
    if (!/pages\s*\[\s*0\s*\]/.test(text)) continue;
    const parsed = parsePagesArray(text);
    if (parsed.length >= 3) {
      pages = parsed;
      break;
    }
  }

  const node = nodeFactory();
  const tocTree = [];
  const docPaths = [];

  if (pages) {
    let currentVolume = null;
    for (const item of pages) {
      const local = byBase.get(`${item.file.toLowerCase()}.txt`) ?? null;
      if (!local) continue;
      if (item.volume) {
        currentVolume = node(item.volume, null);
        tocTree.push(currentVolume);
      }
      (currentVolume ? currentVolume.children : tocTree)
        .push(node(item.title, local));
      docPaths.push(local);
    }
  }

  if (!docPaths.length) {
    /* no pages array: flat, naturally-sorted chapter list */
    const sorted = txtEntries.map((e) => e.path).sort(naturalCompare);
    /* only synthesize when txt files look like actual chapters */
    let sampled;
    try {
      const first = chm.resolve(sorted[0]);
      sampled = decodeBytes(chm.retrieve(first, 0, Math.min(first.length, 4096)), encoding);
    } catch {
      return null;
    }
    if (!isDocWriteJs(sampled) && sorted.length < 10) return null;
    for (const p of sorted) {
      tocTree.push(node(p.split('/').pop().replace(/\.txt$/i, ''), p));
      docPaths.push(p);
    }
  }

  return docPaths.length ? { tocTree, docPaths } : null;
}

/* ---------------- plain-text chapters ---------------- */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Render decoded plain text as simple paragraph HTML. */
export function plainTextToHtml(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : ''))
    .join('\n');
}
