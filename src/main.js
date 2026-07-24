/**
 * Main Application - Connects all components via dependency injection
 * Declarative architecture with clean separation of concerns
 */
import { CHMParser } from './core/chm-parser.js';
import { EncodingEngine } from './core/encoding-engine.js';
import { StateManager } from './state/state-manager.js';
import { ContentRenderer } from './rendering/content-renderer.js';
import { di } from './core/di.js';

// Register services
di.registerSingleton('state', () => new StateManager());
di.register('parser', () => new CHMParser());
di.register('encoding', () => new EncodingEngine());
di.register('renderer', () => new ContentRenderer());

export class App {
  constructor() {
    this.state = di.get('state');
    this.parser = null;
    this.encoding = di.get('encoding');
    this.renderer = di.get('renderer');
    
    this.file = null;
    this.fileHash = null;
    this.htmlFiles = [];
    this.chapterIndex = -1;
    this.blobURLs = new Set();
  }

  async init() {
    await this.state.init();
    this.setupUI();
    this.setupEvents();
    this.setupKeyboard();
    this.registerSW();
    this.showRecent();
  }

  setupUI() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="app-container">
        <header class="app-header">
          <div class="header-title">chmv - CHM Reader</div>
        </header>
        <chmv-toolbar id="toolbar"></chmv-toolbar>
        <div class="main-content">
          <chmv-sidebar id="sidebar"></chmv-sidebar>
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
            <chmv-recent id="recent"></chmv-recent>
          </main>
        </div>
      </div>
    `;

    this.toolbar = document.getElementById('toolbar');
    this.sidebar = document.getElementById('sidebar');
    this.recent = document.getElementById('recent');
    
    this.renderer.init(document.getElementById('content-area'));
    this.toolbar.setPrefs(this.state.getPrefs());
    this.setupFileInput();
  }

  setupFileInput() {
    const drop = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file?.name.toLowerCase().endsWith('.chm')) this.loadFile(file);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) this.loadFile(e.target.files[0]);
      input.value = '';
    });
  }

  setupEvents() {
    this.toolbar.onAction = (action, value) => this.handleAction(action, value);
    this.sidebar.onSelect = (path) => this.loadChapter(path);
    this.renderer.onLink = (path) => this.loadChapter(path);
    this.renderer.onLoad = () => this.saveProgress();

    document.addEventListener('sidebar-toggle', (e) => {
      this.state.setPref('sidebarVisible', !e.detail.collapsed);
    });
  }

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          document.getElementById('file-input').click();
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          this.adjustFont(1);
        } else if (e.key === '-') {
          e.preventDefault();
          this.adjustFont(-1);
        }
      } else if (e.key === 'ArrowLeft') {
        this.navigate(-1);
      } else if (e.key === 'ArrowRight') {
        this.navigate(1);
      } else if (e.key === 'b' || e.key === 'B') {
        this.sidebar.toggleCollapse();
      }
    });
  }

  async handleAction(action, value) {
    switch (action) {
      case 'open-file': document.getElementById('file-input').click(); break;
      case 'zoom-in': this.adjustFont(1); break;
      case 'zoom-out': this.adjustFont(-1); break;
      case 'width': this.state.setPref('contentWidth', value); this.refresh(); break;
      case 'theme': this.state.setPref('theme', value); this.refresh(); break;
      case 'font': this.state.setPref('fontFamily', value); this.refresh(); break;
      case 'strip-styles': this.state.setPref('stripLegacyStyles', !this.state.getPref('stripLegacyStyles')); this.refresh(); break;
      case 'encoding': this.state.setPref('encoding', value); this.state.setPref('autoDetectEncoding', false); if (this.chapterIndex >= 0) this.reloadChapter(); break;
      case 'prev-chapter': this.navigate(-1); break;
      case 'next-chapter': this.navigate(1); break;
    }
  }

  adjustFont(delta) {
    const size = Math.max(10, Math.min(32, this.state.getPref('fontSize') + delta));
    this.state.setPref('fontSize', size);
    this.refresh();
  }

  refresh() {
    if (this.chapterIndex >= 0) {
      this.toolbar.setPrefs(this.state.getPrefs());
      this.loadChapter(this.htmlFiles[this.chapterIndex].path);
    }
  }

  async reloadChapter() {
    if (this.chapterIndex >= 0) await this.loadChapter(this.htmlFiles[this.chapterIndex].path);
  }

  navigate(dir) {
    const idx = this.chapterIndex + dir;
    if (idx >= 0 && idx < this.htmlFiles.length) this.loadChapter(this.htmlFiles[idx].path);
  }

  async loadFile(file) {
    try {
      this.showLoading(true);
      this.fileHash = await this.state.hashFile(file);
      this.file = file;
      
      const buf = await file.arrayBuffer();
      this.parser = di.get('parser');
      const result = await this.parser.parse(buf);
      this.htmlFiles = this.parser.getHTMLFiles();
      
      if (result.toc) {
        const toc = await this.parseTOC(result.toc);
        this.sidebar.loadTOC(toc);
      } else {
        this.sidebar.loadTOC(this.htmlFiles.map(f => ({ title: this.extractTitle(f.path), path: f.path })));
      }
      
      if (result.index) {
        const idx = await this.parseIndex(result.index);
        this.sidebar.loadIndex(idx);
      }
      
      document.getElementById('drop-zone').style.display = 'none';
      document.getElementById('recent').style.display = 'none';
      
      const progress = await this.state.loadProgress(this.fileHash);
      if (progress?.chapterPath) {
        const idx = this.htmlFiles.findIndex(f => f.path === progress.chapterPath);
        if (idx >= 0) {
          this.chapterIndex = idx;
          await this.loadChapter(progress.chapterPath, progress.scrollPosition);
        } else {
          this.loadChapter(this.htmlFiles[0]?.path);
        }
      } else {
        this.loadChapter(this.htmlFiles[0]?.path);
      }
      
      await this.state.addRecentFile({ fileHash: this.fileHash, fileName: file.name, fileSize: file.size });
    } catch (err) {
      console.error('Failed to load CHM:', err);
      alert('Failed to load CHM: ' + err.message);
    } finally {
      this.showLoading(false);
    }
  }

  async parseTOC(entry) {
    try {
      const content = await this.parser.getTextContent(entry, 'UTF-8');
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const items = [];
      doc.querySelectorAll('LI').forEach(node => {
        const obj = node.querySelector('OBJECT');
        if (obj) {
          const name = obj.querySelector('param[name="Name"]')?.getAttribute('value');
          const local = obj.querySelector('param[name="Local"]')?.getAttribute('value');
          if (name) items.push({ title: name, path: local || '', children: [] });
        }
      });
      return items;
    } catch { return []; }
  }

  async parseIndex(entry) {
    try {
      const content = await this.parser.getTextContent(entry, 'UTF-8');
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const items = [];
      doc.querySelectorAll('LI').forEach(node => {
        const name = node.querySelector('param[name="Name"]')?.getAttribute('value');
        const local = node.querySelector('param[name="Local"]')?.getAttribute('value');
        if (name) items.push({ keyword: name, path: local || '' });
      });
      return items;
    } catch { return []; }
  }

  extractTitle(path) {
    const match = path.match(/([^\\/]+)\.(?:htm|html)$/i);
    return match ? decodeURIComponent(match[1]).replace(/[_-]/g, ' ') : path;
  }

  async loadChapter(path, scrollPos = 0) {
    try {
      const entry = this.parser.findEntry(path);
      if (!entry) return;
      
      const prefs = this.state.getPrefs();
      const enc = prefs.autoDetectEncoding ? 'UTF-8' : prefs.encoding;
      
      const data = await this.parser.extractFile(entry);
      let html = this.encoding.decode(data, enc);
      html = await this.processAssets(html, path);
      
      this.renderer.render(html, path, { stripLegacyStyles: prefs.stripLegacyStyles, prefs });
      this.chapterIndex = this.htmlFiles.findIndex(f => f.path === path);
      this.sidebar.select(path);
      
      if (scrollPos > 0) {
        setTimeout(() => { const area = document.getElementById('content-area'); if (area) area.scrollTop = scrollPos; }, 100);
      }
      this.saveProgress();
    } catch (err) { console.error('Failed to load chapter:', err); }
  }

  async processAssets(html, chapterPath) {
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRe.exec(html)) !== null) {
      const src = match[1];
      if (!src.startsWith('http') && !src.startsWith('data:')) {
        const resolved = this.resolvePath(src, chapterPath);
        const entry = this.parser.findEntry(resolved);
        if (entry) {
          try {
            const url = await this.parser.getBlobURL(entry);
            this.renderer.registerBlob(url);
            this.blobURLs.add(url);
            html = html.replace(src, url);
          } catch (err) { console.warn('Asset load failed:', src, err); }
        }
      }
    }
    return html;
  }

  resolvePath(src, chapterPath) {
    const dir = chapterPath.substring(0, chapterPath.lastIndexOf('/') + 1);
    if (src.startsWith('./')) return dir + src.slice(2);
    if (src.startsWith('../')) {
      const parent = dir.substring(0, dir.lastIndexOf('/'));
      return parent + '/' + src.slice(3);
    }
    if (src.startsWith('/')) return src.slice(1);
    return dir + src;
  }

  saveProgress() {
    if (!this.fileHash) return;
    const area = document.getElementById('content-area');
    const scroll = area?.scrollTop || 0;
    const completion = this.htmlFiles.length ? Math.round(((this.chapterIndex + 1) / this.htmlFiles.length) * 100) : 0;
    this.state.saveProgress(this.fileHash, { chapterPath: this.htmlFiles[this.chapterIndex]?.path || '', scrollPosition: scroll, completionPercent: completion });
  }

  async showRecent() {
    const files = await this.state.getRecentFiles();
    this.recent.load(files);
    this.recent.onSelect = () => alert('Please re-open the file using the file picker');
  }

  showLoading(show) {
    const drop = document.getElementById('drop-zone');
    if (show) {
      drop.classList.add('loading');
      drop.querySelector('.drop-content').innerHTML = '<div class="spinner">Loading...</div>';
    } else {
      drop.classList.remove('loading');
    }
  }

  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered:', reg.scope))
        .catch(err => console.error('SW registration failed:', err));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); window.app.init(); });
