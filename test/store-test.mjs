// Store integration test: exercises open/navigate/encoding-switch flows
// against a fake engine + in-memory library (no worker, no IndexedDB).
// Runs in Node with happy-dom globals — possible because the store gets
// all collaborators via dependency injection.
import { makeAsserter, bootstrapDom } from './helpers.mjs';

/* -- bootstrap DOM globals before importing app modules -------------- */
const win = await bootstrapDom();
try { globalThis.URL = win.URL; } catch { /* read-only */ }

const { createStore } = await import('../src/reader/store.js');

/* -- fakes ------------------------------------------------------------ */
const docs = {
  '/a.htm': '<html><body><p>Chapter A</p></body></html>',
  '/b.htm': '<html><body><p>Chapter B</p></body></html>',
  '/c.htm': '<html><body><p>Chapter C</p></body></html>',
};

const enc = new TextEncoder();

const fakeEngine = () => ({
  open: async () => {
    return {
      title: 'Test Book',
      encoding: 'gbk',
      encodingSource: 'lcid',
      tocTree: [
        { id: 0, name: 'A', local: '/a.htm', children: [
          { id: 1, name: 'B', local: '/b.htm', children: [] },
        ] },
      ],
      indexList: [{ name: 'beta', targets: ['/b.htm'] }],
      docPaths: Object.keys(docs),
      entryCount: 3,
      fileSize: 100,
      compression: true,
    };
  },
  get: async (path) => docs[path]
    ? { path, found: true, isHtml: true, mime: 'text/html', buffer: enc.encode(docs[path]).buffer }
    : { path, found: false },
  sitemaps: async () => ({ tocTree: [], indexList: [] }),
  dropCaches: async () => {},
  close: async () => {},
  terminate: () => {},
});

const books = new Map();
const fakeLibrary = {
  getBook: async (h) => books.get(h) ?? null,
  putBook: async (r) => books.set(r.hash, r),
  deleteBook: async (h) => books.delete(h),
  listBooks: async () => [...books.values()],
  putHandle: async () => {},
  getHandle: async () => null,
};

const fakeHash = async () => 'deadbeef';

/* -- run -------------------------------------------------------------- */
const rendered = [];
const store = createStore({ createEngine: fakeEngine, library: fakeLibrary, hashFile: fakeHash });
store.connectView({
  renderChapter: async (path, bytes) => {
    rendered.push({ path, text: new TextDecoder().decode(bytes) });
    return {};
  },
  getScrollState: () => ({ scroll: 42, ratio: 0.5 }),
  reset: () => {},
});

const { ok, done } = makeAsserter('store tests');

const file = { name: 'novel.chm', size: 100, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
await store.openFile(file);

ok(store.screen.value === 'reader', 'store: switches to reader');
ok(store.bookTitle.value === 'Test Book', 'store: uses #SYSTEM title');
ok(store.spine.value.join(',') === '/a.htm,/b.htm,/c.htm', 'store: spine = TOC order + leftovers');
ok(store.currentPath.value === '/a.htm', 'store: opens first chapter');
ok(rendered.length === 1 && rendered[0].text.includes('Chapter A'), 'store: rendered chapter A');
ok(store.hasPrev.value === false && store.hasNext.value === true, 'store: nav flags at start');

store.gotoSibling(1);
await new Promise((r) => setTimeout(r, 10));
ok(store.currentPath.value === '/b.htm', 'store: next chapter navigates');
ok(store.hasPrev.value === true, 'store: hasPrev after move');

/* sibling prefetch for continuous scroll */
const next = await store.fetchSibling('/b.htm', 1);
ok(next?.path === '/c.htm' && next.label, 'store: fetchSibling returns next doc');
const none = await store.fetchSibling('/c.htm', 1);
ok(none === null, 'store: fetchSibling at end returns null');

/* progress persistence */
await store.saveProgress();
const rec = books.get('deadbeef');
ok(rec && rec.chapter === '/b.htm' && rec.scroll === 42, 'store: progress saved');
ok(rec.progress > 0.3 && rec.progress < 0.7, 'store: progress fraction sane');

/* resume on reopen */
const store2 = createStore({ createEngine: fakeEngine, library: fakeLibrary, hashFile: fakeHash });
const rendered2 = [];
store2.connectView({
  renderChapter: async (path, bytes, { scrollTo }) => { rendered2.push({ path, scrollTo }); return {}; },
  getScrollState: () => ({ scroll: 0, ratio: 0 }),
  reset: () => {},
});
await store2.openFile(file);
ok(store2.currentPath.value === '/b.htm', 'store: restores last chapter');
ok(rendered2[0].scrollTo === 42, 'store: restores scroll position');

/* encoding switch re-renders */
const before = rendered2.length;
await store2.switchEncoding('big5');
ok(store2.encodingOverride.value === 'big5', 'store: encoding override set');
ok(rendered2.length === before + 1, 'store: encoding switch re-renders in place');

/* shelf */
await store2.saveProgress(); /* flush the debounced save */
const shelfRows = await fakeLibrary.listBooks();
ok(shelfRows.length === 1 && shelfRows[0].encoding === 'big5', 'store: shelf row updated with encoding');

done();
process.exit(process.exitCode || 0);
