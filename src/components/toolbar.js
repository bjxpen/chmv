/**
 * Toolbar Component - Reader controls and settings
 * LitElement-based with declarative rendering
 */
import { html, css } from 'lit';
import { BaseComponent } from '../core/base-component.js';

export class Toolbar extends BaseComponent {
  static properties = {
    fontSize: { type: Number },
    contentWidth: { type: String },
    theme: { type: String },
    fontFamily: { type: String },
    stripLegacyStyles: { type: Boolean },
    encoding: { type: String }
  };

  static styles = css`
    :host { display: block; }
    .toolbar {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.5rem; background: #fff;
      border-bottom: 1px solid #dcdde1; flex-wrap: wrap;
    }
    .group { display: flex; align-items: center; gap: 0.25rem; }
    .btn {
      padding: 0.4rem 0.75rem; border: 1px solid #dcdde1;
      background: white; border-radius: 4px; cursor: pointer;
      font-size: 0.85rem; transition: all 0.2s;
    }
    .btn:hover { background: #ecf0f1; }
    .btn.active { background: #3498db; color: white; border-color: #3498db; }
    .select {
      padding: 0.4rem 0.5rem; border: 1px solid #dcdde1;
      border-radius: 4px; font-size: 0.85rem; background: white; cursor: pointer;
    }
    .label { font-size: 0.85rem; min-width: 40px; text-align: center; }
    .divider { width: 1px; height: 24px; background: #dcdde1; margin: 0 0.5rem; }
    .spacer { flex: 1; }
  `;

  constructor() {
    super();
    this.fontSize = 16;
    this.contentWidth = '800px';
    this.theme = 'light';
    this.fontFamily = 'system-ui';
    this.stripLegacyStyles = false;
    this.encoding = 'UTF-8';
    this.onAction = null;
  }

  render() {
    return html`
      <div class="toolbar">
        <div class="group">
          <button class="btn" @click=${() => this.dispatch('open-file')} title="Open (Ctrl+O)">
            📂 Open
          </button>
        </div>
        
        <div class="divider"></div>
        
        <div class="group">
          <button class="btn" @click=${() => this.dispatch('zoom-in')} title="Zoom In (Ctrl++)">A+</button>
          <button class="btn" @click=${() => this.dispatch('zoom-out')} title="Zoom Out (Ctrl+-)">A-</button>
          <span class="label">${this.fontSize}px</span>
        </div>
        
        <div class="divider"></div>
        
        <div class="group">
          <select class="select" @change=${(e) => this.dispatch('width', e.target.value)}>
            <option value="600px" ?selected=${this.contentWidth === '600px'}>Narrow</option>
            <option value="800px" ?selected=${this.contentWidth === '800px'}>Medium</option>
            <option value="1000px" ?selected=${this.contentWidth === '1000px'}>Wide</option>
            <option value="100%" ?selected=${this.contentWidth === '100%'}>Full</option>
          </select>
        </div>
        
        <div class="divider"></div>
        
        <div class="group">
          <select class="select" @change=${(e) => this.dispatch('theme', e.target.value)}>
            <option value="light" ?selected=${this.theme === 'light'}>Light</option>
            <option value="sepia" ?selected=${this.theme === 'sepia'}>Sepia</option>
            <option value="dark" ?selected=${this.theme === 'dark'}>Dark</option>
            <option value="oled" ?selected=${this.theme === 'oled'}>OLED</option>
          </select>
        </div>
        
        <div class="divider"></div>
        
        <div class="group">
          <select class="select" @change=${(e) => this.dispatch('font', e.target.value)}>
            <option value="system-ui" ?selected=${this.fontFamily === 'system-ui'}>Sans</option>
            <option value="Georgia, serif" ?selected=${this.fontFamily?.includes('Georgia')}>Serif</option>
            <option value="'KaiTi', 'STKaiti', serif" ?selected=${this.fontFamily?.includes('KaiTi')}>KaiTi</option>
          </select>
        </div>
        
        <div class="divider"></div>
        
        <div class="group">
          <button class="btn ${this.stripLegacyStyles ? 'active' : ''}" 
            @click=${() => this.dispatch('strip-styles')} title="Strip Legacy Styles">
            🎨 Clean
          </button>
          <select class="select" @change=${(e) => this.dispatch('encoding', e.target.value)}>
            <option value="UTF-8" ?selected=${this.encoding === 'UTF-8'}>UTF-8</option>
            <option value="GBK" ?selected=${this.encoding === 'GBK'}>GBK</option>
            <option value="GB18030" ?selected=${this.encoding === 'GB18030'}>GB18030</option>
            <option value="Big5" ?selected=${this.encoding === 'Big5'}>Big5</option>
            <option value="Shift-JIS" ?selected=${this.encoding === 'Shift-JIS'}>Shift-JIS</option>
          </select>
        </div>
        
        <div class="spacer"></div>
        
        <div class="group">
          <button class="btn" @click=${() => this.dispatch('prev-chapter')} title="Previous (←)">← Prev</button>
          <button class="btn" @click=${() => this.dispatch('next-chapter')} title="Next (→)">Next →</button>
        </div>
      </div>
    `;
  }

  dispatch(action, value) {
    this.onAction?.(action, value);
  }

  setPrefs(prefs) {
    this.fontSize = prefs.fontSize || 16;
    this.contentWidth = prefs.contentWidth || '800px';
    this.theme = prefs.theme || 'light';
    this.fontFamily = prefs.fontFamily || 'system-ui';
    this.stripLegacyStyles = prefs.stripLegacyStyles || false;
    this.encoding = prefs.encoding || 'UTF-8';
  }
}

customElements.define('chmv-toolbar', Toolbar);
