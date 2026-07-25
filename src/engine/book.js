/*
 * book.js — book-level orchestration over a parsed ChmFile.
 *
 * Pure module (no DOM / worker globals): builds the BookInfo consumed by
 * the UI — encoding detection, TOC/index (from .hhc/.hhk, or synthesized
 * for script-driven novel CHMs), document list and title. Lives in
 * engine/ so the exact same code runs in the worker and in Node tests.
 */

'use strict';

import { parseSitemap, flattenIndex } from './hhc.js';
import { normalizePath, isHtmlPath } from './paths.js';
import {
  LCID_CHARSETS, canonicalCharset, sniffMetaCharset,
  looksLikeValidUtf8, hasUtf8Bom, decodeBytes,
} from './encodings.js';
import { synthesizeNovelNav } from './noveljs.js';

/* ---------------- encoding detection ---------------- */

export const guessDocEncoding = (bytes) => {
  const meta = canonicalCharset(sniffMetaCharset(bytes));
  if (meta) return { encoding: meta, source: 'meta' };
  if (hasUtf8Bom(bytes)) return { encoding: 'utf-8', source: 'bom' };
  if (looksLikeValidUtf8(bytes) === 'multibyte') return { encoding: 'utf-8', source: 'heuristic' };
  return null;
};

const guessBookEncoding = (chm, sampleBytes) => {
  const fromDoc = sampleBytes && guessDocEncoding(sampleBytes);
  if (fromDoc) return fromDoc;

  let lcid = chm.langId & 0xffff;
  const langEntry = chm.parseSystem().get(4);
  if (langEntry && langEntry.length >= 4) lcid = (langEntry[0] | (langEntry[1] << 8)) & 0xffff;

  const fromLcid = LCID_CHARSETS[lcid];
  return fromLcid
    ? { encoding: fromLcid, source: 'lcid' }
    : { encoding: 'utf-8', source: 'default' };
};

/* ---------------- sitemap discovery ---------------- */

const asciiz = (bytes) => {
  if (!bytes) return null;
  const end = bytes.indexOf(0);
  const view = bytes.subarray(0, end < 0 ? bytes.length : end);
  return view.length ? String.fromCharCode(...view) : null;
};

export const findSitemapEntries = (chm, sys) => {
  let hhc = chm.resolve(normalizePath('/', asciiz(sys.get(0)) || ''));
  let hhk = chm.resolve(normalizePath('/', asciiz(sys.get(1)) || ''));
  for (const e of chm.entries) {
    const lower = e.path.toLowerCase();
    if (!hhc && lower.endsWith('.hhc')) hhc = e;
    else if (!hhk && lower.endsWith('.hhk')) hhk = e;
  }
  return { hhc, hhk };
};

/** Serialize a sitemap tree with numeric ids and normalized locals. */
const packTree = (root, basePath) => {
  let nextId = 0;
  const pack = (node) => ({
    id: nextId++,
    name: node.name,
    local: node.local ? normalizePath(basePath, node.local) : null,
    children: node.children.map(pack),
  });
  return root.children.map(pack);
};

const parseSitemapEntry = (chm, entry, encoding, mapper) => {
  if (!entry) return [];
  try {
    const raw = chm.retrieve(entry);
    const enc = encoding ||
      (guessDocEncoding(raw) || { encoding: 'utf-8' }).encoding;
    return mapper(parseSitemap(decodeBytes(raw, enc)), entry.path);
  } catch {
    return [];
  }
};

/**
 * Fallback TOC for archives with no .hhc and no recognizable novel
 * template: group documents by directory so thousands of flat files
 * stay navigable (idea borrowed from the jules branch).
 */
export const fallbackTocFromPaths = (docPaths) => {
  let nextId = 0;
  const node = (name, local) => ({ id: nextId++, name, local, children: [] });
  const nameOf = (p) => {
    const base = p.split('/').pop();
    return base.replace(/\.[^.]+$/, '') || base;
  };

  const byDir = new Map();
  for (const p of docPaths) {
    const dir = p.slice(0, p.lastIndexOf('/')) || '/';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(p);
  }
  /* single directory → flat list */
  if (byDir.size <= 1) return docPaths.map((p) => node(nameOf(p), p));

  const tree = [];
  for (const [dir, paths] of byDir) {
    const label = dir === '/' ? '(root)' : dir.replace(/^\//, '');
    const parent = node(label, null);
    parent.children = paths.map((p) => node(nameOf(p), p));
    tree.push(parent);
  }
  return tree;
};

/**
 * Build navigation (TOC tree + keyword index) with a given encoding.
 * Falls back to synthesized novel navigation when there is no usable
 * .hhc — covers script-driven 2000s CJK novel templates.
 */
export const buildNav = (chm, sitemapEntries, encoding, docPathsForFallback = null) => {
  const tocTree = parseSitemapEntry(chm, sitemapEntries.hhc, encoding, packTree);
  const indexList = parseSitemapEntry(chm, sitemapEntries.hhk, encoding, (tree, base) =>
    flattenIndex(tree).map(({ name, targets }) => ({
      name,
      targets: targets.map((t) => normalizePath(base, t.local)).filter(Boolean),
    })));

  let synthetic = null;
  if (!tocTree.length) {
    try { synthetic = synthesizeNovelNav(chm, encoding); } catch { /* keep null */ }
  }
  let finalToc = synthetic ? synthetic.tocTree : tocTree;
  if (!finalToc.length && docPathsForFallback && docPathsForFallback.length) {
    finalToc = fallbackTocFromPaths(docPathsForFallback);
  }
  return {
    tocTree: finalToc,
    indexList,
    syntheticDocPaths: synthetic ? synthetic.docPaths : null,
  };
};

/* ---------------- book opening ---------------- */

/**
 * Assemble the BookInfo for a parsed archive.
 * @param {import('./chm.js').ChmFile} chm
 * @param {{encodingOverride?: string|null, fileSize?: number}} [opts]
 */
export function openBook(chm, { encodingOverride = null, fileSize = 0 } = {}) {
  const sys = chm.parseSystem();
  const sitemapEntries = findSitemapEntries(chm, sys);

  const htmlPaths = chm.entries
    .filter((e) => /^\/(?![#$:])/.test(e.path) && !e.path.endsWith('/') && isHtmlPath(e.path))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  /* sample one document for book-level encoding detection; fall back to
   * a .txt chapter for script-driven novel archives without HTML */
  let sample = null;
  const samplePath = htmlPaths[Math.min(1, htmlPaths.length - 1)] ||
    chm.entries.find((e) => /\.txt$/i.test(e.path) && e.length > 256)?.path;
  if (samplePath) {
    try {
      const entry = chm.resolve(samplePath);
      sample = chm.retrieve(entry, 0, Math.min(entry.length, 64 * 1024));
    } catch { /* ignore */ }
  }
  const detected = guessBookEncoding(chm, sample);
  const encoding = encodingOverride || detected.encoding;

  const { tocTree, indexList, syntheticDocPaths } =
    buildNav(chm, sitemapEntries, encoding, htmlPaths);

  const titleBytes = sys.get(3);
  let title = null;
  if (titleBytes && titleBytes.length) {
    const nul = titleBytes.indexOf(0);
    title = decodeBytes(titleBytes.subarray(0, nul < 0 ? titleBytes.length : nul), encoding)
      .trim() || null;
  }

  return {
    book: {
      title,
      encoding: detected.encoding,
      encodingSource: detected.source,
      tocTree,
      indexList,
      /* synthetic novel nav replaces the raw HTML list: template shells
       * (frameset/iframe index pages) would otherwise pollute the spine */
      docPaths: syntheticDocPaths || htmlPaths,
      synthetic: !!syntheticDocPaths,
      entryCount: chm.entries.length,
      fileSize,
      compression: chm.compressionEnabled,
    },
    sitemapEntries,
  };
}
