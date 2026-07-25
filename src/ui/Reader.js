/*
 * ui/Reader.js — reading screen: topbar, sidebar, content column,
 * settings popover. The shadow-DOM chapter renderer stays imperative
 * (it manages blob lifecycles); this component owns it via a ref and
 * connects it to the store with `store.connectView(...)`.
 */

'use strict';

import { useRef, useState } from 'preact/hooks';
import { html } from './html.js';
import { useChapterView } from './use-chapter-view.js';
import { Sidebar } from './Sidebar.js';
import { SettingsPanel } from './Settings.js';
import { UI_ENCODINGS } from '../engine/encodings.js';
import { HomeIcon, SidebarIcon, FocusIcon, UnfocusIcon, GearIcon } from './icons.js';

const NavButtons = ({ store, edge }) => {
  const pos = store.currentPos.value;
  const spine = store.spine.value;
  const prevLabel = pos > 0 ? store.tocLabelOf(spine[pos - 1]) : '';
  const nextLabel = pos >= 0 && pos < spine.length - 1 ? store.tocLabelOf(spine[pos + 1]) : '';
  return html`
  <button class="nav-btn ${edge === 'bottom' ? 'labeled' : ''}"
          disabled=${!store.hasPrev.value} title=${prevLabel || 'Previous chapter (←)'}
          onClick=${() => store.gotoSibling(-1)}>
    ${edge === 'top' ? '‹ Prev' : `‹ ${prevLabel || 'Previous chapter'}`}
  </button>
  ${edge === 'top' && html`
    <span class="nav-pos">
      ${pos >= 0
        ? `${pos + 1} / ${spine.length}` +
          ` · ${Math.round(((pos + 1) / Math.max(1, spine.length)) * 100)}%` +
          ` · ${store.tocLabelOf(store.currentPath.value)}`
        : ''}
    </span>`}
  <button class="nav-btn ${edge === 'bottom' ? 'labeled' : ''}"
          disabled=${!store.hasNext.value} title=${nextLabel || 'Next chapter (→)'}
          onClick=${() => store.gotoSibling(1)}>
    ${edge === 'top' ? 'Next ›' : `${nextLabel || 'Next chapter'} ›`}
  </button>`;
};

const Splitter = ({ store }) => {
  const onPointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId);
    e.target.classList.add('dragging');
  };
  const onPointerMove = (e) => {
    if (!e.target.hasPointerCapture?.(e.pointerId)) return;
    const w = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.6);
    store.updateSettings({ sidebarWidth: Math.round(w) });
  };
  const onPointerUp = (e) => e.target.classList.remove('dragging');
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 40 : 12) * (e.key === 'ArrowLeft' ? -1 : 1);
    const w = Math.min(Math.max(store.settings.value.sidebarWidth + step, 180), Math.round(window.innerWidth * 0.6));
    store.updateSettings({ sidebarWidth: w });
  };
  return html`
    <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
         tabindex="0" onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
         onPointerUp=${onPointerUp} onPointerCancel=${onPointerUp} onKeyDown=${onKeyDown} />`;
};

export const Reader = ({ store }) => {
  const hostRef = useRef(null);
  const scrollerRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { onScroll } = useChapterView(store, hostRef, scrollerRef);

  const s = store.settings.value;
  const focus = store.focusMode.value;
  const toggleSidebar = () => store.updateSettings({ sidebarHidden: !s.sidebarHidden });

  /* rAF-throttled scroll events */
  const rafPending = useRef(false);
  const handleScroll = () => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      onScroll();
    });
  };

  return html`
    <div id="reader" class="screen">
      <header class="topbar">
        <div class="topbar-group">
          <button class="icon-btn" title="Back to library (Esc)" aria-label="Back to library"
                  onClick=${() => store.goHome()}><${HomeIcon} /></button>
          <button class="icon-btn" title="Toggle sidebar (B)" aria-label="Toggle sidebar"
                  aria-pressed=${!s.sidebarHidden} onClick=${toggleSidebar}><${SidebarIcon} /></button>
          <div class="book-heading">
            <span class="book-title" role="heading" aria-level="1">${store.bookTitle.value}</span>
            ${store.currentPath.value && html`
              <span class="book-subtitle">${store.tocLabelOf(store.currentPath.value)}</span>`}
          </div>
        </div>
        <div class="topbar-group">
          <label class="enc-label" title="Text encoding"><span aria-hidden="true">文A</span></label>
          <select class="select" aria-label="Text encoding"
                  value=${store.encodingOverride.value}
                  onChange=${(e) => store.switchEncoding(e.target.value)}>
            ${UI_ENCODINGS.map((enc) => html`
              <option value=${enc.value}>
                ${enc.value === '' ? `Auto (${store.book.value?.encoding ?? 'utf-8'})` : enc.label}
              </option>`)}
          </select>
          <button class="icon-btn" title="Distraction-free mode (F)" aria-pressed=${focus}
                  aria-label="Distraction-free mode"
                  onClick=${() => (store.focusMode.value = !focus)}><${FocusIcon} /></button>
          <button class="icon-btn" title="Reading settings" aria-expanded=${settingsOpen}
                  aria-label="Reading settings"
                  onClick=${(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); }}>
            <${GearIcon} />
          </button>
        </div>
      </header>

      <div class="reader-body">
        <${Sidebar} store=${store} />
        <${Splitter} store=${store} />
        <div class="content-col">
          <nav class="chapter-nav top" aria-label="Chapter navigation (top)">
            <${NavButtons} store=${store} edge="top" />
          </nav>
          <div class="scroller" tabindex="0" ref=${scrollerRef} onScroll=${handleScroll}>
            <div class="reading-measure">
              <div ref=${hostRef} />
              ${store.loading.value && html`
                <div class="loading"><div class="spinner" /><span>${store.loading.value}</span></div>`}
            </div>
            <nav class="chapter-nav bottom" aria-label="Chapter navigation (bottom)">
              <${NavButtons} store=${store} edge="bottom" />
            </nav>
          </div>
        </div>
      </div>

      ${focus && html`
        <div class="focus-exit">
          <button class="icon-btn" title="Exit distraction-free mode (F)"
                  aria-label="Exit distraction-free mode"
                  onClick=${() => (store.focusMode.value = false)}><${UnfocusIcon} /></button>
        </div>`}

      ${settingsOpen && html`<${SettingsPanel} store=${store} onClose=${() => setSettingsOpen(false)} />`}
    </div>`;
};
