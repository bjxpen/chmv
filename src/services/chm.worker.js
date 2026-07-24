/*
 * services/chm.worker.js — CHM engine hosted in a Web Worker via Comlink.
 *
 * Owns the ChmFile instance so LZX decompression and directory scans never
 * block the UI thread. Reads slices of the File on demand (FileReaderSync),
 * so even 100MB+ archives are never copied wholesale into memory.
 */

'use strict';

import * as Comlink from 'comlink';
import { ChmFile } from '../engine/chm.js';
import { parseSitemap, flattenIndex } from '../engine/hhc.js';
import { normalizePath, mimeFor, isHtmlPath } from '../engine/paths.js';
import {
  LCID_CHARSETS, canonicalCharset, sniffMetaCharset,
  looksLikeValidUtf8, hasUtf8Bom, decodeBytes,
} from '../engine/encodings.js';

const readerSync = new FileReaderSync();

/** Windowed reader over a File — avoids one syscall per 4K chunk. */
const makeReader = (file, windowSize = 512 * 1024) => {
  let cacheStart = -1;
  let cacheBuf = null;
  return {
    size: file.size,
    read(offset, length) {
      if (offset < 0 || offset + length > file.size) return new Uint8Array(0);
      if (length >= windowSize) {
        return new Uint8Array(readerSync.readAsArrayBuffer(file.slice(offset, offset + length)));
      }
      const inCache = cacheStart >= 0 &&
        offset >= cacheStart && offset + length <= cacheStart + cacheBuf.length;
      if (!inCache) {
        cacheStart = offset;
        cacheBuf = new Uint8Array(
          readerSync.readAsArrayBuffer(file.slice(offset, Math.min(file.size, offset + windowSize))),
        );
      }
      return cacheBuf.subarray(offset - cacheStart, offset - cacheStart + length);
    },
  };
};

/* ---------------- encoding detection ---------------- */

const guessDocEncoding = (bytes) => {
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

const sitemapEncoding = (bytes, fallback) =>
  (guessDocEncoding(bytes) || { encoding: fallback }).encoding;

/* ---------------- sitemap helpers ---------------- */

const asciiz = (bytes) => {
  if (!bytes) return null;
  const end = bytes.indexOf(0);
  const view = bytes.subarray(0, end < 0 ? bytes.length : end);
  return view.length ? String.fromCharCode(...view) : null;
};

const findSitemapEntries = (chm, sys) => {
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

/* ---------------- worker API ---------------- */

class ChmEngine {
  #chm = null;
  #sitemaps = { hhc: null, hhk: null };

  /** Parse the archive; returns book metadata + navigation trees. */
  open(file, encodingOverride = null) {
    this.#chm = ChmFile.open(makeReader(file));
    const chm = this.#chm;

    const sys = chm.parseSystem();
    this.#sitemaps = findSitemapEntries(chm, sys);

    const docPaths = chm.entries
      .filter((e) => /^\/(?![#$:])/.test(e.path) && !e.path.endsWith('/') && isHtmlPath(e.path))
      .map((e) => e.path)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    /* sample one HTML document for book-level encoding detection */
    const samplePath = docPaths[Math.min(1, docPaths.length - 1)];
    let sample = null;
    if (samplePath) {
      try {
        const entry = chm.resolve(samplePath);
        sample = chm.retrieve(entry, 0, Math.min(entry.length, 64 * 1024));
      } catch { /* ignore */ }
    }
    const detected = guessBookEncoding(chm, sample);
    const { tocTree, indexList } = this.sitemaps(encodingOverride || detected.encoding);

    const titleBytes = sys.get(3);
    const title = titleBytes
      ? decodeBytes(titleBytes.subarray(0, Math.max(0, titleBytes.indexOf(0))),
          encodingOverride || detected.encoding).trim() || null
      : null;

    return {
      title,
      encoding: detected.encoding,
      encodingSource: detected.source,
      tocTree,
      indexList,
      docPaths,
      entryCount: chm.entries.length,
      fileSize: file.size,
      compression: chm.compressionEnabled,
    };
  }

  /** Retrieve one object; the buffer is transferred, not copied. */
  get(path) {
    const entry = this.#chm?.resolve(path);
    if (!entry) return { path, found: false };
    const data = this.#chm.retrieve(entry);
    const buffer = data.byteOffset === 0 && data.buffer.byteLength === data.length
      ? data.buffer
      : data.slice().buffer;
    return Comlink.transfer(
      { path, found: true, mime: mimeFor(path), isHtml: isHtmlPath(path), buffer },
      [buffer],
    );
  }

  /** (Re-)decode the TOC and keyword index with a given encoding. */
  sitemaps(encoding = null) {
    const parse = (entry, mapper) => {
      if (!entry) return [];
      try {
        const raw = this.#chm.retrieve(entry);
        const text = decodeBytes(raw, encoding || sitemapEncoding(raw, 'utf-8'));
        return mapper(parseSitemap(text), entry.path);
      } catch {
        return [];
      }
    };
    return {
      tocTree: parse(this.#sitemaps.hhc, packTree),
      indexList: parse(this.#sitemaps.hhk, (tree, base) =>
        flattenIndex(tree).map(({ name, targets }) => ({
          name,
          targets: targets.map((t) => normalizePath(base, t.local)).filter(Boolean),
        }))),
    };
  }

  dropCaches() {
    this.#chm?.dropCaches();
  }

  close() {
    this.#chm = null;
    this.#sitemaps = { hhc: null, hhk: null };
  }
}

Comlink.expose(new ChmEngine());
