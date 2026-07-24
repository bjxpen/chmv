/**
 * Sidebar Component
 * Contains TOC tree, index, and search functionality
 */

import { h, VNodeChild, VNodeChildren } from './Component';
import type { AppState, CHMTOCEntry, CHMIndexEntry } from '../types';
import { ICONS } from './icons';

interface SidebarProps {
  state: AppState;
  onNavigate: (path: string) => void;
}

type SidebarTab = 'toc' | 'index';

let activeTab: SidebarTab = 'toc';
let searchQuery = '';
let expandedPaths: Set<string> = new Set();

export function Sidebar(props: SidebarProps): VNodeChild {
  const { state, onNavigate } = props;
  const { reader } = state;
  
  if (!reader.sidebarVisible) {
    return h('aside', { class: 'sidebar hidden' });
  }
  
  return h('aside', { 
    class: 'sidebar',
    style: `width: ${reader.sidebarWidth}px;`
  }, [
    // Tabs header
    h('div', { class: 'sidebar-header' }, [
      h('div', { class: 'sidebar-tabs' }, [
        h('button', {
          class: `sidebar-tab ${activeTab === 'toc' ? 'active' : ''}`,
          onclick: () => { activeTab = 'toc'; }
        }, 'Contents'),
        h('button', {
          class: `sidebar-tab ${activeTab === 'index' ? 'active' : ''}`,
          onclick: () => { activeTab = 'index'; }
        }, 'Index')
      ])
    ]),
    
    // Search
    h('div', { class: 'sidebar-search' }, [
      h('input', {
        type: 'text',
        placeholder: 'Search...',
        value: searchQuery,
        oninput: (e: Event) => {
          searchQuery = (e.target as HTMLInputElement).value;
        }
      })
    ]),
    
    // Content
    h('div', { class: 'sidebar-content' }, [
      activeTab === 'toc' 
        ? renderTOC(reader.tocEntries, reader.currentChapter, onNavigate)
        : renderIndex(reader.indexEntries, onNavigate)
    ]),
    
    // Resizer
    h('div', { class: 'sidebar-resizer' })
  ]);
}

function renderTOC(entries: CHMTOCEntry[], currentChapter: string | null, onNavigate: (path: string) => void): VNodeChild {
  if (entries.length === 0) {
    return h('div', { class: 'empty-state' }, [
      h('span', { class: 'empty-state-icon', innerHTML: ICONS.book }),
      h('p', {}, 'No table of contents found')
    ]);
  }
  
  const filtered = filterEntries(entries);
  
  return h('nav', { 'aria-label': 'Table of Contents' },
    h('ul', { class: 'toc-tree' },
      renderTOCItems(filtered, currentChapter, onNavigate)
    )
  );
}

function renderTOCItems(entries: CHMTOCEntry[], currentChapter: string | null, onNavigate: (path: string) => void): VNodeChildren {
  return entries.map(entry => {
    const hasChildren = entry.children.length > 0;
    const isExpanded = expandedPaths.has(entry.path);
    const isActive = entry.path === currentChapter;
    
    return h('li', {
      key: entry.path,
      class: 'toc-item'
    }, [
      h('div', {
        class: `toc-item-header ${isActive ? 'active' : ''}`,
        ondblclick: () => {
          if (entry.path) onNavigate(entry.path);
        }
      }, [
        hasChildren ? h('span', {
          class: `toc-toggle ${isExpanded ? 'expanded' : ''}`,
          innerHTML: ICONS.chevronRight,
          on_click: (e: Event) => {
            e.stopPropagation();
            if (isExpanded) {
              expandedPaths.delete(entry.path);
            } else {
              expandedPaths.add(entry.path);
            }
          }
        }) : h('span', { class: 'toc-toggle empty' }),
        h('span', { class: 'toc-name' }, entry.name)
      ]),
      
      hasChildren && isExpanded 
        ? h('ul', { class: 'toc-children' }, 
            renderTOCItems(entry.children, currentChapter, onNavigate)
          )
        : null
    ]);
  });
}

function renderIndex(entries: CHMIndexEntry[], onNavigate: (path: string) => void): VNodeChild {
  if (entries.length === 0) {
    return h('div', { class: 'empty-state' }, [
      h('span', { class: 'empty-state-icon', innerHTML: ICONS.bookmark }),
      h('p', {}, 'No index found')
    ]);
  }
  
  const filtered = filterIndexEntries(entries);
  
  return h('nav', { 'aria-label': 'Keyword Index' },
    h('ul', { class: 'toc-tree' },
      filtered.map(entry => h('li', {
        key: entry.name,
        class: 'toc-item'
      }, [
        h('div', {
          class: 'toc-item-header'
        }, [
          h('span', { class: 'toc-name' }, entry.name)
        ]),
        
        entry.references.length > 0 
          ? h('ul', { class: 'toc-children' },
              entry.references.map(ref => 
                h('li', { key: ref.url, class: 'toc-item' }, [
                  h('div', {
                    class: 'toc-item-header',
                    ondblclick: () => onNavigate(ref.url)
                  }, [
                    h('span', { 
                      class: 'toc-name', 
                      style: 'font-size: 12px; color: var(--text-secondary)' 
                    }, ref.name)
                  ])
                ])
              )
            )
          : null
      ]))
    )
  );
}

function filterEntries(entries: CHMTOCEntry[]): CHMTOCEntry[] {
  if (!searchQuery) return entries;
  
  const query = searchQuery.toLowerCase();
  
  const filter = (items: CHMTOCEntry[]): CHMTOCEntry[] => {
    return items.reduce<CHMTOCEntry[]>((acc, item) => {
      const matchesName = item.name.toLowerCase().includes(query);
      const filteredChildren = filter(item.children);
      
      if (matchesName || filteredChildren.length > 0) {
        acc.push({
          ...item,
          children: filteredChildren
        });
      }
      
      return acc;
    }, []);
  };
  
  return filter(entries);
}

function filterIndexEntries(entries: CHMIndexEntry[]): CHMIndexEntry[] {
  if (!searchQuery) return entries;
  
  const query = searchQuery.toLowerCase();
  
  return entries.filter(entry => 
    entry.name.toLowerCase().includes(query) ||
    entry.references.some(ref => 
      ref.name.toLowerCase().includes(query) ||
      ref.url.toLowerCase().includes(query)
    )
  );
}
