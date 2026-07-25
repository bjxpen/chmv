/*
 * ui/App.js — root component: screen switching, toast, global shortcuts.
 */

'use strict';

import { useEffect } from 'preact/hooks';
import { html } from './html.js';
import { Home } from './Home.js';
import { Reader } from './Reader.js';
import { clampFontSize } from '../services/settings.js';

const isEditable = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

const useShortcuts = (store) => {
  useEffect(() => {
    const onKey = (e) => {
      const inReader = store.screen.value === 'reader';

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (!inReader) return;
        const size = store.settings.value.fontSize;
        const patch = { '=': 1, '+': 1, '-': -1 }[e.key];
        if (patch) {
          e.preventDefault();
          store.updateSettings({ fontSize: clampFontSize(size + patch) });
        } else if (e.key === '0') {
          e.preventDefault();
          store.updateSettings({ fontSize: 19 });
        }
        return;
      }
      if (!inReader || isEditable(e.target)) return;

      const scroller = document.querySelector('.scroller');
      const actions = {
        ArrowRight: () => store.gotoSibling(1),
        j: () => store.gotoSibling(1),
        J: () => store.gotoSibling(1),
        ArrowLeft: () => store.gotoSibling(-1),
        k: () => store.gotoSibling(-1),
        K: () => store.gotoSibling(-1),
        ' ': () => scroller?.scrollBy({
          top: scroller.clientHeight * 0.88 * (e.shiftKey ? -1 : 1),
          behavior: 'smooth',
        }),
        b: () => store.updateSettings({ sidebarHidden: !store.settings.value.sidebarHidden }),
        B: () => store.updateSettings({ sidebarHidden: !store.settings.value.sidebarHidden }),
        f: () => (store.focusMode.value = !store.focusMode.value),
        F: () => (store.focusMode.value = !store.focusMode.value),
        Escape: () => (store.focusMode.value ? (store.focusMode.value = false) : store.goHome()),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
};

export const App = ({ store }) => {
  useShortcuts(store);

  /* project focus/sidebar state onto <body> classes (CSS hooks) */
  const { sidebarHidden } = store.settings.value;
  const focus = store.focusMode.value;
  useEffect(() => {
    document.body.classList.toggle('sidebar-hidden', sidebarHidden);
    document.body.classList.toggle('focus-mode', focus);
  }, [sidebarHidden, focus]);

  return html`
    ${store.screen.value === 'home'
      ? html`<${Home} store=${store} />`
      : html`<${Reader} store=${store} />`}
    ${store.toast.value && html`
      <div class="toast" role="status" aria-live="polite">${store.toast.value.text}</div>`}`;
};
