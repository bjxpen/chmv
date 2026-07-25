/**
 * CHM Reader - Main Entry Point
 * Client-Side Web CHM Reader Application
 */

import './styles/app.css';
import { store } from './core/store';
import { reader, typography, recentFiles } from './core/actions';
import { App, Renderer } from './components';
import { parseCHMFile, parseTOCHTML, parseIndexHTML } from './services/chmParser';
import { generateFileHash, createRecentFileEntry, getRecentFile, saveRecentFile } from './services/storage';
import { decodeText } from './services/encoding';
import { revokeAllBlobUrls } from './services/assets';
import { container } from './core/container';
import { flattenTOC, findFirstChapter, pathVariants, normalizePath } from './utils/helpers';
import type { AppState, CHMTOCEntry, CHMIndexEntry } from './types';

// Global content storage for iframe
declare global {
  interface Window {
    __chmContent: string;
    __chmParser: import('./services/chmParser').CHMParser | null;
    __chmEntries: Map<string, unknown>;
  }
}

class CHMReaderApp {
  private renderer: Renderer;
  private appElement: HTMLElement | null;

  constructor() {
    this.appElement = document.getElementById('app');
    console.log('App element:', this.appElement);
    if (!this.appElement) {
      console.error('Could not find #app element');
      return;
    }
    this.renderer = new Renderer(this.appElement);
    this.init();
  }

  async init(): Promise<void> {
    console.log('Initializing store...');
    await store.initialize();
    console.log('Store initialized');
    store.subscribe((state) => this.render(state));
    console.log('Subscribed to store');
    this.render(store.getState());
    console.log('Initial render done');
    this.setupKeyboardShortcuts();
    window.addEventListener('error', (e) => console.error('Error:', e.error));
    window.addEventListener('unhandledrejection', (e) => console.error('Reject:', e.reason));
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  private render(state: AppState): void {
    console.log('Rendering with state:', state.reader.chmFile ? 'file loaded' : 'no file');
    const vnode = App({
      state,
      onOpenFile: (file) => this.handleFileOpen(file),
      onNavigate: (path) => this.handleNavigate(path),
      onToggleSidebar: () => store.dispatch(reader.toggleSidebar(!state.reader.sidebarVisible))
    });
    console.log('VNode:', vnode);
    this.renderer.render(vnode);
    console.log('Render complete');
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const { reader: r } = store.getState();
      if (!r.chmFile) return;

      const keyMap: Record<string, () => void> = {
        'ArrowLeft': () => this.navigate(-1),
        'j': () => this.navigate(-1),
        'ArrowRight': () => this.navigate(1),
        'k': () => this.navigate(1),
        'b': () => store.dispatch(reader.toggleSidebar(!r.sidebarVisible))
      };

      const action = keyMap[e.key];
      if (action) {
        e.preventDefault();
        action();
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        store.dispatch(typography.fontSize(r.typography.fontSize + 1));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        store.dispatch(typography.fontSize(r.typography.fontSize - 1));
      }
    });
  }

  private navigate(direction: 1 | -1): void {
    const { tocEntries, currentChapter } = store.getState().reader;
    if (!currentChapter || tocEntries.length === 0) return;
    
    const flat = flattenTOC(tocEntries);
    const idx = flat.findIndex(e => e.path === currentChapter);
    const target = flat[idx + direction];
    if (target) this.handleNavigate(target.path);
  }

  private async handleFileOpen(file: File): Promise<void> {
    try {
      store.dispatch(reader.setCHMFile({
        file,
        name: file.name,
        size: file.size,
        hash: await generateFileHash(file)
      }));

      const { parser, entries } = await parseCHMFile(file);
      container.setCHMParser(parser);
      container.setCHMEntries(entries);
      window.__chmParser = parser;
      window.__chmEntries = entries;

      // Find TOC
      const tocPaths = ['/index.hhc', '/Table of Contents.hhc', '/toc.hhc', '/#WINDOWS', '/$OBJINST/'];
      let tocEntries: CHMTOCEntry[] = [];
      
      for (const path of tocPaths) {
        const content = await this.getContent(parser, path);
        if (content) {
          tocEntries = await parseTOCHTML(content);
          break;
        }
      }

      // Find Index
      const indexContent = await this.getContent(parser, '/index.hhk');
      const indexEntries: CHMIndexEntry[] = indexContent ? await parseIndexHTML(indexContent) : [];

      // Recent file
      const hash = await generateFileHash(file);
      const recent = await createRecentFileEntry(file, hash, tocEntries);
      const existing = await getRecentFile(hash);
      if (existing) {
        recent.lastChapter = existing.lastChapter;
        recent.lastPosition = existing.lastPosition;
        recent.completion = existing.completion;
      }
      await saveRecentFile(recent);

      store.dispatch(recentFiles.add(recent));
      store.dispatch(reader.setTOC(tocEntries));
      store.dispatch(reader.setIndex(indexEntries));

      // Navigate
      const target = recent.lastChapter ?? findFirstChapter(tocEntries);
      if (target) this.handleNavigate(target);
    } catch (error) {
      console.error('Open failed:', error);
      store.dispatch(reader.reset());
    }
  }

  private async getContent(parser: import('./services/chmParser').CHMParser, path: string): Promise<string | null> {
    try {
      const entry = await parser.getFile(path);
      if (!entry) return null;
      return decodeText(entry.content, store.getState().reader.encoding);
    } catch {
      return null;
    }
  }

  private async handleNavigate(path: string): Promise<void> {
    const parser = container.getCHMParser();
    if (!parser) return;

    const normalized = normalizePath(path);
    const { encoding } = store.getState().reader;
    let content = '';

    for (const variant of pathVariants(normalized)) {
      const entry = await parser.getFile(variant);
      if (entry) {
        content = decodeText(entry.content, encoding);
        break;
      }
    }

    window.__chmContent = content;
    store.dispatch(reader.setChapter(normalized));

    const { chmFile } = store.getState().reader;
    if (chmFile) {
      store.dispatch(recentFiles.update(chmFile.hash, { lastChapter: normalized }));
    }

    revokeAllBlobUrls();
  }
}

// Bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CHMReaderApp());
} else {
  new CHMReaderApp();
}
