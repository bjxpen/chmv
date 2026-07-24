/**
 * Reader Component
 * Main reading area with content rendering and navigation
 */

import { h, VNodeChild } from './Component';
import type { AppState, CHMTOCEntry } from '../types';
import { store, actions } from '../stores/appStore';
import { ICONS } from './icons';

interface ReaderProps {
  state: AppState;
  onNavigateChapter: (path: string) => void;
}

export function Reader(props: ReaderProps): VNodeChild {
  const { state, onNavigateChapter } = props;
  const { reader } = state;
  
  if (!reader.chmFile || !reader.currentChapter) {
    return h('main', { class: 'main-content' }, [
      h('div', { class: 'empty-state' }, [
        h('span', { class: 'empty-state-icon', innerHTML: ICONS.book }),
        h('p', {}, 'Select a chapter from the sidebar to start reading')
      ])
    ]);
  }
  
  const { tocEntries, currentChapter } = reader;
  
  // Get prev/next chapters
  const flatTOC = flattenTOC(tocEntries);
  const currentIndex = flatTOC.findIndex(e => e.path === currentChapter);
  const prevChapter = currentIndex > 0 ? flatTOC[currentIndex - 1] : null;
  const nextChapter = currentIndex >= 0 && currentIndex < flatTOC.length - 1 
    ? flatTOC[currentIndex + 1] : null;
  
  // Get content from global storage
  const content = (window as unknown as { __chmContent?: string }).__chmContent || '';
  const htmlContent = renderContent(reader, content);
  
  return h('main', { class: 'main-content', style: 'display: flex; flex-direction: column; overflow: hidden;' }, [
    // Top navigation
    h('div', { class: 'chapter-nav-top' }, [
      h('button', {
        class: 'btn btn-secondary',
        disabled: !prevChapter ? true : undefined,
        ondblclick: () => prevChapter && onNavigateChapter(prevChapter.path)
      }, [
        h('span', { innerHTML: ICONS.arrowLeft }),
        h('span', {}, prevChapter?.name || 'Previous')
      ]),
      
      h('button', {
        class: 'btn btn-secondary',
        disabled: !nextChapter ? true : undefined,
        ondblclick: () => nextChapter && onNavigateChapter(nextChapter.path)
      }, [
        h('span', {}, nextChapter?.name || 'Next'),
        h('span', { innerHTML: ICONS.arrowRight })
      ])
    ]),
    
    // Content area
    h('div', { 
      class: 'reader',
      style: 'flex: 1; overflow-y: auto; padding: 24px;',
      onscroll: handleScroll
    }, [
      h('div', { class: 'reader-container' }, [
        h('iframe', {
          class: 'reader-iframe',
          sandbox: 'allow-same-origin allow-scripts',
          style: 'width: 100%; min-height: 500px; border: none;',
          srcdoc: htmlContent
        })
      ])
    ]),
    
    // Bottom navigation
    h('div', { class: 'chapter-nav' }, [
      h('button', {
        class: 'btn btn-secondary',
        disabled: !prevChapter ? true : undefined,
        ondblclick: () => prevChapter && onNavigateChapter(prevChapter.path)
      }, [
        h('span', { innerHTML: ICONS.arrowLeft }),
        h('span', {}, prevChapter?.name || 'Previous')
      ]),
      
      h('button', {
        class: 'btn btn-secondary',
        disabled: !nextChapter ? true : undefined,
        ondblclick: () => nextChapter && onNavigateChapter(nextChapter.path)
      }, [
        h('span', {}, nextChapter?.name || 'Next'),
        h('span', { innerHTML: ICONS.arrowRight })
      ])
    ])
  ]);
}

function renderContent(reader: AppState['reader'], content: string): string {
  const { encoding, legacyStylesStripped, themeId, typography } = reader;
  
  // Build inline styles based on theme and typography
  const themeStyles = getThemeStyles(themeId);
  
  const baseStyles = `
    :root {
      color-scheme: ${themeId === 'dark' || themeId === 'oled' ? 'dark' : 'light'};
    }
    body {
      font-family: ${typography.fontFamily === 'kai-ti' 
        ? '"KaiTi", "STKaiti", "FangSong", serif' 
        : typography.fontFamily === 'serif' 
          ? 'Georgia, "Times New Roman", serif' 
          : 'system-ui, sans-serif'};
      font-size: ${typography.fontSize}px;
      line-height: ${typography.lineHeight};
      letter-spacing: ${typography.letterSpacing}em;
      color: ${themeStyles.text};
      background: ${themeStyles.background};
      padding: 1em;
      margin: 0;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.3;
    }
    p { margin-bottom: ${typography.paragraphSpacing}em; }
    a { color: ${themeStyles.accent}; }
    img { max-width: 100%; height: auto; }
    pre, code { font-family: "SF Mono", Consolas, monospace; }
    pre { background: ${themeStyles.surface}; padding: 1em; border-radius: 4px; overflow-x: auto; }
    code { background: ${themeStyles.surface}; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid ${themeStyles.border}; padding: 0.5em; text-align: left; }
    blockquote { margin: 1em 0; padding-left: 1em; border-left: 4px solid ${themeStyles.border}; color: ${themeStyles.textSecondary}; }
    /* CJK typography */
    :lang(zh), :lang(ja), :lang(ko) {
      line-height: 1.8;
      text-align: justify;
      text-justify: inter-ideographic;
    }
  `;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${baseStyles}</style>
</head>
<body>
${content}
</body>
</html>`;
}

function getThemeStyles(themeId: string): Record<string, string> {
  const themes: Record<string, Record<string, string>> = {
    light: { background: '#ffffff', surface: '#f8f9fa', text: '#1a1a2e', textSecondary: '#6c757d', border: '#dee2e6', accent: '#4a90d9' },
    sepia: { background: '#f4ecd8', surface: '#ebe2cc', text: '#5b4636', textSecondary: '#8b7355', border: '#d4c4a8', accent: '#b8860b' },
    dark: { background: '#2d2d3a', surface: '#3a3a4a', text: '#e8e8f0', textSecondary: '#a0a0b0', border: '#4a4a5a', accent: '#7eb8e8' },
    oled: { background: '#000000', surface: '#121212', text: '#e0e0e0', textSecondary: '#808080', border: '#2a2a2a', accent: '#6aa8e8' }
  };
  return themes[themeId] || themes.light;
}

function handleScroll(e: Event): void {
  const target = e.target as HTMLElement;
  const { scrollTop, scrollHeight, clientHeight } = target;
  
  // Save scroll position
  store.dispatch(actions.setScrollPosition(scrollTop));
  
  // Calculate reading progress
  const progress = scrollHeight > clientHeight 
    ? Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
    : 100;
  
  // Update recent file progress
  const { chmFile } = store.getState().reader;
  if (chmFile) {
    store.dispatch(actions.updateRecentFile(chmFile.hash, {
      lastPosition: scrollTop,
      completion: progress
    }));
  }
}

function flattenTOC(entries: CHMTOCEntry[]): CHMTOCEntry[] {
  const result: CHMTOCEntry[] = [];
  
  const walk = (items: CHMTOCEntry[]) => {
    for (const item of items) {
      if (item.path) {
        result.push(item);
      }
      if (item.children.length > 0) {
        walk(item.children);
      }
    }
  };
  
  walk(entries);
  return result;
}
