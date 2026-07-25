/*
 * services/engine.js — typed facade over the CHM worker (Comlink proxy).
 * The rest of the app depends on this interface, not on worker mechanics,
 * so it can be swapped for an in-process engine (e.g. in tests).
 */

'use strict';

import * as Comlink from 'comlink';

/**
 * @typedef {Object} BookInfo
 * @property {string|null} title
 * @property {string} encoding        detected book-level encoding
 * @property {string} encodingSource  'meta' | 'bom' | 'heuristic' | 'lcid' | 'default'
 * @property {Array}  tocTree
 * @property {Array<{name: string, targets: string[]}>} indexList
 * @property {string[]} docPaths
 *
 * @typedef {Object} Asset
 * @property {boolean} found
 * @property {string}  [mime]
 * @property {boolean} [isHtml]
 * @property {ArrayBuffer} [buffer]
 *
 * @typedef {Object} ChmEngine
 * @property {(file: File, encoding?: string|null) => Promise<BookInfo>} open
 * @property {(path: string) => Promise<Asset>} get
 * @property {(encoding?: string|null) => Promise<{tocTree: Array, indexList: Array}>} sitemaps
 * @property {() => Promise<void>} dropCaches
 * @property {() => Promise<void>} close
 * @property {() => void} terminate
 */

/** @returns {ChmEngine} */
export function createEngine() {
  const worker = new Worker(new URL('./chm.worker.js', import.meta.url), { type: 'module' });
  const proxy = Comlink.wrap(worker);
  return {
    open: (file, encoding = null) => proxy.open(file, encoding),
    get: (path) => proxy.get(path),
    sitemaps: (encoding = null) => proxy.sitemaps(encoding),
    dropCaches: () => proxy.dropCaches(),
    close: () => proxy.close(),
    terminate: () => {
      proxy[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}
