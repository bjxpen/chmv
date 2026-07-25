/*
 * services/library.js — reading progress + recent files, on IndexedDB (idb).
 */

'use strict';

import { openDB } from 'idb';

const dbPromise = openDB('chmv', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'hash' })
      .createIndex('lastOpened', 'lastOpened');
    db.createObjectStore('handles'); /* hash -> FileSystemFileHandle */
  },
});

export const library = {
  getBook: async (hash) => (await dbPromise).get('books', hash).catch(() => null),

  putBook: async (record) => (await dbPromise).put('books', record),

  deleteBook: async (hash) => {
    const db = await dbPromise;
    await db.delete('books', hash);
    await db.delete('handles', hash).catch(() => {});
  },

  listBooks: async () => {
    const rows = await (await dbPromise).getAll('books');
    return rows.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  },

  /* file handles are best-effort: not clonable in every browser */
  putHandle: async (hash, handle) => {
    try { await (await dbPromise).put('handles', handle, hash); } catch { /* ignore */ }
  },

  getHandle: async (hash) => {
    try { return (await (await dbPromise).get('handles', hash)) || null; } catch { return null; }
  },
};

/**
 * Fast content identity: size + head/middle/tail samples through SHA-256.
 * Sampling 3×256K beats hashing 100MB+ and is plenty to identify a file.
 */
export async function hashFile(file) {
  const CHUNK = 256 * 1024;
  const spots = file.size <= CHUNK * 3
    ? [[0, file.size]]
    : [[0, CHUNK], [Math.floor(file.size / 2), CHUNK], [file.size - CHUNK, CHUNK]];
  const parts = [new TextEncoder().encode(`chmv:${file.size}:`)];
  for (const [off, len] of spots) {
    parts.push(new Uint8Array(await file.slice(off, off + len).arrayBuffer()));
  }
  const digest = await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
