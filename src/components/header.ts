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

  return h('header', { class: 'header' }, [
    h('div', { class: 'header-title' }, [fileName]),
    h('div', { class: 'header-controls' }, [
      hasFile && h('button', {
        class: 'btn-icon',
        title: 'Toggle Sidebar',
        innerHTML: ICONS.menu,
        onClick: onToggleSidebar
      })
    ])
  ]);
}
