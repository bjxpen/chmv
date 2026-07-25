/*
 * helpers.mjs — shared test utilities: assertion counter, Node file
 * reader for the CHM engine, and happy-dom bootstrap.
 */
import fs from 'node:fs';

/** Simple counting assert; returns a summary printer. */
export function makeAsserter(suiteName) {
  let passed = 0;
  const ok = (cond, name) => {
    if (!cond) {
      console.error(`FAIL: ${name}`);
      process.exitCode = 1;
    } else passed++;
  };
  const done = () => {
    console.log(`${suiteName}: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
  };
  return { ok, done };
}

/** Random-access reader over a file on disk (ChmFile.open interface). */
export function fileReader(path) {
  const fd = fs.openSync(path, 'r');
  return {
    size: fs.fstatSync(fd).size,
    read(off, len) {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, off);
      return new Uint8Array(buf.buffer, 0, n);
    },
  };
}

/** Install happy-dom globals; returns the Window. */
export async function bootstrapDom() {
  const { Window } = await import('happy-dom');
  const win = new Window({ url: 'http://localhost/' });
  for (const key of ['document', 'DOMParser', 'Blob', 'NodeFilter', 'CSS', 'HTMLElement', 'CustomEvent', 'localStorage']) {
    try { globalThis[key] = win[key]; } catch { /* read-only global */ }
  }
  globalThis.window = win;
  if (!globalThis.CSS?.escape) {
    globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
  }
  return win;
}
