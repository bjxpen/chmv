/*
 * renderer.js — chapter rendering inside an isolated Shadow DOM.
 *
 * Every chapter is parsed with DOMParser (inert: scripts never execute),
 * sanitized (scripts / event handlers / plugins removed), its asset
 * references rewritten to blob: URLs served from the CHM archive, and the
 * result adopted into a closed shadow root so legacy tag soup and CSS
 * can't leak into — or be broken by — the host application.
 */

'use strict';

import { normalizePath, fragmentOf, isExternalHref } from '../engine/paths.js';
import { effectiveEncoding, decodeBytes } from '../engine/encodings.js';

const DROP_TAGS = new Set([
  'script', 'object', 'embed', 'applet', 'iframe', 'frame', 'frameset',
  'base', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta',
  'noscript', 'template', 'xml', 'audio', 'video', 'source', 'track',
]);

/* presentational attributes stripped in "override legacy styles" mode */
const LEGACY_PRESENTATION_ATTRS = [
  'bgcolor', 'text', 'link', 'vlink', 'alink', 'background', 'color',
  'face', 'size', 'align', 'valign', 'border', 'cellpadding', 'cellspacing',
  'width', 'height', 'hspace', 'vspace',
];

export class Renderer {
  /**
   * @param {HTMLElement} host element that owns the shadow root
   * @param {{
   *   fetchAsset: (path: string) => Promise<{found: boolean, mime?: string, buffer?: ArrayBuffer}>,
   *   onNavigate: (path: string, fragment: string) => void,
   * }} hooks
   */
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks;
    this.shadow = host.attachShadow({ mode: 'open' });

    /* base stylesheet: typography + theme variables come from the host
     * via CSS custom properties that pierce the shadow boundary. */
    this.baseStyle = document.createElement('style');
    this.shadow.appendChild(this.baseStyle);

    this.container = document.createElement('div');
    this.container.className = 'chapters';
    this.shadow.appendChild(this.container);

    /* blob bookkeeping: section element -> Set<blobURL> */
    this.sectionBlobs = new Map();
    /* small shared asset cache to dedupe repeated images (path -> {url, refs}) */
    this.assetCache = new Map();

    this.overrideStyles = true;
    this.bookEncoding = 'utf-8';
    this.encodingOverride = null;

    this.shadow.addEventListener('click', (e) => this._onClick(e));
    this._applyBaseStyle();
  }

  setStyleOverride(on) {
    this.overrideStyles = !!on;
    this._applyBaseStyle();
  }

  setEncodings(bookEncoding, override) {
    this.bookEncoding = bookEncoding || 'utf-8';
    this.encodingOverride = override || null;
  }

  _applyBaseStyle() {
    const overrides = this.overrideStyles
      ? `
      /* Neutralize hardcoded legacy styling so themes apply uniformly. */
      .chapters section.doc, .chapters section.doc * {
        background: transparent !important;
        color: inherit !important;
        font-family: inherit !important;
        line-height: inherit !important;
        letter-spacing: inherit !important;
      }
      .chapters section.doc font { font-size: inherit !important; }
      .chapters section.doc table { border-color: color-mix(in srgb, currentColor 25%, transparent) !important; }
      `
      : '';

    this.baseStyle.textContent = `
      :host { display: block; }
      .chapters {
        color: var(--reader-fg, #333);
        font-family: var(--reader-font, sans-serif);
        font-size: var(--reader-font-size, 18px);
        line-height: var(--reader-line-height, 1.8);
        letter-spacing: var(--reader-letter-spacing, 0.02em);
        overflow-wrap: break-word;
        word-break: normal;
        line-break: loose;
        text-align: justify;
        text-justify: inter-ideograph;
      }
      section.doc { padding: 0 0 1em; }
      section.doc:focus { outline: none; }
      section.doc p, section.doc div {
        margin-block-start: var(--reader-para-spacing, 0.9em);
        margin-block-end: var(--reader-para-spacing, 0.9em);
      }
      section.doc h1, section.doc h2, section.doc h3, section.doc h4 {
        line-height: 1.4;
        margin: 1.2em 0 0.6em;
      }
      section.doc img { max-width: 100%; height: auto; }
      section.doc table { max-width: 100%; border-collapse: collapse; }
      section.doc td, section.doc th { padding: 2px 8px; }
      section.doc pre, section.doc code, section.doc tt {
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        line-break: auto;
      }
      section.doc pre {
        overflow-x: auto;
        background: color-mix(in srgb, currentColor 7%, transparent);
        padding: 0.7em 1em;
        border-radius: 6px;
      }
      section.doc a { color: var(--reader-link, #2467c6); }
      section.doc hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
      .chapter-divider {
        display: flex; align-items: center; gap: 1em;
        margin: 2.2em 0; color: var(--reader-fg-muted, #999);
        font-size: 0.8em; user-select: none;
      }
      .chapter-divider::before, .chapter-divider::after {
        content: ''; flex: 1;
        border-top: 1px solid color-mix(in srgb, currentColor 35%, transparent);
      }
      ${overrides}
    `;
  }

  /* ---------------------------------------------------------------- */

  /**
   * Render a document, replacing all current sections.
   * @returns {Promise<HTMLElement>} the rendered section
   */
  async renderChapter(path, bytes) {
    this.clear();
    return this.appendChapter(path, bytes);
  }

  /** Append a document as a new section (infinite-scroll mode). */
  async appendChapter(path, bytes, { divider = false, title = '' } = {}) {
    const section = await this._buildSection(path, bytes);
    if (divider && this.container.children.length > 0) {
      const div = document.createElement('div');
      div.className = 'chapter-divider';
      div.textContent = title || path.split('/').pop();
      this.container.appendChild(div);
      /* divider belongs to this section for pruning purposes */
      section._divider = div;
    }
    this.container.appendChild(section);
    return section;
  }

  /** Remove one section and revoke its blob URLs. */
  removeSection(section) {
    const blobs = this.sectionBlobs.get(section);
    if (blobs) {
      for (const path of blobs) this._releaseAsset(path);
      this.sectionBlobs.delete(section);
    }
    if (section._divider) section._divider.remove();
    section.remove();
  }

  /** Remove everything and free every object URL. */
  clear() {
    for (const section of [...this.sectionBlobs.keys()]) this.removeSection(section);
    this.container.textContent = '';
    /* safety net: revoke anything that leaked */
    for (const [path, rec] of this.assetCache) {
      URL.revokeObjectURL(rec.url);
      this.assetCache.delete(path);
    }
  }

  get sections() {
    return [...this.container.querySelectorAll('section.doc')];
  }

  /* ---------------------------------------------------------------- */

  async _buildSection(path, bytes) {
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const encoding = effectiveEncoding(raw, this.encodingOverride, this.bookEncoding);
    const html = decodeBytes(raw, encoding);

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const section = document.createElement('section');
    section.className = 'doc';
    section.dataset.path = path;
    section.dataset.encoding = encoding;
    const blobs = new Set();
    this.sectionBlobs.set(section, blobs);

    /* collect document stylesheets before sanitization removes <link> */
    const styleTexts = [];
    if (!this.overrideStyles) {
      for (const el of doc.querySelectorAll('style')) {
        styleTexts.push({ css: el.textContent || '', base: path });
      }
      for (const el of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
        const cssPath = normalizePath(path, el.getAttribute('href'));
        if (cssPath) styleTexts.push({ path: cssPath, base: cssPath });
      }
    }

    this._sanitize(doc, path);

    /* move body children into the section */
    const body = doc.body || doc.documentElement;
    while (body.firstChild) section.appendChild(body.firstChild);

    /* resolve assets referenced from the content */
    await this._resolveAssets(section, path, blobs);

    /* attach document styles (scoped by cascade: section styles live
     * inside the shadow root already) */
    if (!this.overrideStyles && styleTexts.length) {
      const styleEl = document.createElement('style');
      let cssAll = '';
      for (const st of styleTexts) {
        let css = st.css;
        if (st.path) {
          const asset = await this._fetchRaw(st.path);
          if (!asset) continue;
          css = decodeBytes(new Uint8Array(asset.buffer), 'utf-8');
        }
        cssAll += await this._rewriteCss(css, st.base, blobs, 0);
        cssAll += '\n';
      }
      styleEl.textContent = cssAll;
      section.insertBefore(styleEl, section.firstChild);
    }

    return section;
  }

  _sanitize(doc, docPath) {
    /* remove dangerous / irrelevant elements entirely */
    const selector = [...DROP_TAGS].join(',');
    for (const el of doc.querySelectorAll(selector)) el.remove();

    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    const els = [];
    while (walker.nextNode()) els.push(walker.currentNode);

    for (const el of els) {
      /* strip event handlers and javascript: URLs */
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'action') &&
                 /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      if (this.overrideStyles) {
        el.removeAttribute('style');
        for (const a of LEGACY_PRESENTATION_ATTRS) {
          if ((a === 'width' || a === 'height') && el.tagName === 'IMG') continue;
          el.removeAttribute(a);
        }
      }
    }
  }

  async _resolveAssets(rootEl, docPath, blobs) {
    const jobs = [];

    for (const img of rootEl.querySelectorAll('img[src], input[type="image"][src]')) {
      const src = img.getAttribute('src');
      if (!src || isExternalHref(src)) continue;
      const assetPath = normalizePath(docPath, src);
      if (!assetPath) continue;
      img.removeAttribute('src');
      img.setAttribute('loading', 'lazy');
      jobs.push(
        this._acquireAsset(assetPath).then((url) => {
          if (url) {
            img.setAttribute('src', url);
            blobs.add(assetPath);
          } else {
            img.setAttribute('alt', img.getAttribute('alt') || `[missing: ${src}]`);
          }
        }),
      );
    }

    /* inline style="background: url(...)" references */
    if (!this.overrideStyles) {
      for (const el of rootEl.querySelectorAll('[style*="url(" i]')) {
        const style = el.getAttribute('style') || '';
        jobs.push(
          this._rewriteCss(style, docPath, blobs, 2).then((rew) => {
            el.setAttribute('style', rew);
          }),
        );
      }
    }

    /* mark internal links for the click handler */
    for (const a of rootEl.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      if (isExternalHref(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        continue;
      }
      a.dataset.internalHref = href;
      a.dataset.internalBase = docPath;
      a.removeAttribute('target');
    }

    await Promise.all(jobs);
  }

  /** rewrite url(...) and @import inside CSS text to blob URLs */
  async _rewriteCss(css, basePath, blobs, depth) {
    if (depth > 3) return css;

    /* @import "x.css" / @import url(x.css) — inline them */
    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*;/gi;
    const imports = [...css.matchAll(importRe)];
    for (const m of imports) {
      let replacement = '';
      if (!isExternalHref(m[1])) {
        const p = normalizePath(basePath, m[1]);
        const asset = p ? await this._fetchRaw(p) : null;
        if (asset) {
          const nested = decodeBytes(new Uint8Array(asset.buffer), 'utf-8');
          replacement = await this._rewriteCss(nested, p, blobs, depth + 1);
        }
      }
      css = css.replace(m[0], replacement);
    }

    const urlRe = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
    const matches = [...css.matchAll(urlRe)];
    const seen = new Map();
    for (const m of matches) {
      const ref = m[2].trim();
      if (isExternalHref(ref) || ref.startsWith('blob:') || seen.has(ref)) continue;
      const p = normalizePath(basePath, ref);
      if (!p) continue;
      const url = await this._acquireAsset(p);
      if (url) {
        blobs.add(p);
        seen.set(ref, url);
      }
    }
    if (seen.size) {
      css = css.replace(urlRe, (whole, quote, ref) => {
        const url = seen.get(ref.trim());
        return url ? `url("${url}")` : whole;
      });
    }
    return css;
  }

  async _fetchRaw(path) {
    try {
      const res = await this.hooks.fetchAsset(path);
      return res && res.found ? res : null;
    } catch {
      return null;
    }
  }

  /** get (or create) a refcounted blob URL for an internal asset */
  async _acquireAsset(path) {
    const key = path.toLowerCase();
    const cached = this.assetCache.get(key);
    if (cached) {
      cached.refs++;
      return cached.url;
    }
    const res = await this._fetchRaw(path);
    if (!res) return null;
    /* re-check: a concurrent job may have populated the cache meanwhile */
    const raced = this.assetCache.get(key);
    if (raced) {
      raced.refs++;
      return raced.url;
    }
    const url = URL.createObjectURL(new Blob([res.buffer], { type: res.mime }));
    this.assetCache.set(key, { url, refs: 1 });
    return url;
  }

  _releaseAsset(path) {
    const key = path.toLowerCase();
    const rec = this.assetCache.get(key);
    if (!rec) return;
    if (--rec.refs <= 0) {
      URL.revokeObjectURL(rec.url);
      this.assetCache.delete(key);
    }
  }

  _onClick(event) {
    const a = event.target.closest ? event.target.closest('a[data-internal-href]') : null;
    if (!a) return;
    event.preventDefault();
    event.stopPropagation();
    const href = a.dataset.internalHref;
    const base = a.dataset.internalBase || '/';
    const fragment = fragmentOf(href);
    const path = normalizePath(base, href);
    if (!path || path === '/') {
      /* pure fragment link: scroll within the current section */
      if (fragment) this.scrollToFragment(a.closest('section.doc'), fragment);
      return;
    }
    this.hooks.onNavigate(path, fragment);
  }

  scrollToFragment(section, fragment) {
    if (!section || !fragment) return false;
    const target =
      section.querySelector(`[id="${CSS.escape(fragment)}"]`) ||
      section.querySelector(`a[name="${CSS.escape(fragment)}"]`);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return true;
    }
    return false;
  }
}
