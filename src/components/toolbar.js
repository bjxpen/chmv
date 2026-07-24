/**
 * Toolbar Component - Reader controls and settings
 */
import { appState } from '../state/app-state.js';

export class Toolbar {
  constructor() {
    this.container = null;
    this.onAction = null;
  }

  init(container) {
    this.container = container;
    this.render();
    this.setupEventListeners();
  }

  render() {
    const prefs = appState.getPreferences();
    
    this.container.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-group">
          <button class="toolbar-btn" data-action="open-file" title="Open CHM File (Ctrl+O)">
            📂 Open
          </button>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group">
          <button class="toolbar-btn" data-action="zoom-in" title="Increase Font Size (Ctrl++)">A+</button>
          <button class="toolbar-btn" data-action="zoom-out" title="Decrease Font Size (Ctrl+-)">A-</button>
          <span class="toolbar-label">${prefs.fontSize}px</span>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group">
          <select class="toolbar-select" data-action="width">
            <option value="600px" ${prefs.contentWidth === '600px' ? 'selected' : ''}>Narrow</option>
            <option value="800px" ${prefs.contentWidth === '800px' ? 'selected' : ''}>Medium</option>
            <option value="1000px" ${prefs.contentWidth === '1000px' ? 'selected' : ''}>Wide</option>
            <option value="100%" ${prefs.contentWidth === '100%' ? 'selected' : ''}>Full</option>
          </select>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group">
          <select class="toolbar-select" data-action="theme">
            <option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="sepia" ${prefs.theme === 'sepia' ? 'selected' : ''}>Sepia</option>
            <option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="oled" ${prefs.theme === 'oled' ? 'selected' : ''}>OLED</option>
          </select>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group">
          <select class="toolbar-select" data-action="font-family">
            <option value="system-ui" ${prefs.fontFamily === 'system-ui' ? 'selected' : ''}>Sans-Serif</option>
            <option value="Georgia, serif" ${prefs.fontFamily.includes('Georgia') ? 'selected' : ''}>Serif</option>
            <option value="'KaiTi', 'STKaiti', serif" ${prefs.fontFamily.includes('KaiTi') ? 'selected' : ''}>KaiTi</option>
          </select>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group">
          <button class="toolbar-btn ${prefs.stripLegacyStyles ? 'active' : ''}" data-action="strip-styles" title="Strip Legacy Styles">
            🎨 Clean
          </button>
          <select class="toolbar-select" data-action="encoding">
            <option value="UTF-8" ${prefs.encoding === 'UTF-8' ? 'selected' : ''}>UTF-8</option>
            <option value="GBK" ${prefs.encoding === 'GBK' ? 'selected' : ''}>GBK</option>
            <option value="GB18030" ${prefs.encoding === 'GB18030' ? 'selected' : ''}>GB18030</option>
            <option value="Big5" ${prefs.encoding === 'Big5' ? 'selected' : ''}>Big5</option>
            <option value="Shift-JIS" ${prefs.encoding === 'Shift-JIS' ? 'selected' : ''}>Shift-JIS</option>
          </select>
        </div>
        
        <div class="toolbar-spacer"></div>
        
        <div class="toolbar-group">
          <button class="toolbar-btn" data-action="prev-chapter" title="Previous Chapter (←)">← Prev</button>
          <button class="toolbar-btn" data-action="next-chapter" title="Next Chapter (→)">Next →</button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    this.container.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn');
      if (!btn) return;
      
      const action = btn.dataset.action;
      if (action && this.onAction) {
        this.onAction(action);
      }
    });

    this.container.querySelectorAll('.toolbar-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const action = e.target.dataset.action;
        const value = e.target.value;
        if (action && this.onAction) {
          this.onAction(action, value);
        }
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          if (this.onAction) this.onAction('open-file');
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          if (this.onAction) this.onAction('zoom-in');
        } else if (e.key === '-') {
          e.preventDefault();
          if (this.onAction) this.onAction('zoom-out');
        }
      } else if (e.key === 'ArrowLeft') {
        if (this.onAction) this.onAction('prev-chapter');
      } else if (e.key === 'ArrowRight') {
        if (this.onAction) this.onAction('next-chapter');
      } else if (e.key === ' ') {
        // Space for scroll handled by reader
      }
    });
  }

  setOnAction(handler) {
    this.onAction = handler;
  }

  updateZoomDisplay(fontSize) {
    const label = this.container.querySelector('[data-action="zoom-in"] + [data-action="zoom-out"] + .toolbar-label');
    if (label) label.textContent = `${fontSize}px`;
  }

  destroy() {
    this.container.innerHTML = '';
    this.container = null;
  }
}
