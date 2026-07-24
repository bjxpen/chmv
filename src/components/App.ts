/**
 * App Component
 * Main application container
 */

import { h, VNodeChild } from './Component';
import type { AppState } from '../types';
import { THEMES, FONT_FAMILIES, CONTAINER_WIDTHS } from '../types';
import { store, actions } from '../stores/appStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Reader } from './Reader';
import { DropZone } from './DropZone';
import { SettingsPanel } from './SettingsPanel';
import { RecentFiles } from './RecentFiles';

interface AppProps {
  state: AppState;
  onOpenFile: (file: File) => void;
  onNavigateChapter: (path: string) => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

export function App(props: AppProps): VNodeChild {
  const { state, onOpenFile, onNavigateChapter, onOpenSettings, onToggleSidebar } = props;
  const { reader } = state;
  
  const hasFile = !!reader.chmFile;
  
  // Apply theme CSS variables
  const theme = THEMES[reader.themeId];
  const typography = reader.typography;
  
  const containerStyle: Record<string, string> = {
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
    class: 'app-container',
    'data-theme': reader.themeId,
    style: containerStyle as unknown as string
  }, [
    // Header
    Header({
      state,
      onOpenSettings,
      onToggleSidebar
    }),
    
    // Main content area
    hasFile
      ? h('div', { class: 'app-main', style: 'display: flex; flex: 1; overflow: hidden;' }, [
          Sidebar({
            state,
            onNavigate: onNavigateChapter
          }),
          Reader({
            state,
            onNavigateChapter
          })
        ])
      : h('div', { style: 'flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 24px;' }, [
          DropZone({ onFileSelect: onOpenFile }),
          RecentFiles({ 
            files: state.recentFiles,
            onOpenFile: onOpenFile
          })
        ]),
    
    // Settings panel
    SettingsPanel({
      state,
      onClose: () => store.dispatch(actions.setSidebarVisible(false))
    })
  ]);
}

// Export for external use
export type { AppProps };
