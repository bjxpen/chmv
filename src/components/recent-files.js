/**
 * Recent Files Dashboard Component
 */
import { html, css } from 'lit';
import { BaseComponent } from '../core/base-component.js';

export class RecentFiles extends BaseComponent {
  static properties = {
    files: { type: Array }
  };

  static styles = css`
    :host { display: block; padding: 1rem; background: #f5f6fa; }
    h3 { margin-bottom: 0.75rem; font-size: 1rem; }
    .list {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 0.75rem;
    }
    .item {
      background: white; padding: 0.75rem; border-radius: 6px;
      border: 1px solid #dcdde1; cursor: pointer; transition: all 0.2s;
    }
    .item:hover {
      border-color: #3498db; transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .name { font-weight: 500; margin-bottom: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: #7f8c8d; }
    .empty { text-align: center; padding: 2rem; color: #7f8c8d; }
  `;

  constructor() {
    super();
    this.files = [];
    this.onSelect = null;
  }

  render() {
    if (!this.files?.length) {
      return html`
        <div class="empty">
          <h3>No recent files</h3>
          <p>Open a CHM file to get started</p>
        </div>
      `;
    }

    return html`
      <h3>Recent Files</h3>
      <div class="list">
        ${this.files.map(f => html`
          <div class="item" @click=${() => this.select(f)}>
            <div class="name">${f.fileName}</div>
            <div class="meta">
              <span>${f.completionPercent || 0}% complete</span>
              <span>${this.formatDate(f.lastOpened)}</span>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  select(file) {
    // Note: File re-opening requires user to pick file again due to security
    this.onSelect?.(file);
  }

  formatDate(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  load(files) {
    this.files = files || [];
    this.requestUpdate();
  }
}

customElements.define('chmv-recent', RecentFiles);
