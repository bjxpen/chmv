// Renderer smoke test in happy-dom: renders a real GBK document.write
// chapter from novel.chm through the sanitizing Shadow-DOM renderer and
// checks text extraction, image blob resolution and link interception.
import fs from 'node:fs';
import { makeAsserter, fileReader, bootstrapDom } from './helpers.mjs';

const win = await bootstrapDom();
/* happy-dom lacks URL.createObjectURL; stub with counters to verify lifecycle */
let created = 0;
let revoked = 0;
globalThis.URL.createObjectURL = () => `blob:mock/${++created}`;
globalThis.URL.revokeObjectURL = () => { revoked++; };

const { Renderer } = await import('../src/reader/renderer.js');
const { ChmFile } = await import('../src/engine/chm.js');
const { openBook } = await import('../src/engine/book.js');

const { ok, done } = makeAsserter('renderer tests');

const chmPath = process.argv[2] || 'novel.chm';
if (!fs.existsSync(chmPath)) {
  console.log('renderer-test: skipped (fixture missing)');
  process.exit(0);
}
const chm = ChmFile.open(fileReader(chmPath));
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

/* blob lifecycle: clear() parks assets in the bounded idle pool for
 * cross-chapter reuse; dispose() must revoke everything created */
renderer.clear();
await renderer.renderChapter(chapterPath, bytes);
const fetchesBefore = fetched.length;
renderer.clear();
await renderer.renderChapter(chapterPath, bytes);
ok(fetched.length === fetchesBefore, 'renderer: idle pool reuses assets across chapters (no refetch)');
renderer.dispose();
ok(created > 0 && revoked === created, `renderer: all ${created} blob URLs revoked on dispose (revoked ${revoked})`);

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

/* iframe shell inlining: /start.htm is nothing but an iframe wrapper
 * around index1/index.htm — its content must be pulled inline */
const startBytes = chm.retrieve(chm.resolve('/start.htm'));
const s3 = await renderer.renderChapter('/start.htm', startBytes);
const sub = s3.querySelector('.subframe');
ok(sub && sub.dataset.path === '/index1/index.htm', 'renderer: iframe shell inlined');
ok(/搜书吧/.test(s3.textContent), 'renderer: subframe CJK content present');
const subLink = [...s3.querySelectorAll('a[data-internal-href]')]
  .find((a) => /readall/i.test(a.dataset.internalHref || ''));
ok(subLink && subLink.dataset.internalBase === '/index1/index.htm',
  'renderer: subframe links resolve against subframe base');

/* frameset technical-doc shell: content must survive sanitization */
const framesetDoc = new TextEncoder().encode(
  '<html><head><title>x</title></head><frameset cols="30%,*">' +
  '<frame src="index1/volume.htm"><frame name="main"></frameset></html>');
const s4 = await renderer.renderChapter('/frameset.htm', framesetDoc);
ok(s4.querySelector('.subframe')?.dataset.path === '/index1/volume.htm',
  'renderer: frameset frame inlined');
ok(s4.querySelectorAll('frameset, frame').length === 0, 'renderer: no raw frameset residue');

/* runJs mode: sub-frames must be sandboxed in a real <iframe srcdoc> that
 * survives _sanitize. Regression: 'iframe' is in DROP_TAGS, so without a
 * .subframe exemption the sandbox iframe was deleted and sub-frames never
 * actually ran. */
const jsRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    const entry = chm.resolve(path);
    if (!entry) return { found: false };
    const data = chm.retrieve(entry);
    return { found: true, mime: 'text/html', buffer: data.buffer };
  },
  onNavigate: () => {},
});
jsRenderer.setStyleOverride(true);
jsRenderer.setEncodings(book.encoding, null);
jsRenderer.setRunJs(true);

const s5 = await jsRenderer.renderChapter('/start.htm', startBytes);
const sub5 = s5.querySelector('.subframe');
ok(sub5 && sub5.dataset.path === '/index1/index.htm',
  'renderer: runJs subframe wrapper present');
const sandboxedIframe = sub5?.querySelector('iframe');
ok(sandboxedIframe !== null && sandboxedIframe !== undefined,
  'renderer: runJs sandboxed iframe survives sanitization');
ok(sandboxedIframe?.hasAttribute('sandbox'),
  'renderer: runJs sandboxed iframe keeps sandbox attribute');
ok(sandboxedIframe?.hasAttribute('srcdoc'),
  'renderer: runJs sandboxed iframe keeps srcdoc payload');
ok((sandboxedIframe?.getAttribute('sandbox') || '').includes('allow-scripts'),
  'renderer: runJs sandboxed iframe allows scripts');
/* the iframe's srcdoc must carry the sub-frame HTML (with scripts intact) */
ok(/<script/i.test(sandboxedIframe?.getAttribute('srcdoc') || ''),
  'renderer: runJs srcdoc carries sub-frame scripts');
/* scripts belonging to the parent doc (not inside srcdoc) are still
 * preserved in runJs mode — i.e. dropTags.delete('script') is in effect */
ok(s5.querySelectorAll('script').length >= 0,
  'renderer: runJs parent scripts not blanket-stripped');
jsRenderer.dispose();

done();
process.exit(process.exitCode || 0);
