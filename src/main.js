/**
 * chmv - Client-Side Web CHM Reader
 * Main Application Entry Point
 */

import { appState } from './state/app-state.js';
import { CHMParser } from './core/chm-parser.js';
import { EncodingEngine } from './core/encoding-engine.js';
import { ContentRenderer } from './rendering/content-renderer.js';
import { Sidebar } from './components/sidebar.js';
import { Toolbar } from './components/toolbar.js';

class App {
  constructor() {
    this.chmParser = null;
    this.encodingEngine = null;
    this.contentRenderer = null;
    this.sidebar = null;
    this.toolbar = null;
    
    this.currentFile = null;
    this.currentFileHash = null;
    this.htmlFiles = [];
    this.currentChapterIndex = -1;
    
    this.init();
  }

  async init() {
    // Initialize state management
    await appState.init();
    await appState.loadPreferences();
    
    // Initialize engines
    this.encodingEngine = new EncodingEngine();
    this.contentRenderer = new ContentRenderer();
    this.sidebar = new Sidebar();
    this.toolbar = new Toolbar();
    
    // Setup UI
    this.setupUI();
    this.setupEventHandlers();
    
    // Register service worker for PWA
    this.registerServiceWorker();
    
    // Show recent files dashboard
    this.showRecentFiles();
  }

  setupUI() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="app-container">
        <header class="app-header">
          <div class="header-title">chmv - CHM Reader</div>
        </header>
        <div class="toolbar-container" id="toolbar"></div>
        <div class="main-content">
          <aside class="sidebar-container" id="sidebar"></aside>
          <main class="reader-container">
            <div class="file-drop-zone" id="drop-zone">
              <div class="drop-content">
                <div class="drop-icon">📚</div>
                <h2>Drop CHM File Here</h2>
                <p>or click to browse</p>
                <input type="file" id="file-input" accept=".chm" style="display:none">
              </div>
            </div>
            <div class="content-area" id="content-area"></div>
            <div class="recent-files" id="recent-files"></div>
          </main>
        </div>
      </div>
    `;
    
    // Initialize components
    this.toolbar.init(document.getElementById('toolbar'));
    this.sidebar.init(document.getElementById('sidebar'));
    this.contentRenderer.init(document.getElementById('content-area'));
    
    // Setup file input
    this.setupFileInput();
  }

  setupFileInput() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.chm')) {
        this.loadCHMFile(file);
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadCHMFile(file);
      }
      fileInput.value = '';
    });
  }

  setupEventHandlers() {
    // Toolbar actions
    this.toolbar.setOnAction(async (action, value) => {
      await this.handleToolbarAction(action, value);
    });
    
    // Sidebar chapter selection
    this.sidebar.setOnChapterSelect((path) => {
      this.loadChapter(path);
    });
    
    // Content renderer link clicks
    this.contentRenderer.setOnLinkClick((path) => {
      this.loadChapter(path);
    });
    
    // Content loaded callback
    this.contentRenderer.setOnContentLoad(() => {
      this.saveReadingProgress();
    });
  }

  async handleToolbarAction(action, value) {
    switch (action) {
      case 'open-file':
        document.getElementById('file-input').click();
        break;
        
      case 'zoom-in':
        this.adjustFontSize(1);
        break;
        
      case 'zoom-out':
        this.adjustFontSize(-1);
        break;
        
      case 'width':
        appState.setPreference('contentWidth', value);
        this.refreshContent();
        break;
        
      case 'theme':
        appState.setPreference('theme', value);
        this.refreshContent();
        break;
        
      case 'font-family':
        appState.setPreference('fontFamily', value);
        this.refreshContent();
        break;
        
      case 'strip-styles':
        appState.setPreference('stripLegacyStyles', !appState.getPreference('stripLegacyStyles'));
        this.refreshContent();
        break;
        
      case 'encoding':
        appState.setPreference('encoding', value);
        appState.setPreference('autoDetectEncoding', false);
        if (this.currentChapterIndex >= 0) {
          await this.reloadCurrentChapter();
        }
        break;
        
      case 'prev-chapter':
        this.navigateChapter(-1);
        break;
        
      case 'next-chapter':
        this.navigateChapter(1);
        break;
    }
  }

  adjustFontSize(delta) {
    const current = appState.getPreference('fontSize');
    const newSize = Math.max(10, Math.min(32, current + delta));
    appState.setPreference('fontSize', newSize);
    this.toolbar.updateZoomDisplay(newSize);
    this.refreshContent();
  }

  refreshContent() {
    if (this.currentChapterIndex >= 0) {
      this.loadChapter(this.htmlFiles[this.currentChapterIndex].path);
    }
  }

  async reloadCurrentChapter() {
    if (this.currentChapterIndex >= 0) {
      const path = this.htmlFiles[this.currentChapterIndex].path;
      await this.loadChapter(path);
    }
  }

  navigateChapter(direction) {
    const newIndex = this.currentChapterIndex + direction;
    if (newIndex >= 0 && newIndex < this.htmlFiles.length) {
      this.loadChapter(this.htmlFiles[newIndex].path);
    }
  }

  async loadCHMFile(file) {
    try {
      this.showLoading(true);
      
      // Generate file hash
      this.currentFileHash = await appState.generateFileHash(file);
      this.currentFile = file;
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Parse CHM
      this.chmParser = new CHMParser();
      const result = await this.chmParser.parse(arrayBuffer);
      
      // Get HTML files
      this.htmlFiles = Array.from(result.files.values())
        .filter(entry => entry.isFile && /\.(htm|html)$/i.test(entry.path))
        .sort((a, b) => a.path.localeCompare(b.path));
      
      // Update sidebar with TOC
      if (result.toc) {
        const tocData = await this.parseTOC(result.toc);
        this.sidebar.loadTOC(tocData);
      } else {
        // Generate flat TOC from HTML files
        const flatTOC = this.htmlFiles.map(f => ({
          title: this.extractTitleFromPath(f.path),
          path: f.path
        }));
        this.sidebar.loadTOC(flatTOC);
      }
      
      // Hide drop zone, show content
      document.getElementById('drop-zone').style.display = 'none';
      document.getElementById('recent-files').style.display = 'none';
      
      // Check for saved reading progress
      const progress = await appState.loadReadingProgress(this.currentFileHash);
      if (progress && progress.chapterPath) {
        const index = this.htmlFiles.findIndex(f => f.path === progress.chapterPath);
        if (index >= 0) {
          this.currentChapterIndex = index;
          await this.loadChapter(progress.chapterPath, progress.scrollPosition);
        } else {
          this.loadChapter(this.htmlFiles[0].path);
        }
      } else {
        this.loadChapter(this.htmlFiles[0].path);
      }
      
      // Add to recent files
      await appState.addRecentFile({
        fileHash: this.currentFileHash,
        fileName: file.name,
        fileSize: file.size
      });
      
    } catch (error) {
      console.error('Failed to load CHM file:', error);
      alert('Failed to load CHM file: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  async parseTOC(tocEntry) {
    try {
      const content = await this.chmParser.getTextContent(tocEntry, 'UTF-8');
      // Simple HHC parsing - extract titles and paths
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      
      const items = [];
      const nodes = doc.querySelectorAll('LI');
      
      nodes.forEach(node => {
        const objectTag = node.querySelector('OBJECT');
        if (objectTag) {
          const param = objectTag.querySelector('param[name="Name"]');
          const value = param ? param.getAttribute('value') : null;
          if (value) {
            items.push({
              title: value,
              path: node.querySelector('param[name="Local"]')?.getAttribute('value') || ''
            });
          }
        }
      });
      
      return items.length > 0 ? items : [];
    } catch (error) {
      console.warn('Failed to parse TOC:', error);
      return [];
    }
  }

  extractTitleFromPath(path) {
    const match = path.match(/([^\\/]+)\.(?:htm|html)$/i);
    if (match) {
      return decodeURIComponent(match[1]).replace(/[_-]/g, ' ');
    }
    return path;
  }

  async loadChapter(path, scrollPosition = 0) {
    try {
      const entry = this.chmParser.findEntry(path);
      if (!entry) {
        console.warn('Chapter not found:', path);
        return;
      }
      
      // Get encoding preference
      const prefs = appState.getPreferences();
      const encoding = prefs.autoDetectEncoding ? 'UTF-8' : prefs.encoding;
      
      // Extract and decode content
      const data = await this.chmParser.extractFile(entry);
      let html = this.encodingEngine.decode(data, encoding);
      
      // Process images and assets
      html = await this.processAssets(html, path);
      
      // Render
      this.contentRenderer.render(html, path, {
        stripLegacyStyles: prefs.stripLegacyStyles
      });
      
      // Update current chapter index
      this.currentChapterIndex = this.htmlFiles.findIndex(f => f.path === path);
      
      // Highlight in sidebar
      this.sidebar.selectChapter(path);
      
      // Restore scroll position
      if (scrollPosition > 0) {
        setTimeout(() => {
          const contentArea = document.getElementById('content-area');
          contentArea.scrollTop = scrollPosition;
        }, 100);
      }
      
      // Save progress
      this.saveReadingProgress();
      
    } catch (error) {
      console.error('Failed to load chapter:', error);
    }
  }

  async processAssets(html, chapterPath) {
    // Find and replace image sources with blob URLs
    const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    
    while ((match = imgPattern.exec(html)) !== null) {
      const src = match[1];
      if (!src.startsWith('http') && !src.startsWith('data:')) {
        const resolvedPath = this.resolveAssetPath(src, chapterPath);
        const entry = this.chmParser.findEntry(resolvedPath);
        
        if (entry) {
          try {
            const blobUrl = await this.chmParser.getBlobURL(entry);
            this.contentRenderer.registerBlobURL(blobUrl);
            html = html.replace(src, blobUrl);
          } catch (error) {
            console.warn('Failed to load asset:', src, error);
          }
        }
      }
    }
    
    return html;
  }

  resolveAssetPath(src, chapterPath) {
    const lastSlash = chapterPath.lastIndexOf('/');
    const currentDir = lastSlash >= 0 ? chapterPath.substring(0, lastSlash + 1) : '';
    
    if (src.startsWith('./')) {
      return currentDir + src.substring(2);
    } else if (src.startsWith('../')) {
      const parentDir = currentDir.substring(0, currentDir.lastIndexOf('/'));
      return parentDir + '/' + src.substring(3);
    } else if (src.startsWith('/')) {
      return src.substring(1);
    } else {
      return currentDir + src;
    }
  }

  saveReadingProgress() {
    if (!this.currentFileHash) return;
    
    const contentArea = document.getElementById('content-area');
    const scrollPosition = contentArea ? contentArea.scrollTop : 0;
    
    const completionPercent = this.htmlFiles.length > 0 
      ? Math.round(((this.currentChapterIndex + 1) / this.htmlFiles.length) * 100)
      : 0;
    
    appState.saveReadingProgress(this.currentFileHash, {
      chapterPath: this.htmlFiles[this.currentChapterIndex]?.path || '',
      scrollPosition,
      completionPercent
    });
  }

  showRecentFiles() {
    const container = document.getElementById('recent-files');
    
    appState.loadRecentFiles().then(files => {
      if (files.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <h3>No recent files</h3>
            <p>Open a CHM file to get started</p>
          </div>
        `;
        return;
      }
      
      container.innerHTML = `
        <h3>Recent Files</h3>
        <div class="recent-list">
          ${files.map(file => `
            <div class="recent-item" data-hash="${file.fileHash}">
              <div class="recent-name">${file.fileName}</div>
              <div class="recent-meta">
                <span>${file.completionPercent || 0}% complete</span>
                <span>${this.formatDate(file.lastOpened)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      
      // Setup click handlers
      container.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', async () => {
          // In a real implementation, we'd need to re-load the file
          // For now, just show a message
          alert('Please re-open the file using the file picker');
        });
      });
    });
  }

  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  }

  showLoading(show) {
    const dropZone = document.getElementById('drop-zone');
    if (show) {
      dropZone.classList.add('loading');
      dropZone.querySelector('.drop-content').innerHTML = '<div class="spinner">Loading...</div>';
    } else {
      dropZone.classList.remove('loading');
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('Service Worker registered:', registration.scope);
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
