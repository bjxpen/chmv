/**
 * Sidebar Navigation Component
 * Handles TOC tree view, index, and search functionality
 */

import { appState } from '../state/app-state.js';

export class Sidebar {
  constructor() {
    this.container = null;
    this.tocData = null;
    this.indexData = null;
    this.activeTab = 'toc';
    this.onChapterSelect = null;
    this.isCollapsed = false;
    this.isResizing = false;
  }

  init(container) {
    this.container = container;
    this.render();
    this.setupEventListeners();
    this.setupResizer();
  }

  render() {
    const prefs = appState.getPreferences();
    
    this.container.innerHTML = `
      <div class="sidebar-container" style="width: ${prefs.sidebarWidth}px;">
        <div class="sidebar-header">
          <div class="sidebar-tabs">
            <button class="tab-btn active" data-tab="toc" title="Table of Contents">TOC</button>
            <button class="tab-btn" data-tab="index" title="Index">Index</button>
          </div>
          <div class="sidebar-actions">
            <button class="collapse-btn" title="Collapse Sidebar (B)">◀</button>
          </div>
        </div>
        <div class="sidebar-search">
          <input type="text" class="search-input" placeholder="Search chapters...">
        </div>
        <div class="sidebar-content">
          <div class="toc-panel panel active" id="toc-panel"></div>
          <div class="index-panel panel" id="index-panel"></div>
        </div>
        <div class="sidebar-resizer"></div>
      </div>
    `;
  }

  setupEventListeners() {
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    this.container.querySelector('.collapse-btn').addEventListener('click', () => {
      this.toggleCollapse();
    });

    const searchInput = this.container.querySelector('.search-input');
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.filterContent(e.target.value);
      }, 200);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'b' || e.key === 'B') {
        this.toggleCollapse();
      }
    });
  }

  setupResizer() {
    const resizer = this.container.querySelector('.sidebar-resizer');
    const sidebarContainer = this.container.querySelector('.sidebar-container');
    
    resizer.addEventListener('mousedown', (e) => {
      this.isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= 150 && newWidth <= 600) {
        sidebarContainer.style.width = `${newWidth}px`;
        appState.setPreference('sidebarWidth', newWidth);
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    this.container.querySelectorAll('.panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `${tab}-panel`);
    });
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    const sidebarContainer = this.container.querySelector('.sidebar-container');
    const collapseBtn = this.container.querySelector('.collapse-btn');
    
    if (this.isCollapsed) {
      sidebarContainer.classList.add('collapsed');
      collapseBtn.textContent = '▶';
    } else {
      sidebarContainer.classList.remove('collapsed');
      collapseBtn.textContent = '◀';
    }
    appState.setPreference('sidebarVisible', !this.isCollapsed);
  }

  loadTOC(tocData) {
    this.tocData = tocData;
    const tocPanel = this.container.querySelector('#toc-panel');
    
    if (!tocData || tocData.length === 0) {
      tocPanel.innerHTML = '<div class="empty-message">No table of contents found</div>';
      return;
    }
    
    tocPanel.innerHTML = this.renderTOCTree(tocData);
    this.setupTOCInteractions(tocPanel);
  }

  renderTOCTree(items, level = 0) {
    if (!items || items.length === 0) return '';
    const indent = level * 16;
    
    return items.map(item => {
      const hasChildren = item.children && item.children.length > 0;
      return `
        <div class="toc-item" data-path="${item.path || ''}" style="padding-left: ${indent}px">
          <div class="toc-item-content">
            ${hasChildren ? '<button class="toc-expand-btn">▶</button>' : '<span class="toc-spacer"></span>'}
            <span class="toc-title">${this.escapeHtml(item.title || 'Untitled')}</span>
          </div>
          ${hasChildren ? `<div class="toc-children collapsed">${this.renderTOCTree(item.children, level + 1)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  setupTOCInteractions(panel) {
    panel.querySelectorAll('.toc-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tocItem = btn.closest('.toc-item');
        const children = tocItem.querySelector('.toc-children');
        if (children) {
          children.classList.toggle('collapsed');
          btn.textContent = children.classList.contains('collapsed') ? '▶' : '▼';
        }
      });
    });

    panel.querySelectorAll('.toc-item[data-path]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.toc-expand-btn')) return;
        const path = item.dataset.path;
        if (path && this.onChapterSelect) {
          this.selectChapter(path);
        }
      });
    });
  }

  selectChapter(path) {
    this.container.querySelectorAll('.toc-item.selected').forEach(item => {
      item.classList.remove('selected');
    });
    
    const selectedItem = this.container.querySelector(`.toc-item[data-path="${path}"]`);
    if (selectedItem) {
      selectedItem.classList.add('selected');
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
    
    if (this.onChapterSelect) {
      this.onChapterSelect(path);
    }
  }

  loadIndex(indexData) {
    this.indexData = indexData;
    const indexPanel = this.container.querySelector('#index-panel');
    
    if (!indexData || indexData.length === 0) {
      indexPanel.innerHTML = '<div class="empty-message">No index found</div>';
      return;
    }
    
    indexPanel.innerHTML = `
      <div class="index-list">
        ${indexData.map(entry => `
          <div class="index-item" data-path="${entry.path || ''}">
            <span class="index-keyword">${this.escapeHtml(entry.keyword || 'Unknown')}</span>
          </div>
        `).join('')}
      </div>
    `;
    
    indexPanel.querySelectorAll('.index-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = item.dataset.path;
        if (path && this.onChapterSelect) {
          this.onChapterSelect(path);
        }
      });
    });
  }

  filterContent(query) {
    const lowerQuery = query.toLowerCase().trim();
    
    if (!lowerQuery) {
      this.container.querySelectorAll('.toc-item, .index-item').forEach(item => {
        item.style.display = '';
      });
      return;
    }
    
    this.container.querySelectorAll('.toc-item').forEach(item => {
      const title = item.querySelector('.toc-title')?.textContent || '';
      item.style.display = title.toLowerCase().includes(lowerQuery) ? '' : 'none';
    });
    
    this.container.querySelectorAll('.index-item').forEach(item => {
      const keyword = item.querySelector('.index-keyword')?.textContent || '';
      item.style.display = keyword.toLowerCase().includes(lowerQuery) ? '' : 'none';
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  setOnChapterSelect(handler) {
    this.onChapterSelect = handler;
  }

  destroy() {
    this.container.innerHTML = '';
    this.container = null;
    this.tocData = null;
    this.indexData = null;
  }
}
