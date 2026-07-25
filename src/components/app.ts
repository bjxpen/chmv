/**
 * App - Main application component
 */

import { h } from './vdom';
import type { VNodeChild } from './vdom';
import type { AppState, CHMFile } from '../types';
import { THEMES, FONT_FAMILIES, CONTAINER_WIDTHS } from '../types';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { Reader } from './reader';
import { DropZone } from './dropzone';
import { RecentFiles } from './recent-files';
import { SettingsPanel } from './settings-panel';

interface AppProps {
  state: AppState;
  onOpenFile: (file: File) => void;
  onNavigate: (path: string) => void;
  onToggleSidebar: () => void;
}

export function App({ state, onOpenFile, onNavigate, onToggleSidebar }: AppProps): VNodeChild {
  const { reader } = state;
  const hasFile = !!reader.chmFile;
  const theme = THEMES[reader.themeId];
  const { typography } = reader;

  // Build theme CSS variables
  const cssVars = {
    '--background': theme.background,
    '--surface': theme.surface,
    '--text': theme.text,
    '--text-secondary': theme.textSecondary,
    '--border': theme.border,
    '--accent': theme.accent,
    '--sidebar-bg': theme.sidebarBg,
    '--scrollbar': theme.scrollbar,
    '--scrollbar-hover': theme.scrollbarHover,
    '--font-size': `${typography.fontSize}px`,
    '--line-height': String(typography.lineHeight),
    '--letter-spacing': `${typography.letterSpacing}em`,
    '--paragraph-spacing': `${typography.paragraphSpacing}em`,
    '--font-family': FONT_FAMILIES[typography.fontFamily],
    '--container-width': CONTAINER_WIDTHS[typography.containerWidth]
  };

  return h('div', { 
    class: 'app',
    'data-theme': reader.themeId,
    style: cssVars
  }, [
    Header({ state, onToggleSidebar }),
    hasFile 
      ? h('div', { class: 'main-content', style: 'display: flex; flex: 1; overflow: hidden;' }, [
          Sidebar({ state, onNavigate }),
          Reader({ state, onNavigate })
        ])
      : h('div', { style: 'flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 24px;' }, [
          DropZone({ onFileSelect: onOpenFile }),
          RecentFiles({ files: state.recentFiles, onOpenFile })
        ]),
    SettingsPanel({ state })
  ]);
}
