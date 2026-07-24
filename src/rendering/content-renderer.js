/**
 * HTML Content Renderer
 * Handles chapter rendering with sandboxed isolation and asset management
 */

import { appState } from '../state/app-state.js';

export class ContentRenderer {
  constructor() {
    this.container = null;
    this.shadowRoot = null;
    this.currentBlobURLs = new Set();
    this.currentChapter = null;
    this.onLinkClick = null;
    this.onContentLoad = null;
  }

  /**
   * Initialize the renderer
   * @param {HTMLElement} container - Container element
   */
  init(container) {
    this.container = container;
    
    // Create shadow DOM for sandboxed rendering
    const shadowHost = document.createElement('div');
    shadowHost.className = 'content-host';
    container.appendChild(shadowHost);
    
    this.shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    
    // Inject base styles into shadow DOM
    this.injectBaseStyles();
  }

  /**
   * Inject base styles into shadow DOM
   */
  injectBaseStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        min-height: 100%;
      }
      
      .content-wrapper {
        width: var(--content-width, 800px);
        max-width: 100%;
        margin: 0 auto;
        padding: 2rem;
        font-size: var(--font-size, 16px);
        line-height: var(--line-height, 1.6);
        letter-spacing: var(--letter-spacing, 0);
        font-family: var(--font-family, system-ui);
        color: var(--text-color, #333);
        background: var(--bg-color, #fff);
      }
      
      .content-wrapper img {
        max-width: 100%;
        height: auto;
      }
      
      .content-wrapper a {
        color: var(--link-color, #3498db);
        text-decoration: none;
      }
      
      .content-wrapper a:hover {
        text-decoration: underline;
      }
      
      /* CJK typography optimizations */
      .content-wrapper:lang(zh),
      .content-wrapper:lang(ja),
      .content-wrapper:lang(ko) {
        word-break: break-all;
        line-break: strict;
        overflow-wrap: break-word;
      }
      
      /* Remove legacy inline styles when stripLegacyStyles is enabled */
      .strip-legacy [style*="background"],
      .strip-legacy [style*="color"],
      .strip-legacy [style*="font-size"] {
        background: inherit !important;
        color: inherit !important;
        font-size: inherit !important;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  /**
   * Render chapter content
   * @param {string} html - HTML content
   * @param {string} chapterPath - Chapter path for link routing
   * @param {Object} options - Rendering options
   */
  render(html, chapterPath, options = {}) {
    this.currentChapter = chapterPath;
    
    // Clear previous blob URLs to prevent memory leaks
    this.cleanupBlobURLs();
    
    // Apply theme and preferences
    this.applyPreferences(options);
    
    // Process HTML content
    const processedHtml = this.processHTML(html, options);
    
    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'content-wrapper';
    if (options.stripLegacyStyles) {
      contentWrapper.classList.add('strip-legacy');
    }
    
    contentWrapper.innerHTML = processedHtml;
    
    // Clear shadow DOM content (keep styles)
    const styles = this.shadowRoot.querySelectorAll('style');
    this.shadowRoot.innerHTML = '';
    styles.forEach(style => this.shadowRoot.appendChild(style));
    
    // Add content
    this.shadowRoot.appendChild(contentWrapper);
    
    // Setup link interception
    this.setupLinkInterception(contentWrapper);
    
    // Notify content loaded
    if (this.onContentLoad) {
      this.onContentLoad();
    }
  }

  /**
   * Process HTML content
   * @param {string} html - Raw HTML
   * @param {Object} options - Processing options
   * @returns {string} Processed HTML
   */
  processHTML(html, options) {
    let processed = html;
    
    // Fix common encoding issues
    processed = this.fixEncodingIssues(processed);
    
    // Normalize paths in src and href attributes
    processed = this.normalizePaths(processed, options.basePath);
    
    return processed;
  }

  /**
   * Fix common encoding issues in HTML
   * @param {string} html - HTML content
   * @returns {string} Fixed HTML
   */
  fixEncodingIssues(html) {
    // Replace common mojibake patterns
    const fixes = [
      [/Ã—/g, '×'],
      [/Ã©/g, 'é'],
      [/Ã¨/g, 'è'],
      [/Ã /g, 'à'],
      [/â€"/g, '"'],
      [/â€™/g, "'"],
      [/â€"/g, '"'],
      [/â€"/g, '"']
    ];
    
    let result = html;
    fixes.forEach(([pattern, replacement]) => {
      result = result.replace(pattern, replacement);
    });
    
    return result;
  }

  /**
   * Normalize relative paths in HTML
   * @param {string} html - HTML content
   * @param {string} basePath - Base path for resolution
   * @returns {string} HTML with normalized paths
   */
  normalizePaths(html, basePath = '') {
    // This will be handled by link interception
    // For now, just ensure meta charset is set
    if (!html.includes('<meta') && !html.includes('charset')) {
      html = '<meta charset="UTF-8">' + html;
    }
    
    return html;
  }

  /**
   * Setup link click interception
   * @param {HTMLElement} container - Content container
   */
  setupLinkInterception(container) {
    container.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      
      const href = link.getAttribute('href');
      
      // Check if it's an internal link
      if (this.isInternalLink(href)) {
        e.preventDefault();
        
        if (this.onLinkClick) {
          const resolvedPath = this.resolveInternalPath(href);
          this.onLinkClick(resolvedPath);
        }
      }
      // External links are allowed to open normally
    });
  }

  /**
   * Check if a link is internal
   * @param {string} href - Link href
   * @returns {boolean} True if internal
   */
  isInternalLink(href) {
    if (!href) return false;
    
    // Ignore external links, anchors, javascript, mailto, etc.
    if (href.startsWith('http://') || 
        href.startsWith('https://') ||
        href.startsWith('//') ||
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:')) {
      return false;
    }
    
    // Internal CHM links are typically relative paths
    return true;
  }

  /**
   * Resolve internal path
   * @param {string} href - Relative href
   * @returns {string} Resolved path
   */
  resolveInternalPath(href) {
    if (!this.currentChapter) return href;
    
    // Get directory of current chapter
    const lastSlash = this.currentChapter.lastIndexOf('/');
    const currentDir = lastSlash >= 0 ? 
      this.currentChapter.substring(0, lastSlash + 1) : '';
    
    // Handle relative paths
    if (href.startsWith('./')) {
      return currentDir + href.substring(2);
    } else if (href.startsWith('../')) {
      // Go up one directory
      const parentDir = currentDir.substring(0, currentDir.lastIndexOf('/'));
      return parentDir + '/' + href.substring(3);
    } else if (href.startsWith('/')) {
      // Absolute path from root
      return href.substring(1);
    } else {
      // Relative to current directory
      return currentDir + href;
    }
  }

  /**
   * Apply user preferences to rendering
   * @param {Object} options - Rendering options
   */
  applyPreferences(options) {
    const prefs = appState.getPreferences();
    const mergedOptions = { ...prefs, ...options };
    
    // Set CSS custom properties on shadow host
    const host = this.shadowRoot.host;
    
    // Theme colors
    const themeColors = this.getThemeColors(mergedOptions.theme);
    host.style.setProperty('--text-color', themeColors.text);
    host.style.setProperty('--bg-color', themeColors.bg);
    host.style.setProperty('--link-color', themeColors.link);
    
    // Typography
    host.style.setProperty('--content-width', mergedOptions.contentWidth);
    host.style.setProperty('--font-size', `${mergedOptions.fontSize}px`);
    host.style.setProperty('--line-height', mergedOptions.lineHeight);
    host.style.setProperty('--letter-spacing', `${mergedOptions.letterSpacing}px`);
    host.style.setProperty('--font-family', mergedOptions.fontFamily);
  }

  /**
   * Get theme color scheme
   * @param {string} theme - Theme name
   * @returns {Object} Color values
   */
  getThemeColors(theme) {
    const themes = {
      light: {
        text: '#333333',
        bg: '#ffffff',
        link: '#3498db'
      },
      sepia: {
        text: '#5b4635',
        bg: '#f4ecd8',
        link: '#8b4513'
      },
      dark: {
        text: '#e0e0e0',
        bg: '#2c2c2c',
        link: '#64b5f6'
      },
      oled: {
        text: '#cccccc',
        bg: '#000000',
        link: '#4fc3f7'
      }
    };
    
    return themes[theme] || themes.light;
  }

  /**
   * Cleanup blob URLs to prevent memory leaks
   */
  cleanupBlobURLs() {
    this.currentBlobURLs.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.currentBlobURLs.clear();
  }

  /**
   * Register a blob URL for cleanup
   * @param {string} url - Blob URL
   */
  registerBlobURL(url) {
    this.currentBlobURLs.add(url);
  }

  /**
   * Set link click handler
   * @param {Function} handler - Click handler function
   */
  setOnLinkClick(handler) {
    this.onLinkClick = handler;
  }

  /**
   * Set content load handler
   * @param {Function} handler - Load handler function
   */
  setOnContentLoad(handler) {
    this.onContentLoad = handler;
  }

  /**
   * Clear rendered content
   */
  clear() {
    this.cleanupBlobURLs();
    if (this.shadowRoot) {
      const styles = this.shadowRoot.querySelectorAll('style');
      this.shadowRoot.innerHTML = '';
      styles.forEach(style => this.shadowRoot.appendChild(style));
    }
    this.currentChapter = null;
  }

  /**
   * Destroy renderer and cleanup
   */
  destroy() {
    this.clear();
    if (this.container && this.shadowRoot) {
      this.container.removeChild(this.shadowRoot.host);
    }
    this.container = null;
    this.shadowRoot = null;
  }
}
