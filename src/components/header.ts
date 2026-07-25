/**
 * Header - Application header with controls
 */

import { h } from './vdom';
import type { VNodeChild } from './vdom';
import type { AppState } from '../types';
import { ICONS } from './icons';

interface HeaderProps {
  state: AppState;
  onToggleSidebar: () => void;
}

export function Header({ state, onToggleSidebar }: HeaderProps): VNodeChild {
  const { reader } = state;
  const hasFile = !!reader.chmFile;
  const fileName = reader.chmFile?.name ?? 'CHM Reader';

  return h('header', { class: 'app-header' }, [
    h('div', { class: 'header-left' }, [
      h('button', {
        class: 'icon-btn',
        title: 'Toggle Sidebar',
        onClick: onToggleSidebar
      }, [ICONS.menu])
    ]),
    h('div', { class: 'header-center' }, [
      hasFile 
        ? h('span', { class: 'file-name' }, [fileName])
        : h('h1', { class: 'app-title' }, ['CHM Reader'])
    ]),
    h('div', { class: 'header-right' }, [
      hasFile && h('div', { class: 'chapter-nav' }, [
        h('span', { class: 'chapter-name' }, [reader.currentChapter?.split('/').pop() ?? ''])
      ])
    ])
  ]);
}
