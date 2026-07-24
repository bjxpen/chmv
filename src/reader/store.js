/*
 * reader/store.js — application state (Preact signals) and actions.
 *
 * The store is created by `createStore(deps)` with its collaborators
 * injected ({ engine factory, library, hashFile }), keeping components
 * flat: UI components read signals and call actions; services never
 * reach into the UI.
 */

'use strict';

import { signal, computed, batch } from '@preact/signals';
import { settings, updateSettings } from '../services/settings.js';

export function createStore({ createEngine, library, hashFile }) {
  /* ---------------- state ---------------- */

  const screen = signal('home');            /* 'home' | 'reader' */
  const shelf = signal([]);                 /* recent-file records */
  const book = signal(null);                /* BookInfo from the engine */
  const bookTitle = signal('');
  const toc = signal({ tocTree: [], indexList: [] });
  const spine = signal([]);                 /* ordered doc paths */
  const currentPath = signal(null);
  const encodingOverride = signal('');      /* '' = auto */
  const loading = signal(null);             /* status text or null */
  const toast = signal(null);               /* { text, id } or null */
  const focusMode = signal(false);
  const activeTocPath = signal(null);       /* highlighted sidebar node */

  const spineIndex = computed(
    () => new Map(spine.value.map((p, i) => [p.toLowerCase(), i])),
  );
  const currentPos = computed(() => {
    const p = currentPath.value;
    return p ? (spineIndex.value.get(p.toLowerCase()) ?? -1) : -1;
  });
  const hasPrev = computed(() => currentPos.value > 0);
  const hasNext = computed(
    () => currentPos.value >= 0 && currentPos.value < spine.value.length - 1,
  );

  /* per-book session (not reactive) */
  let session = { engine: null, file: null, hash: null, navToken: 0, saveTimer: 0 };

  /* set by the reader view (DI in the other direction: view capabilities
   * the store needs, without the store knowing DOM details) */
  let view = {
    renderChapter: async () => null,   /* (path, bytes, {fragment, scrollTo}) */
    getScrollState: () => ({ scroll: 0, ratio: 0 }),
    reset: () => {},
  };
  const connectView = (v) => { view = { ...view, ...v }; };

  /* ---------------- helpers ---------------- */

  let toastId = 0;
  const notify = (text, ms = 3200) => {
    const id = ++toastId;
    toast.value = { text, id };
    setTimeout(() => {
      if (toast.value && toast.value.id === id) toast.value = null;
    }, ms);
  };

  const tocLabelOf = (path) => {
    const find = (nodes) => {
      for (const n of nodes) {
        if (n.local && n.local.toLowerCase() === path.toLowerCase()) return n.name;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(toc.value.tocTree) || path.split('/').pop();
  };

  const buildSpine = (info) => {
    const seen = new Set();
    const out = [];
    const push = (p) => {
      const k = p.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    };
    const walk = (nodes) => nodes.forEach((n) => {
      if (n.local) push(n.local);
      walk(n.children);
    });
    walk(info.tocTree);          /* TOC order wins… */
    info.docPaths.forEach(push); /* …then alphabetical leftovers */
    return out;
  };

  /* ---------------- persistence ---------------- */

  const refreshShelf = async () => {
    shelf.value = await library.listBooks().catch(() => []);
  };

  const saveProgress = async () => {
    if (!session.hash || !currentPath.value) return;
    const { scroll, ratio } = view.getScrollState();
    const pos = currentPos.value;
    const progress = Math.max(0, Math.min(1,
      (pos + Math.min(1, ratio)) / Math.max(1, spine.value.length)));

    const record = (await library.getBook(session.hash)) || { hash: session.hash };
    await library.putBook({
      ...record,
      fileName: session.file?.name ?? record.fileName,
      title: bookTitle.value,
      fileSize: session.file?.size ?? record.fileSize,
      chapter: currentPath.value,
      scroll,
      progress,
      encoding: encodingOverride.value,
      lastOpened: Date.now(),
    }).catch(() => {});
  };

  const scheduleSave = () => {
    clearTimeout(session.saveTimer);
    session.saveTimer = setTimeout(saveProgress, 800);
  };

  /* ---------------- actions ---------------- */

  const openFile = async (file, handle = null) => {
    if (!file) return;
    if (!/\.chm$/i.test(file.name)) {
      notify('File does not end in .chm — trying to parse it anyway…');
    }

    batch(() => {
      screen.value = 'reader';
      loading.value = `Parsing ${file.name}…`;
      bookTitle.value = file.name;
      currentPath.value = null;
    });
    session.engine?.terminate();
    session = { ...session, engine: null, file: null, hash: null };
    session.navToken++;
    view.reset();

    try {
      const hash = await hashFile(file);
      const saved = await library.getBook(hash);
      const engine = createEngine();
      const override = saved?.encoding || '';
      const info = await engine.open(file, override || null);

      const title = info.title || file.name.replace(/\.chm$/i, '');
      session = { ...session, engine, file, hash };

      batch(() => {
        book.value = info;
        bookTitle.value = title;
        encodingOverride.value = override;
        toc.value = { tocTree: info.tocTree, indexList: info.indexList };
        spine.value = buildSpine(info);
      });
      document.title = `${title} · chmv`;

      await library.putBook({
        chapter: null, scroll: 0, progress: 0, firstOpened: Date.now(),
        ...saved,
        hash, fileName: file.name, title,
        fileSize: file.size, lastOpened: Date.now(), encoding: override,
      });
      if (handle) await library.putHandle(hash, handle);

      const target = saved?.chapter && spineIndex.value.has(saved.chapter.toLowerCase())
        ? saved.chapter
        : spine.value[0];
      if (!target) {
        loading.value = null;
        notify('This CHM contains no HTML documents.');
        return;
      }
      const resume = saved?.chapter === target ? saved.scroll : 0;
      await navigateTo(target, { scrollTo: resume });
      if (resume > 4) notify('Resumed where you left off.');
    } catch (err) {
      console.error(err);
      loading.value = null;
      notify(`Could not open file: ${err.message}`, 6000);
      goHome();
    }
  };

  const navigateTo = async (path, { fragment = '', scrollTo = 0 } = {}) => {
    if (!session.engine) return;
    const token = ++session.navToken;
    loading.value = 'Loading chapter…';

    let asset;
    try {
      asset = await session.engine.get(path);
    } catch (err) {
      loading.value = null;
      notify(`Failed to load ${path}: ${err.message}`);
      return;
    }
    if (token !== session.navToken) return; /* superseded */
    if (!asset.found) {
      loading.value = null;
      notify(`Not found in archive: ${path}`);
      return;
    }
    if (!asset.isHtml) {
      /* non-HTML target (image, txt, …): open standalone */
      const url = URL.createObjectURL(new Blob([asset.buffer], { type: asset.mime }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      loading.value = null;
      return;
    }

    await view.renderChapter(path, new Uint8Array(asset.buffer), { fragment, scrollTo });
    if (token !== session.navToken) return;

    batch(() => {
      currentPath.value = path;
      activeTocPath.value = path;
      loading.value = null;
    });
    scheduleSave();
  };

  const gotoSibling = (delta, fromPath = currentPath.value) => {
    const pos = fromPath ? (spineIndex.value.get(fromPath.toLowerCase()) ?? -1) : -1;
    if (pos < 0) return;
    const next = pos + delta;
    if (next < 0) return notify('Already at the first chapter.');
    if (next >= spine.value.length) return notify('Already at the last chapter.');
    navigateTo(spine.value[next]);
  };

  /** Fetch the chapter after `path` for continuous scroll (no state change). */
  const fetchSibling = async (path, delta) => {
    const pos = spineIndex.value.get(path.toLowerCase()) ?? -1;
    const nextPath = spine.value[pos + delta];
    if (pos < 0 || !nextPath || !session.engine) return null;
    const asset = await session.engine.get(nextPath);
    return asset.found && asset.isHtml
      ? { path: nextPath, bytes: new Uint8Array(asset.buffer), label: tocLabelOf(nextPath) }
      : null;
  };

  const switchEncoding = async (value) => {
    encodingOverride.value = value || '';
    if (!session.engine || !book.value) return;
    try {
      const maps = await session.engine.sitemaps(value || book.value.encoding);
      toc.value = maps;
    } catch { /* keep current trees */ }
    if (currentPath.value) {
      const { ratio } = view.getScrollState();
      await navigateTo(currentPath.value, { scrollTo: { ratio } });
    }
    scheduleSave();
  };

  /** Mark the chapter nearest the viewport top (continuous scroll). */
  const setVisiblePath = (path) => {
    if (path && path !== currentPath.value) {
      batch(() => {
        currentPath.value = path;
        activeTocPath.value = path;
      });
    }
    scheduleSave();
  };

  const reopenFromShelf = async (row, fallbackPicker) => {
    const handle = await library.getHandle(row.hash);
    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'read' });
        if (perm === 'granted') return openFile(await handle.getFile(), handle);
      } catch { /* fall through */ }
    }
    notify(`Pick “${row.fileName}” again — the browser can't reopen files without permission.`);
    fallbackPicker?.();
  };

  const removeFromShelf = async (hash) => {
    await library.deleteBook(hash);
    refreshShelf();
  };

  const goHome = () => {
    saveProgress();
    batch(() => {
      screen.value = 'home';
      focusMode.value = false;
    });
    document.title = 'chmv · CHM Reader';
    refreshShelf();
  };

  /* asset fetcher used by the shadow-DOM renderer */
  const fetchAsset = (path) => session.engine
    ? session.engine.get(path)
    : Promise.resolve({ found: false });

  /* flush progress when the tab hides/closes */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
  });
  window.addEventListener('pagehide', saveProgress);

  return {
    /* state (signals) */
    screen, shelf, book, bookTitle, toc, spine, currentPath, encodingOverride,
    loading, toast, focusMode, activeTocPath,
    currentPos, hasPrev, hasNext,
    settings, /* re-exported for convenience */

    /* actions */
    openFile, navigateTo, gotoSibling, fetchSibling, switchEncoding,
    setVisiblePath, reopenFromShelf, removeFromShelf, goHome, refreshShelf,
    saveProgress, scheduleSave, notify, updateSettings,
    tocLabelOf, connectView, fetchAsset,
  };
}
