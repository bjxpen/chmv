/**
 * Reader - Content display with navigation
 */

import { h } from './vdom';
import type { VNodeChild } from './vdom';
import type { AppState } from '../types';
import { ICONS } from './icons';
import { store } from '../core/store';
import { typography } from '../core/actions';

interface ReaderProps {
  state: AppState;
  onNavigate: (path: string) => void;
}

export function Reader({ state, onNavigate }: ReaderProps): VNodeChild {
  const { reader } = state;
  const { currentChapter, tocEntries } = reader;

  // Get previous/next chapters
  const flatTOC = flattenTOC(tocEntries);
  const currentIdx = flatTOC.findIndex(e => e.path === currentChapter);
  const prevChapter = currentIdx > 0 ? flatTOC[currentIdx - 1] : null;
  const nextChapter = currentIdx >= 0 && currentIdx < flatTOC.length - 1 ? flatTOC[currentIdx + 1] : null;

  return h('main', { class: 'reader-container' }, [
    // Top navigation
    h('div', { class: 'reader-nav reader-nav-top' }, [
      prevChapter 
        ? h('button', { class: 'nav-btn', onClick: () => onNavigate(prevChapter!.path) }, [
            ICONS.arrowLeft, ' Previous'
          ])
        : h('span', {}),
      nextChapter 
        ? h('button', { class: 'nav-btn', onClick: () => onNavigate(nextChapter!.path) }, [
            'Next ', ICONS.arrowRight
          ])
        : h('span', {})
    ]),
    
    // Content
    h('div', { class: 'reader-content' }, [
      h('iframe', {
        id: 'chm-content',
        class: 'content-frame',
        sandbox: 'allow-same-origin allow-scripts',
        srcdoc: (window as unknown as { __chmContent?: string }).__chmContent ?? ''
      })
    ]),
    
    // Bottom navigation
    h('div', { class: 'reader-nav reader-nav-bottom' }, [
      prevChapter 
        ? h('button', { class: 'nav-btn', onClick: () => onNavigate(prevChapter!.path) }, [
            ICONS.arrowLeft, ' Previous'
          ])
        : h('span', {}),
      h('div', { class: 'font-controls' }, [
        h('button', { 
          class: 'font-btn', 
          onClick: () => store.dispatch(typography.fontSize(reader.typography.fontSize - 1))
        }, ['A-']),
        h('button', { 
          class: 'font-btn', 
          onClick: () => store.dispatch(typography.fontSize(reader.typography.fontSize + 1))
        }, ['A+'])
      ]),
      nextChapter 
        ? h('button', { class: 'nav-btn', onClick: () => onNavigate(nextChapter!.path) }, [
            'Next ', ICONS.arrowRight
          ])
        : h('span', {})
    ])
  ]);
}

function flattenTOC(entries: import('../types').CHMTOCEntry[]): import('../types').CHMTOCEntry[] {
  const result: import('../types').CHMTOCEntry[] = [];
  const walk = (items: import('../types').CHMTOCEntry[]) => {
    for (const item of items) {
      if (item.path) result.push(item);
      if (item.children.length) walk(item.children);
    }
  };
  walk(entries);
  return result;
}
