// Renderer smoke test in happy-dom: renders a real GBK document.write
// chapter from novel.chm through the sanitizing Shadow-DOM renderer and
// checks text extraction, image blob resolution and link interception.
import fs from 'node:fs';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/' });
for (const key of ['document', 'DOMParser', 'Blob', 'NodeFilter', 'CSS', 'HTMLElement', 'CustomEvent']) {
  try { globalThis[key] = win[key]; } catch { /* read-only */ }
}
globalThis.window = win;
if (!globalThis.CSS || !globalThis.CSS.escape) {
  globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
}
/* happy-dom lacks URL.createObjectURL; stub with counters to verify lifecycle */
let created = 0;
let revoked = 0;
globalThis.URL.createObjectURL = () => `blob:mock/${++created}`;
globalThis.URL.revokeObjectURL = () => { revoked++; };

const { Renderer } = await import('../src/reader/renderer.js');
const { ChmFile } = await import('../src/engine/chm.js');
const { openBook } = await import('../src/engine/book.js');

let passed = 0;
const ok = (cond, name) => {
  if (!cond) { console.error(`FAIL: ${name}`); process.exitCode = 1; } else passed++;
};

const chmPath = process.argv[2] || 'novel.chm';
if (!fs.existsSync(chmPath)) {
  console.log('renderer-test: skipped (fixture missing)');
  process.exit(0);
}
const fd = fs.openSync(chmPath, 'r');
const chm = ChmFile.open({
  size: fs.fstatSync(fd).size,
  read(off, len) {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, off);
    return new Uint8Array(buf.buffer, 0, n);
  },
});
const { book } = openBook(chm, { fileSize: 0 });

const fetched = [];
const navigated = [];
const host = win.document.createElement('div');
win.document.body.appendChild(host);

const renderer = new Renderer(host, {
  fetchAsset: async (path) => {
    fetched.push(path);
    const entry = chm.resolve(path);
    if (!entry) return { found: false };
    const data = chm.retrieve(entry);
    return { found: true, mime: 'image/jpeg', buffer: data.buffer };
  },
  onNavigate: (path, fragment) => navigated.push({ path, fragment }),
});
renderer.setStyleOverride(true);
renderer.setEncodings(book.encoding, null);

/* chapter 0 contains an <img src=../txt/1.jpg> */
const chapterPath = book.docPaths[0];
const bytes = chm.retrieve(chm.resolve(chapterPath));
const section = await renderer.renderChapter(chapterPath, bytes);

const text = section.textContent;
ok(/[\u4e00-\u9fff]/.test(text), 'renderer: CJK text rendered');
ok(!/document\s*\.write/.test(text), 'renderer: no script residue in text');
ok(section.querySelectorAll('script').length === 0, 'renderer: scripts stripped');

const img = section.querySelector('img');
ok(img && img.getAttribute('src')?.startsWith('blob:'), 'renderer: image resolved to blob URL');
ok(fetched.some((p) => p.toLowerCase() === '/txt/1.jpg'), `renderer: fetched /txt/1.jpg (${fetched.join(',')})`);

/* blob lifecycle: clearing must revoke everything created */
renderer.clear();
ok(created > 0 && revoked === created, `renderer: all ${created} blob URLs revoked on clear (revoked ${revoked})`);

/* link interception on a synthetic HTML doc */
const linkDoc = new TextEncoder().encode(
  '<html><body><a id="in" href="other.txt">in</a>' +
  '<a id="out" href="https://example.com">out</a>' +
  '<a id="frag" href="#top">frag</a><a name="top"></a></body></html>');
const s2 = await renderer.renderChapter('/index1/fake.htm', linkDoc);
const inLink = s2.querySelector('#in');
ok(inLink?.dataset.internalHref === 'other.txt', 'renderer: internal link marked');
const outLink = s2.querySelector('#out');
ok(outLink?.getAttribute('target') === '_blank' && outLink?.getAttribute('rel')?.includes('noopener'),
  'renderer: external link hardened');

inLink.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
ok(navigated.length === 1 && navigated[0].path === '/index1/other.txt',
  `renderer: click routed through app (${JSON.stringify(navigated)})`);

console.log(`renderer tests: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
process.exit(process.exitCode || 0);
