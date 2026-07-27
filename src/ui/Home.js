/*
 * ui/Home.js — library screen: dropzone + recent-files shelf.
 */

'use strict';

import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { UploadIcon } from './icons.js';

const fmtSize = (bytes = 0) => {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KB`;
  return `${bytes} B`;
};

const fmtWhen = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
};

/** Native picker with File System Access API when available. */
export async function pickChmFile(onFile) {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Compiled HTML Help', accept: { 'application/vnd.ms-htmlhelp': ['.chm'] } }],
      });
      onFile(await handle.getFile(), handle);
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      /* fall back to <input type=file> */
    }
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.chm,application/vnd.ms-htmlhelp,application/octet-stream';
  input.onchange = () => input.files[0] && onFile(input.files[0], null);
  input.click();
}

const ShelfCard = ({ row, onOpen, onRemove }) => {
  const pct = Math.round((row.progress || 0) * 100);
  return html`
    <div class="shelf-card" role="button" tabindex="0"
         onClick=${() => onOpen(row)}
         onKeyDown=${(e) => e.key === 'Enter' && onOpen(row)}>
      <h3>${row.title || row.fileName}</h3>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%" /></div>
      <div class="shelf-meta">
        <span>${pct}% · ${fmtSize(row.fileSize)}</span>
        <span>${fmtWhen(row.lastOpened)}</span>
      </div>
      <button class="shelf-remove" title="Remove from history"
              aria-label="Remove ${row.title || row.fileName} from history"
              onClick=${(e) => { e.stopPropagation(); onRemove(row.hash); }}>×</button>
    </div>`;
};

export const Home = ({ store }) => {
  const [dragover, setDragover] = useState(false);
  const rows = store.shelf.value;
  const openPicked = (file, handle) => store.openFile(file, handle);

  useEffect(() => {
    let depth = 0;
    const enter = (e) => { e.preventDefault(); depth++; setDragover(true); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDragover(false); } };
    const over = (e) => e.preventDefault();
    const drop = async (e) => {
      e.preventDefault();
      depth = 0;
      setDragover(false);
      /* On file:// Chrome blocks OS file drops — dataTransfer.files is
       * empty even though the drop event fires. Detect this and show a
       * helpful message instead of silently failing. */
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) {
        if (location.protocol === 'file:') {
          store.notify('Drag-and-drop is blocked on file:// — use "Choose file…" button instead.', 6000);
        }
        return;
      }
      const item = e.dataTransfer?.items?.[0];
      let handle = null;
      if (item?.getAsFileSystemHandle) {
        try { handle = await item.getAsFileSystemHandle(); } catch { /* ignore */ }
        if (handle?.kind !== 'file') handle = null;
      }
      openPicked(files[0], handle);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => { store.refreshShelf(); }, []);

  return html`
    <main id="home" class="screen">
      <div class="home-inner">
        <header class="home-header">
          <div class="home-brand">
            <img src="icons/icon.svg" alt="" width="44" height="44" />
            <div>
              <h1>chmv</h1>
              <p>CHM reader · 100% local, nothing leaves your device</p>
            </div>
          </div>
        </header>

        <div class="dropzone ${dragover ? 'dragover' : ''}" tabindex="0" role="button"
             aria-label="Open a CHM file by dropping it here or pressing Enter"
             onClick=${() => pickChmFile(openPicked)}
             onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickChmFile(openPicked))}>
          <${UploadIcon} />
          <p class="dz-title">Drop a <strong>.chm</strong> file here</p>
          <p class="dz-sub">or</p>
          <button class="btn primary" type="button"
                  onClick=${(e) => { e.stopPropagation(); pickChmFile(openPicked); }}>
            Choose file…
          </button>
        </div>

        <section class="shelf" aria-labelledby="shelf-title">
          <div class="shelf-head"><h2 id="shelf-title">Recent files</h2></div>
          ${rows.length
            ? html`<div class="shelf-list">
                ${rows.map((row) => html`
                  <${ShelfCard} key=${row.hash} row=${row}
                    onOpen=${(r) => store.reopenFromShelf(r, () => pickChmFile(openPicked))}
                    onRemove=${(hash) => store.removeFromShelf(hash)} />`)}
              </div>`
            : html`<p class="shelf-empty">Nothing here yet — open a CHM file to start reading.</p>`}
        </section>

        <footer class="home-foot">
          <p>Legacy CJK novels and modern documentation both welcome.
             Encodings: GBK · GB18030 · Big5 · Shift-JIS · UTF-8.
             Works fully offline once installed.</p>
        </footer>
      </div>
    </main>`;
};
