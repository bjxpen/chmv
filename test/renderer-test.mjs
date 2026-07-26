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

/* runJs mode: sub-frames are sandboxed in a real <iframe src=blob:...>
 * that survives _sanitize. Regression: 'iframe' is in DROP_TAGS, so
 * without a .subframe exemption the sandbox iframe was deleted and
 * sub-frames never actually ran. The iframe is loaded via a blob: URL
 * (not srcdoc) so it gets a real same-origin URL and can synchronously
 * resolve parent-created blob: asset URLs. */
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
ok((sandboxedIframe?.getAttribute('sandbox') || '').includes('allow-scripts'),
  'renderer: runJs sandboxed iframe allows scripts');
/* iframe is loaded via blob: URL (not srcdoc) so the sub-frame gets a
 * real same-origin URL. */
const iframeSrc = sandboxedIframe?.getAttribute('src') || '';
ok(iframeSrc.startsWith('blob:'),
  `renderer: runJs iframe loaded via blob URL (got: ${iframeSrc.slice(0, 40)}...)`);
ok(!sandboxedIframe?.hasAttribute('srcdoc'),
  'renderer: runJs iframe uses blob src, not srcdoc');
/* External <script src=...> in the sub-frame must be inlined into the
 * blob document — otherwise the script 404s against blob: and globals
 * like `pages` stay undefined (the novel.chm start-page regression). */
const jsRenderer2 = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    const entry = chm.resolve(path);
    if (!entry) return { found: false };
    const data = chm.retrieve(entry);
    return { found: true, mime: 'text/html', buffer: data.buffer };
  },
  onNavigate: () => {},
});
jsRenderer2.setStyleOverride(true);
jsRenderer2.setEncodings(book.encoding, null);
jsRenderer2.setRunJs(true);
const s5b = await jsRenderer2.renderChapter('/start.htm', startBytes);
const iframe2 = s5b.querySelector('.subframe iframe');
const blobUrl2 = iframe2?.getAttribute('src') || '';
/* We can't read the blob's content cross-context in happy-dom, but we
 * can fetch it back via the same mock createObjectURL counter — verify
 * the iframe src is a blob URL we created. */
ok(blobUrl2.startsWith('blob:mock/'),
  'renderer: runJs iframe blob URL created via URL.createObjectURL');
/* The page.js script (defines `pages`) must have been fetched & inlined
 * — verify the fetch was attempted for /js/page.js. */
const fetchedByJs = [];
const jsRenderer3 = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    fetchedByJs.push(path);
    const entry = chm.resolve(path);
    if (!entry) return { found: false };
    const data = chm.retrieve(entry);
    return { found: true, mime: 'text/html', buffer: data.buffer };
  },
  onNavigate: () => {},
});
jsRenderer3.setStyleOverride(true);
jsRenderer3.setEncodings(book.encoding, null);
jsRenderer3.setRunJs(true);
await jsRenderer3.renderChapter('/start.htm', startBytes);
ok(fetchedByJs.some((p) => p.toLowerCase() === '/js/page.js'),
  `renderer: runJs sub-frame script src resolved & fetched (${fetchedByJs.join(',')})`);
ok(fetchedByJs.some((p) => p.toLowerCase() === '/js/mb.js'),
  `renderer: runJs sub-frame mb.js script resolved & fetched`);
jsRenderer.dispose();
jsRenderer2.dispose();
jsRenderer3.dispose();

/* runJs resource hijacking (lazy + cached): the renderer pre-fetches
 * blob URLs only for assets the current sub-frame references (static
 * resources + .txt chapter files discovered via pages[] parsing),
 * caches them across chapters, and injects a runtime shim that
 * rewrites all resource URLs (static + dynamic via document.write)
 * and intercepts navigation. */
const hijackBlobs = new Map();
let hijackCreated = 0;
const hijackOrigCreate = globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL = (b) => {
  const url = `blob:hijack/${++hijackCreated}`;
  hijackBlobs.set(url, b);
  return url;
};
const hijackFetched = [];
const hijackNavigated = [];
const hijackRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    hijackFetched.push(path);
    const entry = chm.resolve(path);
    if (!entry) return { found: false };
    const data = chm.retrieve(entry);
    return { found: true, mime: 'text/html', buffer: data.buffer };
  },
  onNavigate: (path, fragment) => hijackNavigated.push({ path, fragment }),
});
hijackRenderer.setStyleOverride(false);
hijackRenderer.setEncodings(book.encoding, null);
hijackRenderer.setRunJs(true);
const sHijack = await hijackRenderer.renderChapter('/start.htm', startBytes);
/* lazy blob map: only assets referenced by /index1/index.htm + .txt
 * files from pages[] — NOT the whole archive. */
ok(hijackRenderer.runJsBlobs !== null,
  'renderer: runJs lazy blob map built');
ok(hijackRenderer.runJsBlobs.size < chm.entries.length,
  `renderer: runJs lazy map is smaller than full archive (${hijackRenderer.runJsBlobs.size} < ${chm.entries.length})`);
ok(hijackRenderer.runJsBlobs.size > 5,
  `renderer: runJs lazy map has page-relevant entries (${hijackRenderer.runJsBlobs.size})`);
/* .txt chapter files from pages[] should be pre-fetched (the key
 * use case: loadtxt(i) dynamically document.writes <script src=…txt>) */
ok(hijackRenderer.runJsBlobs.has('/txt/01_1.txt'),
  'renderer: runJs lazy map includes /txt/01_1.txt (from pages[] parsing)');
ok(hijackRenderer.runJsBlobs.has('/txt/02_1.txt'),
  'renderer: runJs lazy map includes /txt/02_1.txt (from pages[] parsing)');
/* internal links (href=readall.htm) should be pre-fetched so the
 * shim's click interceptor can resolve them */
ok(hijackRenderer.runJsBlobs.has('/index1/readall.htm'),
  'renderer: runJs lazy map includes /index1/readall.htm (internal link)');
/* the whole archive should NOT be fetched (lazy, not eager) */
ok(hijackFetched.length < chm.entries.length,
  `renderer: runJs lazy fetches fewer than full archive (${hijackFetched.length} < ${chm.entries.length})`);
/* shim is injected into the iframe blob */
const hijackIframe = sHijack.querySelector('.subframe iframe');
const hijackBlobUrl = hijackIframe?.getAttribute('src') || '';
const hijackBlob = hijackBlobs.get(hijackBlobUrl);
ok(hijackBlob, 'renderer: runJs iframe blob captured by mock');
const hijackText = await hijackBlob.text();
/* <meta charset="utf-8"> must be in the iframe <head> — without it,
 * the browser may sniff a different encoding on file:// (no HTTP
 * Content-Type header), garbling CJK text decoded from GBK/Big5. */
ok(/<meta charset="utf-8">/i.test(hijackText),
  'renderer: runJs iframe HTML has <meta charset="utf-8">');
ok(/__chmvNavigate/.test(hijackText),
  'renderer: runJs shim defines __chmvNavigate');
ok(/document\.write\s*=\s*function/.test(hijackText),
  'renderer: runJs shim overrides document.write');
ok(/addEventListener\(.click/.test(hijackText),
  'renderer: runJs shim installs <a> click interceptor');
ok(/BLOBS\s*=/.test(hijackText),
  'renderer: runJs shim embeds blob map');
ok(/request-blob/.test(hijackText),
  'renderer: runJs shim has request-blob fallback for cache misses');
/* The shim embeds the BLOBS map as JSON (not live parent read) because
 * cross-origin parent access is blocked on file://. Verify the embedded
 * map is present and references data: URLs (data: not blob: because
 * the cross-origin iframe can't load parent blob: URLs on file://). */
ok(/var BLOBS\s*=/.test(hijackText),
  'renderer: runJs shim embeds BLOBS JSON snapshot');
ok(/response-blob/.test(hijackText),
  'renderer: runJs shim handles response-blob messages from parent');
/* static resource URLs rewritten to data: in the iframe HTML */
const hijackDataRefs = (hijackText.match(/data:[a-z]+\/[a-z]+;base64,/gi) || []).length;
ok(hijackDataRefs > 0,
  `renderer: runJs iframe HTML references data URLs (${hijackDataRefs})`);
/* document.location = ... in inlined scripts rewritten to __chmvNavigate */
ok(/__chmvNavigate\(/.test(hijackText),
  'renderer: runJs document.location calls rewritten to __chmvNavigate');
/* navigation postMessage routes to onNavigate. The seq counter is now
 * per-iframe (_iframeNavSeqs Map). The _onIframeMessage handler
 * validates e.source against _knownIframes, so we must add a fake
 * source window to the set before dispatching. */
const fakeIframeWindow = { __fake: true };
hijackRenderer._knownIframes.add(fakeIframeWindow);
hijackRenderer._onIframeMessage({
  source: fakeIframeWindow,
  data: { source: 'chmv-iframe', type: 'navigate', path: '/index1/chapter.htm', seq: 1 },
});
ok(hijackNavigated.length === 1 && hijackNavigated[0].path === '/index1/chapter.htm',
  `renderer: runJs navigation postMessage routed to onNavigate (${JSON.stringify(hijackNavigated)})`);
/* stale navigation (old seq from same iframe) ignored */
hijackRenderer._onIframeMessage({
  source: fakeIframeWindow,
  data: { source: 'chmv-iframe', type: 'navigate', path: '/index1/volume.htm', seq: 0 },
});
ok(hijackNavigated.length === 1,
  'renderer: runJs stale navigation (old seq) ignored');
/* non-chmv messages ignored */
hijackRenderer._onIframeMessage({
  source: fakeIframeWindow,
  data: { source: 'other', type: 'navigate', path: '/x', seq: 99 },
});
ok(hijackNavigated.length === 1,
  'renderer: runJs non-chmv messages ignored');
/* messages from unknown sources (security) ignored */
hijackRenderer._onIframeMessage({
  source: { __unknown: true },
  data: { source: 'chmv-iframe', type: 'navigate', path: '/evil', seq: 100 },
});
ok(hijackNavigated.length === 1,
  'renderer: runJs messages from unknown iframe sources ignored (security)');
/* second iframe gets its own seq counter (no cross-iframe collision) */
const fakeIframeWindow2 = { __fake2: true };
hijackRenderer._knownIframes.add(fakeIframeWindow2);
hijackRenderer._onIframeMessage({
  source: fakeIframeWindow2,
  data: { source: 'chmv-iframe', type: 'navigate', path: '/index1/readall.htm', seq: 1 },
});
ok(hijackNavigated.length === 2 && hijackNavigated[1].path === '/index1/readall.htm',
  `renderer: runJs second iframe nav not blocked by first iframe seq (${JSON.stringify(hijackNavigated)})`);
/* request-blob message warms the cache for a path not yet seen.
 * Must use a known iframe source (security validation). */
const beforeMiss = hijackRenderer.runJsBlobs.size;
const missPath = '/index1/chapter.htm'; /* not referenced by index.htm */
ok(!hijackRenderer.runJsBlobs.has(missPath),
  'renderer: runJs miss path not yet cached');
hijackRenderer._onIframeMessage({
  source: fakeIframeWindow,
  data: { source: 'chmv-iframe', type: 'request-blob', path: missPath },
});
/* wait a tick for the async fetch */
await new Promise((r) => setTimeout(r, 50));
ok(hijackRenderer.runJsBlobs.size > beforeMiss,
  `renderer: runJs request-blob warms cache (${beforeMiss} -> ${hijackRenderer.runJsBlobs.size})`);
ok(hijackRenderer.runJsBlobs.has(missPath),
  'renderer: runJs request-blob cached the fetched asset');
/* cache reuse: re-render the same chapter should NOT re-fetch
 * already-cached .txt files / images — only the iframe blob + a
 * few static assets get re-fetched. */
const fetchesBeforeRerender = hijackFetched.length;
await hijackRenderer.renderChapter('/start.htm', startBytes);
ok(hijackFetched.length < fetchesBeforeRerender + 15,
  `renderer: runJs cache reuses blobs across renders (${fetchesBeforeRerender} -> ${hijackFetched.length})`);
globalThis.URL.createObjectURL = hijackOrigCreate;
hijackRenderer.dispose();

/* Legacy `background="images/foo.jpg"` attribute on <td>/<table>/<body>
 * — common in 2000s CJK CHMs. Must be resolved to a blob URL and
 * projected onto inline style, otherwise the URL 404s against the
 * document base. */
const bgDoc = new TextEncoder().encode(
  '<html><body><table><tr>' +
  '<td background="images/001.jpg">cell</td>' +
  '<td background="images/011.jpg">cell2</td>' +
  '</tr></table></body></html>');
const bgFetched = [];
const bgRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    bgFetched.push(path);
    if (/001\.jpg$/i.test(path)) {
      return { found: true, mime: 'image/jpeg', buffer: new Uint8Array([1, 2, 3]).buffer };
    }
    return { found: false };
  },
  onNavigate: () => {},
});
bgRenderer.setStyleOverride(false);
bgRenderer.setEncodings(book.encoding, null);
const s6 = await bgRenderer.renderChapter('/bg/test.htm', bgDoc);
const td1 = s6.querySelector('td:nth-child(1)');
ok(td1 && !td1.hasAttribute('background'),
  'renderer: legacy background attr removed after resolution');
ok(/url\("blob:/.test(td1?.getAttribute('style') || ''),
  'renderer: legacy background projected onto inline style as blob URL');
ok(bgFetched.some((p) => p.toLowerCase() === '/bg/images/001.jpg'),
  `renderer: legacy background asset fetched (${bgFetched.join(',')})`);
bgRenderer.dispose();

/* P0-9 regression: top-level scripts must NEVER execute in the host
 * app's origin, even in runJs mode. Only sub-frame scripts run (inside
 * the sandboxed iframe). */
const topScriptDoc = new TextEncoder().encode(
  '<html><head><script>var evil = 1;</script></head>' +
  '<body><script src="evil.js"></script>text</body></html>');
const topRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async () => ({ found: false }),
  onNavigate: () => {},
});
topRenderer.setStyleOverride(true);
topRenderer.setRunJs(true);
const sTop = await topRenderer.renderChapter('/top.htm', topScriptDoc);
ok(sTop.querySelectorAll('script').length === 0,
  'renderer: top-level scripts stripped even in runJs mode (security)');
topRenderer.dispose();

/* P0-1..P0-5 regression: the nav-rewrite tokenizer must handle string
 * literals, comments, ==, balanced parens, and property accesses. */
const navRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async () => ({ found: false }),
  onNavigate: () => {},
});
navRenderer.setRunJs(true);
const nr = (src) => navRenderer._rewriteScriptNav(src);
ok(nr('document.location.href = "x";') === '__chmvNavigate("x");',
  `nav: document.location.href rewritten (${nr('document.location.href = "x";')})`);
ok(nr('if (location.href == "x") {}') === 'if (location.href == "x") {}',
  `nav: == not treated as assignment`);
ok(nr('if (location.href === "x") {}') === 'if (location.href === "x") {}',
  `nav: === not treated as assignment`);
ok(nr('location.href = f("a","b");') === '__chmvNavigate(f("a","b"));',
  `nav: function-call RHS with commas preserved`);
ok(nr('var s = "location.href = \'x\'";') === 'var s = "location.href = \'x\'";',
  `nav: string literal contents not rewritten`);
ok(nr('// location.href = "x";\n') === '// location.href = "x";\n',
  `nav: line comment not rewritten`);
ok(nr('/* location.href = "x"; */') === '/* location.href = "x"; */',
  `nav: block comment not rewritten`);
ok(nr('obj.location = "x";') === 'obj.location = "x";',
  `nav: obj.location (property access) not rewritten`);
ok(nr('location.hash = "#foo";') === 'location.hash = "#foo";',
  `nav: location.hash not rewritten`);
ok(nr('location.assign("x");') === '__chmvNavigate("x");',
  `nav: location.assign() call rewritten`);
ok(nr('location.replace("x");') === '__chmvNavigate("x");',
  `nav: location.replace() call rewritten`);
navRenderer.dispose();

/* P0-6 regression: concurrent _getDataUrlForPath calls for the same path
 * must dedup — only one fetch, only one data URL created. */
const dedupFetched = [];
const dedupRenderer = new Renderer(win.document.createElement('div'), {
  fetchAsset: async (path) => {
    dedupFetched.push(path);
    /* small delay to maximize race window */
    await new Promise((r) => setTimeout(r, 5));
    return { found: true, mime: 'text/plain', buffer: new Uint8Array([1]).buffer };
  },
  onNavigate: () => {},
});
dedupRenderer.setRunJs(true);
const [u1, u2, u3] = await Promise.all([
  dedupRenderer._getDataUrlForPath('/dedup.txt'),
  dedupRenderer._getDataUrlForPath('/dedup.txt'),
  dedupRenderer._getDataUrlForPath('/dedup.txt'),
]);
ok(u1 === u2 && u2 === u3,
  `nav: concurrent _getDataUrlForPath deduped (same URL: ${u1 === u2 && u2 === u3})`);
ok(dedupFetched.filter((p) => p === '/dedup.txt').length === 1,
  `nav: concurrent _getDataUrlForPath fetched once (fetched ${dedupFetched.filter((p) => p === '/dedup.txt').length} times)`);
dedupRenderer.dispose();

done();
process.exit(process.exitCode || 0);
