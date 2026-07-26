/*
 * ui/use-chapter-view.js — glue between the imperative Renderer (shadow
 * DOM, blob lifecycles) and the reactive store. Owns section bookkeeping
 * for continuous-scroll mode and exposes the view capabilities the store
 * needs via store.connectView().
 */

'use strict';

import { useEffect, useRef } from 'preact/hooks';
import { Renderer } from '../reader/renderer.js';

const MAX_MOUNTED_SECTIONS = 6;

/** Owns the imperative Renderer + scroller; exposes view ops to the store. */
export function useChapterView(store, hostRef, scrollerRef) {
  const view = useRef({ renderer: null, sections: [], loadingNext: false });

  useEffect(() => {
    const renderer = new Renderer(hostRef.current, {
      fetchAsset: (path) => store.fetchAsset(path),
      onNavigate: (path, fragment) => store.navigateTo(path, { fragment }),
    });
    renderer.setStyleOverride(store.settings.value.overrideStyles);
    renderer.setRunJs(store.settings.value.runJs);
    view.current.renderer = renderer;

    store.connectView({
      reset: () => {
        renderer.dispose();
        view.current.sections = [];
      },
      renderChapter: async (path, bytes, { fragment = '', scrollTo = 0 } = {}) => {
        const info = store.book.value;
        renderer.setEncodings(info?.encoding, store.encodingOverride.value || null);
        const section = await renderer.renderChapter(path, bytes);
        view.current.sections = [{ path, el: section }];
        const scroller = scrollerRef.current;
        if (fragment && renderer.scrollToFragment(section, fragment)) {
        } else if (scrollTo && typeof scrollTo === 'object') {
          scroller.scrollTop = (scrollTo.ratio || 0) * scroller.scrollHeight;
        } else {
          scroller.scrollTop = scrollTo || 0;
        }
        scroller.focus({ preventScroll: true });
        return section;
      },
      getScrollState: () => {
        const scroller = scrollerRef.current;
        if (!scroller) return { scroll: 0, ratio: 0 };
        const range = scroller.scrollHeight - scroller.clientHeight;
        let scroll = scroller.scrollTop;
        const current = view.current.sections.find((s) => s.path === store.currentPath.value);
        if (current && view.current.sections.length > 1) {
          scroll = Math.max(0, scroller.getBoundingClientRect().top - current.el.getBoundingClientRect().top);
        }
        return { scroll, ratio: range > 0 ? scroller.scrollTop / range : 1 };
      },
    });

    return () => renderer.dispose();
  }, []);

  /* style override toggle → re-render current chapter */
  const overrideStyles = store.settings.value.overrideStyles;
  useEffect(() => {
    const r = view.current.renderer;
    if (!r || r.overrideStyles === overrideStyles) return;
    r.setStyleOverride(overrideStyles);
    if (store.currentPath.value) {
      const keep = scrollerRef.current?.scrollTop ?? 0;
      store.navigateTo(store.currentPath.value, { scrollTo: keep });
    }
  }, [overrideStyles]);

  /* run-js toggle → re-render current chapter */
  const runJs = store.settings.value.runJs;
  useEffect(() => {
    const r = view.current.renderer;
    if (!r || r.runJs === runJs) return;
    r.setRunJs(runJs);
    if (store.currentPath.value) {
      const keep = scrollerRef.current?.scrollTop ?? 0;
      store.navigateTo(store.currentPath.value, { scrollTo: keep });
    }
  }, [runJs]);

  /* continuous scroll: append next chapter near the bottom, prune far ones */
  const onScroll = async () => {
    store.scheduleSave();
    if (store.settings.value.scrollMode !== 'infinite') return;
    const { sections } = view.current;
    const scroller = scrollerRef.current;
    if (!scroller || !sections.length) return;

    const top = scroller.getBoundingClientRect().top + 8;
    const visible = sections.reduce(
      (acc, s) => (s.el.getBoundingClientRect().top <= top ? s.path : acc),
      sections[0].path,
    );
    store.setVisiblePath(visible);

    if (view.current.loadingNext) return;
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1200) return;

    view.current.loadingNext = true;
    try {
      const next = await store.fetchSibling(sections[sections.length - 1].path, 1);
      if (next) {
        const section = await view.current.renderer.appendChapter(
          next.path, next.bytes, { divider: true, title: next.label });
        sections.push({ path: next.path, el: section });
        while (sections.length > MAX_MOUNTED_SECTIONS) {
          const first = sections.shift();
          const h = first.el.getBoundingClientRect().height +
            (first.el._divider?.getBoundingClientRect().height ?? 0);
          view.current.renderer.removeSection(first.el);
          scroller.scrollTop -= h;
        }
      }
    } catch (err) {
      console.warn('continuous scroll load failed', err);
    } finally {
      view.current.loadingNext = false;
    }
  };

  return { onScroll };
}