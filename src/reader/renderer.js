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

import { normalizePath, fragmentOf, isExternalHref, isTextPath, isRenderablePath } from '../engine/paths.js';
import { effectiveEncoding, decodeBytes } from '../engine/encodings.js';
import { isDocWriteJs, docWriteToHtml, plainTextToHtml } from '../engine/noveljs.js';
import { baseChapterCss } from './chapter-css.js';

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
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks;
    this.shadow = host.attachShadow({ mode: 'open' });

    this.baseStyle = document.createElement('style');
    this.shadow.appendChild(this.baseStyle);

    this.container = document.createElement('div');
    this.container.className = 'chapters';
    this.shadow.appendChild(this.container);

    this.sectionBlobs = new Map();
    this.assetCache = new Map();
    this.idlePool = [];
    this.idlePoolBudget = 12 * 1024 * 1024;
    this.assetPending = new Map();

    this.overrideStyles = true;
    this.runJs = false;
    this.bookEncoding = 'utf-8';
    this.encodingOverride = null;

    this.shadow.addEventListener('click', (e) => this._onClick(e));
    this._applyBaseStyle();
  }

  setStyleOverride(on) {
    this.overrideStyles = !!on;
    this._applyBaseStyle();
  }

  setRunJs(on) {
    this.runJs = !!on;
  }

  setEncodings(bookEncoding, override) {
    this.bookEncoding = bookEncoding || 'utf-8';
    this.encodingOverride = override || null;
  }

  _applyBaseStyle() {
    this.baseStyle.textContent = baseChapterCss(this.overrideStyles);
  }

  async renderChapter(path, bytes) {
    this.clear();
    return this.appendChapter(path, bytes);
  }

  async appendChapter(path, bytes, { divider = false, title = '' } = {}) {
    const section = await this._buildSection(path, bytes);
    if (divider && this.container.children.length > 0) {
      const div = document.createElement('div');
      div.className = 'chapter-divider';
      div.textContent = title || path.split('/').pop();
      this.container.appendChild(div);
      section._divider = div;
    }
    this.container.appendChild(section);
    return section;
  }

  removeSection(section) {
    const blobs = this.sectionBlobs.get(section);
    if (blobs) {
      for (const key of blobs) this._releaseAsset(key);
      this.sectionBlobs.delete(section);
    }
    if (section._divider) section._divider.remove();
    section.remove();
  }

  clear() {
    for (const section of [...this.sectionBlobs.keys()]) this.removeSection(section);
    this.container.textContent = '';
  }

  dispose() {
    this.clear();
    for (const [key, rec] of this.assetCache) {
      URL.revokeObjectURL(rec.url);
      this.assetCache.delete(key);
    }
    this.idlePool.length = 0;
    this.assetPending.clear();
  }

  async _buildSection(path, bytes) {
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const section = document.createElement('section');
    section.className = 'doc';
    section.dataset.path = path;
    const blobs = new Set();
    this.sectionBlobs.set(section, blobs);

    const { fragment, styleTexts } = await this._buildContent(path, raw, blobs, 0);
    section.appendChild(fragment);

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

    await this._processScripts(section, path);
    return section;
  }

  async _buildContent(path, raw, blobs, depth) {
    const encoding = effectiveEncoding(raw, this.encodingOverride, this.bookEncoding);
    let html = decodeBytes(raw, encoding);

    if (isTextPath(path)) {
      html = isDocWriteJs(html) ? docWriteToHtml(html) : plainTextToHtml(html);
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styleTexts = [];
    await this._inlineFrames(doc, path, blobs, depth, styleTexts);

    for (const fs of [...doc.querySelectorAll('frameset')].reverse()) {
      const div = doc.createElement('div');
      while (fs.firstChild) div.appendChild(fs.firstChild);
      fs.replaceWith(div);
    }
    if (!doc.body) {
      const body = doc.createElement('body');
      for (const child of [...doc.documentElement.children]) {
        if (child.tagName !== 'HEAD' && child !== body) body.appendChild(child);
      }
      doc.documentElement.appendChild(body);
    }
    if (!this.overrideStyles) {
      for (const el of doc.querySelectorAll('style')) {
        styleTexts.push({ css: el.textContent || '', base: path });
      }
      for (const el of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
        const cssPath = normalizePath(path, el.getAttribute('href'));
        if (cssPath) styleTexts.push({ path: cssPath, base: cssPath });
      }
    }

    this._sanitize(doc);

    const body = doc.body || doc.documentElement;
    const fragment = document.createDocumentFragment();
    while (body.firstChild) fragment.appendChild(body.firstChild);

    await this._resolveAssets(fragment, path, blobs);
    return { fragment, styleTexts };
  }

  async _inlineFrames(doc, docPath, blobs, depth, styleTexts) {
    if (depth >= 2) return;
    const frames = [...doc.querySelectorAll('iframe[src], frame[src]')];
    for (const frame of frames) {
      const src = frame.getAttribute('src');
      if (!src || isExternalHref(src)) continue;
      const target = normalizePath(docPath, src);
      if (!target || !isRenderablePath(target)) continue;
      const asset = await this._fetchRaw(target);
      if (!asset) continue;

      if (this.runJs) {
        const subFragment = await this._buildContent(
          target, new Uint8Array(asset.buffer), blobs, depth + 1);
        const tempBody = doc.createElement('body');
        tempBody.appendChild(subFragment.fragment.cloneNode(true));
        const htmlDoc = `<!DOCTYPE html><html><head><base href="/">` +
          (subFragment.styleTexts.map(st => `<style>${st.css}</style>`).join('')) +
          `</head>` + tempBody.innerHTML + `</html>`;
        const wrapper = doc.createElement('div');
        wrapper.className = 'subframe';
        wrapper.dataset.path = target;
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('frameborder', '0');
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        iframe.srcdoc = htmlDoc;
        wrapper.appendChild(iframe);
        frame.replaceWith(wrapper);
        styleTexts.push(...subFragment.styleTexts);
        continue;
      }

      try {
        const { fragment, styleTexts: subStyles } = await this._buildContent(
          target, new Uint8Array(asset.buffer), blobs, depth + 1);
        styleTexts.push(...subStyles);
        const wrapper = doc.createElement('div');
        wrapper.className = 'subframe';
        wrapper.dataset.path = target;
        wrapper.appendChild(fragment);
        frame.replaceWith(wrapper);
      } catch { }
    }
  }

  _sanitize(doc) {
    if (!this.runJs) {
      for (const frame of doc.querySelectorAll('iframe[src], frame[src]')) {
        const src = frame.getAttribute('src');
        if (src && !isExternalHref(src)) {
          const p = doc.createElement('p');
          const a = doc.createElement('a');
          a.setAttribute('href', src);
          a.textContent = `→ ${src}`;
          p.appendChild(a);
          frame.replaceWith(p);
        }
      }
    }

    const dropTags = new Set(DROP_TAGS);
    if (this.runJs) dropTags.delete('script');
    const selector = [...dropTags].join(',');
    for (const el of doc.querySelectorAll(selector)) {
      /* Sandbox iframes we created in _inlineFrames live inside a
       * .subframe wrapper. They are <iframe sandbox srcdoc> elements we
       * control; without this exemption, 'iframe' in DROP_TAGS would
       * delete them and sub-frames would never actually run in runJs
       * mode. Other elements inside .subframe were already sanitized
       * by the recursive _buildContent call, so this is a no-op there. */
      if (el.closest('.subframe')) continue;
      el.remove();
    }

    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    const els = [];
    while (walker.nextNode()) els.push(walker.currentNode);

    for (const el of els) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (!this.runJs && name.startsWith('on')) el.removeAttribute(attr.name);
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

  async _processScripts(section, docPath) {
    if (!this.runJs) return;
    const scripts = [...section.querySelectorAll('script')];
    for (const old of scripts) {
      const subframe = old.closest ? old.closest('.subframe') : null;
      const basePath = (subframe && subframe.dataset.path) ? subframe.dataset.path : docPath;
      const newScript = document.createElement('script');
      let srcResolved = false;
      for (const attr of [...old.attributes]) {
        const name = attr.name.toLowerCase();
        if (name === 'src') {
          const src = attr.value;
          if (!isExternalHref(src)) {
            const p = normalizePath(basePath, src);
            if (p) {
              const asset = await this._fetchRaw(p);
              if (asset) {
                newScript.textContent = decodeBytes(new Uint8Array(asset.buffer), 'utf-8');
                srcResolved = true;
                continue;
              }
            }
          }
          newScript.setAttribute('src', src);
        } else {
          newScript.setAttribute(attr.name, attr.value);
        }
      }
      if (!newScript.hasAttribute('src') && !srcResolved) {
        newScript.textContent = old.textContent || '';
      }
      old.parentNode.replaceChild(newScript, old);
    }
  }

  async _resolveAssets(rootEl, docPath, blobs) {
    const jobs = [];
    const inSubframe = (el) => el.closest && el.closest('.subframe') !== null;

    for (const img of rootEl.querySelectorAll('img[src], input[type="image"][src]')) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('blob:') || isExternalHref(src) || inSubframe(img)) continue;
      const assetPath = normalizePath(docPath, src);
      if (!assetPath) continue;
      img.removeAttribute('src');
      img.setAttribute('loading', 'lazy');
      jobs.push(
        this._acquireAsset(assetPath, blobs).then((url) => {
          if (url) {
            img.setAttribute('src', url);
          } else {
            img.setAttribute('alt', img.getAttribute('alt') || `[missing: ${src}]`);
          }
        }),
      );
    }

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

    for (const a of rootEl.querySelectorAll('a[href]')) {
      if (a.dataset.internalHref) continue;
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

  async _rewriteCss(css, basePath, blobs, depth) {
    if (depth > 3) return css;

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
      const url = await this._acquireAsset(p, blobs);
      if (url) seen.set(ref, url);
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

  async _acquireAsset(path, blobs) {
    const key = path.toLowerCase();

    const grab = (rec) => {
      if (blobs && !blobs.has(key)) {
        blobs.add(key);
        if (rec.refs === 0) this._unpoolIdle(key);
        rec.refs++;
      }
      return rec.url;
    };

    const cached = this.assetCache.get(key);
    if (cached) return grab(cached);

    let pending = this.assetPending.get(key);
    if (!pending) {
      pending = this._fetchRaw(path).then((res) => {
        this.assetPending.delete(key);
        if (!res) return null;
        const url = URL.createObjectURL(new Blob([res.buffer], { type: res.mime }));
        const rec = { url, refs: 0, size: res.buffer.byteLength || 0 };
        this.assetCache.set(key, rec);
        return rec;
      });
      this.assetPending.set(key, pending);
    }
    const rec = await pending;
    return rec ? grab(rec) : null;
  }

  _releaseAsset(key) {
    const rec = this.assetCache.get(key);
    if (!rec) return;
    if (--rec.refs <= 0) {
      rec.refs = 0;
      this.idlePool.push(key);
      this._trimIdlePool();
    }
  }

  _unpoolIdle(key) {
    const i = this.idlePool.indexOf(key);
    if (i >= 0) this.idlePool.splice(i, 1);
  }

  _trimIdlePool() {
    let bytes = 0;
    for (const key of this.idlePool) bytes += this.assetCache.get(key)?.size || 0;
    while (this.idlePool.length && bytes > this.idlePoolBudget) {
      const key = this.idlePool.shift();
      const rec = this.assetCache.get(key);
      if (rec && rec.refs === 0) {
        URL.revokeObjectURL(rec.url);
        this.assetCache.delete(key);
        bytes -= rec.size || 0;
      }
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