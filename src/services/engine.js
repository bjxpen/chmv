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
 * @property {() => Promise<Array<{path: string, length: number, mime: string}>>} listEntries
 * @property {() => Promise<void>} dropCaches
 * @property {() => Promise<void>} close
 * @property {() => void} terminate
 */

/** @returns {ChmEngine} */
export function createEngine() {
  // In single-file builds we embed the worker source as a string (injected by Vite define)
  // so it can be turned into a Blob URL and still work from file://
  const workerSrc = typeof __CHM_WORKER_SRC__ !== 'undefined' ? __CHM_WORKER_SRC__ : null;

  let worker;
  if (workerSrc) {
    const blob = new Blob([workerSrc], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob)); // classic worker (IIFE)
  } else {
    worker = new Worker(new URL('./chm.worker.js', import.meta.url), { type: 'module' });
  }
  const proxy = Comlink.wrap(worker);
  return {
    open: (file, encoding = null) => proxy.open(file, encoding),
    get: (path) => proxy.get(path),
    sitemaps: (encoding = null) => proxy.sitemaps(encoding),
    listEntries: () => proxy.listEntries(),
    dropCaches: () => proxy.dropCaches(),
    close: () => proxy.close(),
    terminate: () => {
      proxy[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}