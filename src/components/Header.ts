/**
 * Header Component
 * Application header with file name, controls, and encoding selector
 */

import { h, VNodeChild } from './Component';
import type { AppState, EncodingType } from '../types';
import { ENCODING_OPTIONS } from '../types';
import { store, actions } from '../stores/appStore';
import { ICONS } from './icons';

interface HeaderProps {
  state: AppState;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

export function Header(props: HeaderProps): VNodeChild {
  const { state, onOpenSettings, onToggleSidebar } = props;
  const { reader } = state;
  
  const encodingLabel = ENCODING_OPTIONS.find(e => e.id === reader.encoding)?.label || 'UTF-8';
  
  return h('header', { class: 'header' }, [
    // Toggle sidebar button
    h('button', {
      class: 'btn btn-icon',
      'aria-label': 'Toggle sidebar',
      onclick: onToggleSidebar
    }, [
      h('span', { innerHTML: ICONS.menu })
    ]),
    
    // File title
    h('h1', { class: 'header-title' }, 
      reader.chmFile?.name || 'CHM Reader'
    ),
    
    // Encoding selector (only show when file is open)
    reader.chmFile ? h('div', { class: 'encoding-selector' }, [
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => store.dispatch(actions.setEncoding('gbk'))
      }, [
        encodingLabel,
        h('span', { innerHTML: ICONS.chevronDown })
      ]),
      
      h('div', { class: 'encoding-dropdown', style: 'display: none;' }, 
        ENCODING_OPTIONS.map(opt => 
          h('div', {
            class: `encoding-option ${opt.id === reader.encoding ? 'active' : ''}`,
            onclick: () => store.dispatch(actions.setEncoding(opt.id))
          }, opt.nativeLabel)
        )
      )
    ]) : null,
    
    // Spacer
    h('div', { style: 'flex: 1' }),
    
    // Reading mode toggle
    reader.chmFile ? h('div', { class: 'header-controls' }, [
      h('button', {
        class: `btn btn-icon ${reader.readingMode === 'paginated' ? 'active' : ''}`,
        'aria-label': 'Paginated mode',
        title: 'Paginated mode',
        onclick: () => store.dispatch(actions.setReadingMode('paginated'))
      }, [
        h('span', { innerHTML: ICONS.book })
      ]),
      
      h('button', {
        class: `btn btn-icon ${reader.readingMode === 'infinite' ? 'active' : ''}`,
        'aria-label': 'Infinite scroll mode',
        title: 'Infinite scroll mode',
        onclick: () => store.dispatch(actions.setReadingMode('infinite'))
      }, [
        h('span', { innerHTML: ICONS.stream })
      ])
    ]) : null,
    
    // Settings button
    h('button', {
      class: 'btn btn-icon',
      'aria-label': 'Settings',
      onclick: onOpenSettings
    }, [
      h('span', { innerHTML: ICONS.settings })
    ])
  ]);
}
