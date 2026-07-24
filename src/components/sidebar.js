/**
 * Sidebar Component - TOC and Index navigation
 * LitElement-based with declarative rendering
 */
import { html, css } from 'lit';
import { BaseComponent } from '../core/base-component.js';

export class Sidebar extends BaseComponent {
  static properties = {
    collapsed: { type: Boolean },
    activeTab: { type: String },
    tocData: { type: Array },
    indexData: { type: Array },
    selectedPath: { type: String }
  };

  static styles = css`
    :host { display: block; height: 100%; }
    .sidebar {
      display: flex; flex-direction: column; height: 100%;
      background: #fff; border-right: 1px solid #dcdde1;
      width: var(--sidebar-width, 280px);
    }
    .sidebar.collapsed { width: 0 !important; border: none; overflow: hidden; }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.5rem; border-bottom: 1px solid #dcdde1;
    }
    .tabs { display: flex; gap: 0.25rem; }
    .tab-btn {
      padding: 0.4rem 0.75rem; border: none; background: transparent;
      cursor: pointer; border-radius: 4px; font-size: 0.85rem;
    }
    .tab-btn:hover { background: #ecf0f1; }
    .tab-btn.active { background: #3498db; color: white; }
    .collapse-btn {
      padding: 0.4rem; border: none; background: transparent;
      cursor: pointer; border-radius: 4px;
    }
    .search { padding: 0.5rem; border-bottom: 1px solid #dcdde1; }
    .search input {
      width: 100%; padding: 0.5rem; border: 1px solid #dcdde1;
      border-radius: 4px; font-size: 0.85rem;
    }
    .content { flex: 1; overflow-y: auto; }
    .panel { display: none; }
    .panel.active { display: block; }
    .toc-item { cursor: pointer; }
    .toc-content {
      display: flex; align-items: center; padding: 0.4rem 0.5rem; gap: 0.5rem;
    }
    .toc-content:hover { background: #ecf0f1; }
    .toc-item.selected .toc-content { background: #3498db; color: white; }
    .expand-btn, .spacer {
      width: 16px; height: 16px; display: flex; align-items: center;
      justify-content: center; border: none; background: transparent;
      cursor: pointer; font-size: 10px;
    }
    .children { display: block; }
    .children.collapsed { display: none; }
    .index-list { padding: 0.5rem; }
    .index-item {
      padding: 0.4rem 0.5rem; cursor: pointer; border-radius: 4px;
    }
    .index-item:hover { background: #ecf0f1; }
    .empty { padding: 1rem; text-align: center; color: #7f8c8d; }
  `;

  constructor() {
    super();
    this.collapsed = false;
    this.activeTab = 'toc';
    this.tocData = [];
    this.indexData = [];
    this.selectedPath = '';
    this.onSelect = null;
    this.searchQuery = '';
  }

  render() {
    return html`
      <div class="sidebar ${this.collapsed ? 'collapsed' : ''}">
        <div class="header">
          <div class="tabs">
            <button class="tab-btn ${this.activeTab === 'toc' ? 'active' : ''}"
              @click=${() => this.activeTab = 'toc'}>TOC</button>
            <button class="tab-btn ${this.activeTab === 'index' ? 'active' : ''}"
              @click=${() => this.activeTab = 'index'}>Index</button>
          </div>
          <button class="collapse-btn" @click=${this.toggleCollapse}>
            ${this.collapsed ? '▶' : '◀'}
          </button>
        </div>
        <div class="search">
          <input type="text" placeholder="Search..." 
            value=${this.searchQuery}
            @input=${this.debounce((e) => { this.searchQuery = e.target.value; }, 200)} />
        </div>
        <div class="content">
          <div class="panel ${this.activeTab === 'toc' ? 'active' : ''}">
            ${this.renderTOC()}
          </div>
          <div class="panel ${this.activeTab === 'index' ? 'active' : ''}">
            ${this.renderIndex()}
          </div>
        </div>
      </div>
    `;
  }

  renderTOC() {
    if (!this.tocData?.length) {
      return html`<div class="empty">No table of contents</div>`;
    }
    return html`${this.renderTOCTree(this.filterTOC(this.tocData))}`;
  }

  renderTOCTree(items, level = 0) {
    const indent = level * 16;
    return items.map(item => {
      const hasChildren = item.children?.length > 0;
      return html`
        <div class="toc-item ${item.path === this.selectedPath ? 'selected' : ''}"
          style="padding-left: ${indent}px">
          <div class="toc-content" @click=${() => this.selectChapter(item.path)}>
            ${hasChildren 
              ? html`<button class="expand-btn" @click=${(e) => this.toggleExpand(e)}>▶</button>`
              : html`<span class="spacer"></span>`}
            <span class="title">${this.escapeHtml(item.title || 'Untitled')}</span>
          </div>
          ${hasChildren 
            ? html`<div class="children collapsed">${this.renderTOCTree(item.children, level + 1)}</div>`
            : ''}
        </div>
      `;
    });
  }

  renderIndex() {
    if (!this.indexData?.length) {
      return html`<div class="empty">No index found</div>`;
    }
    return html`
      <div class="index-list">
        ${this.filterIndex(this.indexData).map(entry => html`
          <div class="index-item" @click=${() => this.selectChapter(entry.path)}>
            <span>${this.escapeHtml(entry.keyword || 'Unknown')}</span>
          </div>
        `)}
      </div>
    `;
  }

  filterTOC(items) {
    if (!this.searchQuery) return items;
    const q = this.searchQuery.toLowerCase();
    return items.filter(i => i.title?.toLowerCase().includes(q));
  }

  filterIndex(items) {
    if (!this.searchQuery) return items;
    const q = this.searchQuery.toLowerCase();
    return items.filter(i => i.keyword?.toLowerCase().includes(q));
  }

  toggleExpand(e) {
    e.stopPropagation();
    const children = e.target.closest('.toc-item').querySelector('.children');
    if (children) {
      children.classList.toggle('collapsed');
      e.target.textContent = children.classList.contains('collapsed') ? '▶' : '▼';
    }
  }

  selectChapter(path) {
    this.selectedPath = path;
    this.onSelect?.(path);
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    document.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: this.collapsed } }));
  }

  loadTOC(data) {
    this.tocData = data || [];
    this.requestUpdate();
  }

  loadIndex(data) {
    this.indexData = data || [];
    this.requestUpdate();
  }

  select(path) {
    this.selectedPath = path;
    this.requestUpdate();
  }
}

customElements.define('chmv-sidebar', Sidebar);
