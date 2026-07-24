/**
 * CHM Reader - Main Entry Point
 * Client-Side Web CHM Reader Application
 */

import './styles/app.css';
import { store, actions } from './stores/appStore';
import { App } from './components/App';
import { Renderer } from './components/Renderer';
import { CHMParser, parseCHMFile, parseTOCHTML, parseIndexHTML } from './services/chmParser';
import { generateFileHash, createRecentFileEntry, getRecentFile, saveRecentFile } from './services/storage';
import { decodeText } from './services/encoding';
import { revokeAllBlobUrls } from './services/assets';
import type { AppState, CHMTOCEntry, CHMIndexEntry } from './types';

// Global content storage for iframe
declare global {
  interface Window {
    __chmContent: string;
    __chmParser: CHMParser | null;
    __chmEntries: Map<string, { offset: number; length: number; flags: number; name: string }>;
  }
}

class CHMReaderApp {
  private renderer: Renderer;
  private appElement: HTMLElement;
  
  constructor() {
    this.appElement = document.getElementById('app')!;
    this.renderer = new Renderer(this.appElement);
    
    // Initialize app
    this.init();
  }
  
  private async init(): Promise<void> {
    // Initialize storage
    await store.initialize();
    
    // Subscribe to state changes
    store.subscribe((state) => this.render(state));
    
    // Initial render
    this.render(store.getState());
    
    // Set up keyboard shortcuts
    this.setupKeyboardShortcuts();
    
    // Set up global error handler
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handlePromiseError);
    
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Service worker registration failed, but app still works
      });
    }
  }
  
  private render(state: AppState): void {
    const vnode = App({
      state,
      onOpenFile: (file) => this.handleFileOpen(file),
      onNavigateChapter: (path) => this.handleNavigate(path),
      onOpenSettings: () => {},
      onToggleSidebar: () => this.toggleSidebar()
    });
    
    this.renderer.render(vnode);
  }
  
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Skip if in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const { reader } = store.getState();
      if (!reader.chmFile) return;
      
      switch (e.key) {
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          this.navigatePrev();
          break;
        case 'ArrowRight':
        case 'k':
          e.preventDefault();
          this.navigateNext();
          break;
        case 'b':
          e.preventDefault();
          this.toggleSidebar();
          break;
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            store.dispatch(actions.setFontSize(reader.typography.fontSize + 1));
          }
          break;
        case '-':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            store.dispatch(actions.setFontSize(reader.typography.fontSize - 1));
          }
          break;
      }
    });
  }
  
  private navigatePrev(): void {
    const { tocEntries, currentChapter } = store.getState().reader;
    if (!currentChapter || tocEntries.length === 0) return;
    
    const flat = this.flattenTOC(tocEntries);
    const idx = flat.findIndex(e => e.path === currentChapter);
    
    if (idx > 0) {
      this.handleNavigate(flat[idx - 1].path);
    }
  }
  
  private navigateNext(): void {
    const { tocEntries, currentChapter } = store.getState().reader;
    if (!currentChapter || tocEntries.length === 0) return;
    
    const flat = this.flattenTOC(tocEntries);
    const idx = flat.findIndex(e => e.path === currentChapter);
    
    if (idx >= 0 && idx < flat.length - 1) {
      this.handleNavigate(flat[idx + 1].path);
    }
  }
  
  private flattenTOC(entries: CHMTOCEntry[]): CHMTOCEntry[] {
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
  
  private async handleFileOpen(file: File): Promise<void> {
    try {
      // Show loading state
      store.dispatch(actions.setCHMFile({
        file,
        name: file.name,
        size: file.size,
        hash: await generateFileHash(file)
      }));
      
      // Parse CHM file
      const { parser, entries } = await parseCHMFile(file);
      
      // Store parser reference
      window.__chmParser = parser;
      window.__chmEntries = entries;
      store.setCHMParser(parser);
      store.setCHMEntries(entries);
      
      // Parse TOC
      const tocContent = await this.getCHMContent(parser, '/index.hhc');
      const altTocPaths = [
        '/Table of Contents.hhc',
        '/toc.hhc',
        '/#WINDOWS',
        '/$OBJINST/'
      ];
      
      let tocEntries: CHMTOCEntry[] = [];
      let tocHtml = tocContent;
      
      if (!tocHtml) {
        for (const path of altTocPaths) {
          tocHtml = await this.getCHMContent(parser, path);
          if (tocHtml) break;
        }
      }
      
      if (tocHtml) {
        tocEntries = await parseTOCHTML(tocHtml);
      }
      
      // Parse Index
      const indexHtml = await this.getCHMContent(parser, '/index.hhk');
      let indexEntries: CHMIndexEntry[] = [];
      
      if (indexHtml) {
        indexEntries = await parseIndexHTML(indexHtml);
      }
      
      // Create recent file entry
      const hash = await generateFileHash(file);
      const recentFile = await createRecentFileEntry(file, hash, tocEntries);
      
      // Check for existing entry to restore progress
      const existingFile = await getRecentFile(hash);
      if (existingFile) {
        recentFile.lastChapter = existingFile.lastChapter;
        recentFile.lastPosition = existingFile.lastPosition;
        recentFile.completion = existingFile.completion;
      }
      
      await saveRecentFile(recentFile);
      store.dispatch(actions.addRecentFile(recentFile));
      store.dispatch(actions.setTOCEntries(tocEntries));
      store.dispatch(actions.setIndexEntries(indexEntries));
      
      // Navigate to last chapter or first chapter
      const lastChapter = recentFile.lastChapter;
      const firstChapter = this.findFirstChapter(tocEntries);
      
      if (lastChapter && tocEntries.length > 0) {
        this.handleNavigate(lastChapter);
      } else if (firstChapter) {
        this.handleNavigate(firstChapter);
      }
      
    } catch (error) {
      console.error('Failed to open CHM file:', error);
      store.dispatch(actions.resetReader());
    }
  }
  
  private async getCHMContent(parser: CHMParser, path: string): Promise<string | null> {
    try {
      const fileEntry = await parser.getFile(path);
      if (!fileEntry) return null;
      
      const content = decodeText(fileEntry.content, store.getState().reader.encoding);
      return content;
    } catch {
      return null;
    }
  }
  
  private findFirstChapter(entries: CHMTOCEntry[]): string | null {
    for (const entry of entries) {
      if (entry.path) return entry.path;
      if (entry.children.length > 0) {
        const childPath = this.findFirstChapter(entry.children);
        if (childPath) return childPath;
      }
    }
    return null;
  }
  
  private async handleNavigate(path: string): Promise<void> {
    const parser = store.getCHMParser();
    
    if (!parser) {
      console.error('No CHM file loaded');
      return;
    }
    
    try {
      // Normalize path
      let normalizedPath = path.replace(/^.*::/, '').replace(/^\//, '');
      const { encoding } = store.getState().reader;
      
      // Try to get the content
      let content = '';
      const fileEntry = await parser.getFile(normalizedPath);
      
      if (!fileEntry) {
        // Try with different paths
        const altPaths = [
          normalizedPath,
          normalizedPath.replace(/\\/g, '/'),
          normalizedPath.replace(/\//g, '\\'),
          `/${normalizedPath}`,
          `\\${normalizedPath}`
        ];
        
        for (const p of altPaths) {
          const entry = await parser.getFile(p);
          if (entry) {
            content = decodeText(entry.content, encoding);
            break;
          }
        }
      } else {
        content = decodeText(fileEntry.content, encoding);
      }
      
      // Store content for iframe
      window.__chmContent = content;
      
      // Update state
      store.dispatch(actions.setCurrentChapter(normalizedPath));
      
      // Update recent file
      const { chmFile } = store.getState().reader;
      if (chmFile) {
        store.dispatch(actions.updateRecentFile(chmFile.hash, {
          lastChapter: normalizedPath
        }));
      }
      
      // Clean up old blob URLs
      revokeAllBlobUrls();
      
    } catch (error) {
      console.error('Failed to navigate to chapter:', error);
    }
  }
  
  private toggleSidebar(): void {
    const { sidebarVisible } = store.getState().reader;
    store.dispatch(actions.setSidebarVisible(!sidebarVisible));
  }
  
  private handleError(event: ErrorEvent): void {
    console.error('Global error:', event.error);
  }
  
  private handlePromiseError(event: PromiseRejectionEvent): void {
    console.error('Unhandled promise rejection:', event.reason);
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CHMReaderApp());
} else {
  new CHMReaderApp();
}
