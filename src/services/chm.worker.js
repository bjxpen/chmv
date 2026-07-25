/*
 * services/chm.worker.js — CHM engine hosted in a Web Worker via Comlink.
 *
 * Thin shell: File I/O (FileReaderSync) + Comlink plumbing. All parsing
 * logic lives in src/engine/ (pure, Node-testable).
 */

'use strict';

import * as Comlink from 'comlink';
import { ChmFile } from '../engine/chm.js';
import { openBook, buildNav, listDocPaths } from '../engine/book.js';
import { mimeFor, isRenderablePath } from '../engine/paths.js';

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

class ChmEngine {
  #chm = null;
  #sitemaps = { hhc: null, hhk: null };

  /** Parse the archive; returns book metadata + navigation trees. */
  open(file, encodingOverride = null) {
    this.#chm = ChmFile.open(makeReader(file));
    const { book, sitemapEntries } = openBook(this.#chm, {
      encodingOverride,
      fileSize: file.size,
    });
    this.#sitemaps = sitemapEntries;
    return book;
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
      { path, found: true, mime: mimeFor(path), isHtml: isRenderablePath(path), buffer },
      [buffer],
    );
  }

  /** (Re-)decode the TOC and keyword index with a given encoding. */
  sitemaps(encoding = null) {
    if (!this.#chm) return { tocTree: [], indexList: [] };
    const { tocTree, indexList } =
      buildNav(this.#chm, this.#sitemaps, encoding, listDocPaths(this.#chm));
    return { tocTree, indexList };
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
