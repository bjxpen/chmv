/**
 * Sidebar - Navigation with TOC and Index
 */

import { h, each, when } from './vdom';
import type { VNodeChild } from './vdom';
import type { AppState, CHMTOCEntry } from '../types';
import { ICONS } from './icons';

interface SidebarProps {
  state: AppState;
  onNavigate: (path: string) => void;
}

export function Sidebar({ state, onNavigate }: SidebarProps): VNodeChild {
  const { reader: readerState } = state;
  const { tocEntries, currentChapter, sidebarVisible, sidebarWidth } = readerState;

  if (!sidebarVisible) return null;

  return h('aside', { 
    class: 'sidebar',
    style: { width: `${sidebarWidth}px` }
  }, [
    h('div', { class: 'sidebar-search' }, [
      h('input', {
        type: 'text',
        class: 'search-input',
        placeholder: 'Search chapters...'
      })
    ]),
    h('div', { class: 'sidebar-content' }, [
      h('ul', { class: 'toc-tree' }, 
        each(tocEntries, (entry) => TOCItem({ entry, currentChapter, onNavigate }))
      )
    ])
  ]);
}

interface TOCItemProps {
  entry: CHMTOCEntry;
  currentChapter: string | null;
  onNavigate: (path: string) => void;
}

function TOCItem({ entry, currentChapter, onNavigate }: TOCItemProps): VNodeChild {
  const isActive = entry.path === currentChapter;
  const hasChildren = entry.children.length > 0;

  return h('li', { class: 'toc-item' }, [
    h('div', {
      class: `toc-item-header ${isActive ? 'active' : ''}`,
      onClick: () => entry.path && onNavigate(entry.path)
    }, [
      entry.path ? h('span', { class: 'toc-name' }, [entry.name]) : h('span', { class: 'toc-name toc-folder' }, [entry.name])
    ]),
    when(hasChildren, h('ul', { class: 'toc-children' }, 
      each(entry.children, (child) => TOCItem({ entry: child, currentChapter, onNavigate }))
    ))
  ]);
}
