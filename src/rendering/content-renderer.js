/**
 * Content Renderer - Shadow DOM based chapter rendering
 * Handles asset management, link routing, and theme application
 */
import { html, css } from 'lit';

export class ContentRenderer {
  constructor() {
    this.container = null;
    this.shadow = null;
    this.blobURLs = new Set();
    this.chapter = null;
    this.onLink = null;
    this.onLoad = null;
  }

  init(container) {
    this.container = container;
    const host = document.createElement('div');
    host.className = 'content-host';
    container.appendChild(host);
    this.shadow = host.attachShadow({ mode: 'open' });
    this.injectStyles();
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = css`
      :host { display: block; width: 100%; min-height: 100%; }
      .content {
        width: var(--content-width, 800px);
        max-width: 100%; margin: 0 auto; padding: 2rem;
        font-size: var(--font-size, 16px);
        line-height: var(--line-height, 1.6);
        letter-spacing: var(--letter-spacing, 0);
        font-family: var(--font-family, system-ui);
        color: var(--text-color, #333);
        background: var(--bg-color, #fff);
      }
      .content img { max-width: 100%; height: auto; }
      .content a { color: var(--link-color, #3498db); text-decoration: none; }
      .content a:hover { text-decoration: underline; }
      .content:lang(zh), .content:lang(ja), .content:lang(ko) {
        word-break: break-all; line-break: strict; overflow-wrap: break-word;
      }
      .strip-legacy [style*="background"], .strip-legacy [style*="color"] {
        background: inherit !important; color: inherit !important;
      }
    `;
    this.shadow.appendChild(style);
  }

  render(htmlContent, chapterPath, options = {}) {
    this.chapter = chapterPath;
    this.cleanupBlobs();
    
    const prefs = options.prefs || {};
    this.applyPrefs(prefs);

    const processed = this.processHTML(htmlContent, options);
    const content = document.createElement('div');
    content.className = `content${options.stripLegacyStyles ? ' strip-legacy' : ''}`;
    content.innerHTML = processed;

    // Clear shadow except styles
    const styles = this.shadow.querySelectorAll('style');
    this.shadow.innerHTML = '';
    styles.forEach(s => this.shadow.appendChild(s));
    this.shadow.appendChild(content);

    this.setupLinkIntercept(content);
    this.onLoad?.();
  }

  processHTML(html, options) {
    let result = html
      .replace(/Ã—/g, '×').replace(/Ã©/g, 'é')
      .replace(/â€"/g, '"').replace(/â€™/g, "'");
    
    if (!result.includes('charset')) {
      result = '<meta charset="UTF-8">' + result;
    }
    return result;
  }

  setupLinkIntercept(container) {
    container.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      
      const href = link.getAttribute('href');
      if (this.isInternal(href)) {
        e.preventDefault();
        this.onLink?.(this.resolvePath(href));
      }
    });
  }

  isInternal(href) {
    if (!href) return false;
    return !href.startsWith('http') && !href.startsWith('//') &&
           !href.startsWith('#') && !href.startsWith('javascript:') &&
           !href.startsWith('mailto:');
  }

  resolvePath(href) {
    if (!this.chapter) return href;
    const dir = this.chapter.substring(0, this.chapter.lastIndexOf('/') + 1);
    
    if (href.startsWith('./')) return dir + href.slice(2);
    if (href.startsWith('../')) {
      const parent = dir.substring(0, dir.lastIndexOf('/'));
      return parent + '/' + href.slice(3);
    }
    if (href.startsWith('/')) return href.slice(1);
    return dir + href;
  }

  applyPrefs(prefs) {
    const host = this.shadow.host;
    const themes = {
      light: { text: '#333', bg: '#fff', link: '#3498db' },
      sepia: { text: '#5b4635', bg: '#f4ecd8', link: '#8b4513' },
      dark: { text: '#e0e0e0', bg: '#2c2c2c', link: '#64b5f6' },
      oled: { text: '#ccc', bg: '#000', link: '#4fc3f7' }
    };
    const t = themes[prefs.theme] || themes.light;
    
    host.style.setProperty('--text-color', t.text);
    host.style.setProperty('--bg-color', t.bg);
    host.style.setProperty('--link-color', t.link);
    host.style.setProperty('--content-width', prefs.contentWidth);
    host.style.setProperty('--font-size', `${prefs.fontSize}px`);
    host.style.setProperty('--line-height', prefs.lineHeight);
    host.style.setProperty('--font-family', prefs.fontFamily);
  }

  registerBlob(url) {
    this.blobURLs.add(url);
  }

  cleanupBlobs() {
    this.blobURLs.forEach(u => URL.revokeObjectURL(u));
    this.blobURLs.clear();
  }

  clear() {
    this.cleanupBlobs();
    const styles = this.shadow?.querySelectorAll('style') || [];
    if (this.shadow) {
      this.shadow.innerHTML = '';
      styles.forEach(s => this.shadow.appendChild(s));
    }
    this.chapter = null;
  }

  destroy() {
    this.clear();
    if (this.container && this.shadow) {
      this.container.removeChild(this.shadow.host);
    }
  }
}
