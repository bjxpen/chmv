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

import { normalizePath, fragmentOf, isExternalHref, isTextPath, isRenderablePath, mimeFor } from '../engine/paths.js';
import { effectiveEncoding, decodeBytes } from '../engine/encodings.js';
import { isDocWriteJs, docWriteToHtml, plainTextToHtml } from '../engine/noveljs.js';
import { baseChapterCss } from './chapter-css.js';
import { rewriteScriptNav } from './nav-rewriter.js';
import shimSource from './runjs-shim.js';

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

/* --- Module constants (avoid magic strings scattered through the class) --- */
const SUBFRAME_CLASS = 'subframe';
const SUBFRAME_SELECTOR = `.${SUBFRAME_CLASS}`;
const IFRAME_BLOB_PREFIX = '__iframe__:';
const IFRAME_MSG_SOURCE = 'chmv-iframe';
/* Resource attributes the renderer rewrites to blob: URLs. Used by
 * _collectResourceRefs, _rewriteStaticUrls, and the shim's rewriteHtml. */
const RESOURCE_ATTRS = ['src', 'href', 'background', 'poster'];
const RESOURCE_ATTR_SELECTOR = `[${RESOURCE_ATTRS.join('],[')}]`;


/* Pre-computed sanitization selectors (avoid rebuilding on every _sanitize call). */
const DROP_SELECTOR = [...DROP_TAGS].join(',');
const DROP_SELECTOR_RUNJS = [...DROP_TAGS].filter((t) => t !== 'script').join(',');

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
    this.idlePoolBytes = 0; /* running sum for O(1) trim checks */
    this.assetPending = new Map();

    /* runJs sub-frame support: a map of CHM-internal path → blob URL
     * covering every archive asset, built lazily on first runJs render.
     * The sandboxed iframe can't resolve relative URLs against blob:, so
     * we pre-build blob URLs for every asset and rewrite all references
     * (static + dynamic via document.write) through a runtime shim. */
    this.runJsBlobs = null;
    this.runJsBlobsPending = new Map(); /* in-flight dedup (path → promise) */
    this._disposed = false;
    this._lastNavSeq = 0; /* highest navigate seq seen (stale-msg suppression) */

    this.overrideStyles = true;
    this.runJs = false;
    this.bookEncoding = 'utf-8';
    this.encodingOverride = null;

    this._clickHandler = (e) => this._onClick(e);
    this.shadow.addEventListener('click', this._clickHandler);
    /* Sub-frames postMessage parent when their scripts call
     * document.location = ... (which our shim rewrites to
     * parent.__chmvNavigate(...)). Route those to the app's onNavigate. */
    this._msgHandler = (e) => this._onIframeMessage(e);
    window.addEventListener('message', this._msgHandler);
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
    this._disposed = true;
    this.clear();
    for (const [key, rec] of this.assetCache) {
      URL.revokeObjectURL(rec.url);
      this.assetCache.delete(key);
    }
    this.idlePool.length = 0;
    this.idlePoolBytes = 0;
    this.assetPending.clear();
    /* Revoke every runJs pre-built blob URL. */
    if (this.runJsBlobs) {
      for (const url of this.runJsBlobs.values()) URL.revokeObjectURL(url);
      this.runJsBlobs = null;
    }
    this.runJsBlobsPending.clear();
    this._lastNavSeq = 0;
    /* Note: we intentionally do NOT remove the shadow 'click' or window
     * 'message' listeners here — they are cheap and the test suite reuses
     * a renderer after dispose(). In production dispose() is final, so
     * leaving them has no effect. A truly final teardown would remove them.
     * No window globals to clean up — the shim uses postMessage only. */
  }

  async _buildSection(path, bytes) {
    /* Allow re-use after dispose() (test pattern): clear the disposed
     * flag so async callbacks don't silently no-op. In production,
     * dispose() is final and this line is harmless. */
    this._disposed = false;
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const section = document.createElement('section');
    section.className = 'doc';
    section.dataset.path = path;
    const blobs = new Set();
    this.sectionBlobs.set(section, blobs);

    const { fragment, styleTexts } = await this._buildContent(path, raw, blobs, 0);
    section.appendChild(fragment);

    if (!this.overrideStyles && styleTexts.length) {
      const resolved = await this._resolveStyleTexts(styleTexts, blobs);
      if (resolved.length) {
        const styleEl = document.createElement('style');
        styleEl.textContent = resolved.map((r) => r.css).join('\n');
        section.insertBefore(styleEl, section.firstChild);
      }
    }

    /* No _processScripts on the top-level section: scripts were stripped
     * by _sanitize(allowScripts=false) and must never execute in the host
     * app's origin. Sub-frame scripts are handled in _inlineFrames. */
    return section;
  }

  async _buildContent(path, raw, blobs, depth, allowScripts = false) {
    const doc = this._parseChapterDoc(path, raw);
    const styleTexts = [];
    await this._inlineFrames(doc, path, blobs, depth, styleTexts);
    this._convertFramesets(doc);
    this._ensureBody(doc);
    if (!this.overrideStyles) this._collectStyleTexts(doc, path, styleTexts);
    this._sanitize(doc, allowScripts);
    const fragment = this._extractBodyFragment(doc);
    await this._resolveAssets(fragment, path, blobs);
    return { fragment, styleTexts };
  }

  /** Decode bytes → HTML string (handling .txt chapter scripts), parse
   *  into an inert Document. */
  _parseChapterDoc(path, raw) {
    const encoding = effectiveEncoding(raw, this.encodingOverride, this.bookEncoding);
    let html = decodeBytes(raw, encoding);
    if (isTextPath(path)) {
      html = isDocWriteJs(html) ? docWriteToHtml(html) : plainTextToHtml(html);
    }
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /** Replace <frameset> with a <div> wrapper (legacy frame layouts). */
  _convertFramesets(doc) {
    for (const fs of [...doc.querySelectorAll('frameset')].reverse()) {
      const div = doc.createElement('div');
      while (fs.firstChild) div.appendChild(fs.firstChild);
      fs.replaceWith(div);
    }
  }

  /** Ensure the document has a <body> (DOMParser always creates one, but
   *  malformed HTML can leave content in <html> directly). */
  _ensureBody(doc) {
    if (doc.body) return;
    const body = doc.createElement('body');
    for (const child of [...doc.documentElement.children]) {
      if (child.tagName !== 'HEAD' && child !== body) body.appendChild(child);
    }
    doc.documentElement.appendChild(body);
  }

  /** Collect <style> text and <link rel=stylesheet> paths for later
   *  resolution by _resolveStyleTexts. */
  _collectStyleTexts(doc, path, styleTexts) {
    for (const el of doc.querySelectorAll('style')) {
      styleTexts.push({ css: el.textContent || '', base: path });
    }
    for (const el of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
      const cssPath = normalizePath(path, el.getAttribute('href'));
      if (cssPath) styleTexts.push({ path: cssPath, base: cssPath });
    }
  }

  /** Move <body> children into a DocumentFragment for adoption. */
  _extractBodyFragment(doc) {
    const body = doc.body || doc.documentElement;
    const fragment = document.createDocumentFragment();
    while (body.firstChild) fragment.appendChild(body.firstChild);
    return fragment;
  }

  async _inlineFrames(doc, docPath, blobs, depth, styleTexts) {
    if (depth >= 2) return;
    for (const frame of [...doc.querySelectorAll('iframe[src], frame[src]')]) {
      const src = frame.getAttribute('src');
      if (!src || isExternalHref(src)) continue;
      const target = normalizePath(docPath, src);
      if (!target || !isRenderablePath(target)) continue;
      const asset = await this._fetchRaw(target);
      if (!asset) continue;

      const wrapper = this.runJs
        ? await this._buildRunJsSubFrame(doc, target, asset, blobs, depth)
        : await this._buildInlinedSubFrame(doc, target, asset, blobs, depth, styleTexts);
      if (wrapper) frame.replaceWith(wrapper);
    }
  }

  /** Build a sandboxed-iframe sub-frame for runJs mode: inline scripts,
   *  pre-fetch blob URLs, rewrite static URLs, inject the runtime shim,
   *  serialize to a blob: URL, and return a .subframe > iframe wrapper. */
  async _buildRunJsSubFrame(doc, target, asset, blobs, depth) {
    /* allowScripts=true: the sub-frame will be serialized into a
     * sandboxed iframe, so scripts survive sanitization. The
     * top-level section (depth 0) always gets allowScripts=false
     * so no script ever executes in the host app's origin. */
    const subFragment = await this._buildContent(
      target, new Uint8Array(asset.buffer), blobs, depth + 1, true);
    /* Inline <script src=...> references into the sub-frame so the
     * sandboxed iframe gets a fully self-contained document —
     * external scripts can't resolve against about:srcdoc/blob: and
     * would silently 404, leaving globals like `pages` undefined.
     * _processScripts also rewrites document.location = ... calls
     * to parent.__chmvNavigate(...). */
    await this._processScripts(subFragment.fragment, target);
    /* Lazily pre-fetch blob URLs for assets the sub-frame will
     * reference: static resources (img/background/href) + .txt
     * chapter files discovered by parsing pages[] from inlined
     * scripts. Cached in this.runJsBlobs across chapters, so
     * repeated references only hit the worker once. */
    await this._prefetchRunJsBlobs(subFragment.fragment, target);
    /* Rewrite static resource URLs (img src, link href, etc.) in
     * the sub-frame fragment to cached blob URLs — same logic the
     * shim applies to dynamic document.write output. */
    this._rewriteStaticUrls(subFragment.fragment, target);
    /* Escape `</script` inside script text content so innerHTML
     * serialization doesn't prematurely close the tag. This is the
     * spec-compliant way to embed `</script>` inside a <script>
     * element's body: `<\/script` in a JS string literal evaluates
     * back to `</script`, so it's semantically transparent. Common
     * in legacy CHM .js files (e.g. page.js's loadurl() does
     * document.write('<script src="..."></script>')). */
    for (const s of subFragment.fragment.querySelectorAll('script')) {
      if (s.textContent) {
        s.textContent = s.textContent.replace(/<\/script/gi, '<\\/script');
      }
    }
    /* Move the fragment into a temporary body for serialization.
     * No cloneNode needed — the fragment is consumed (emptied) by
     * appendChild, and we never use it again after this. */
    const tempBody = doc.createElement('body');
    tempBody.appendChild(subFragment.fragment);
    /* Resolve path-based stylesheets (from <link rel=stylesheet>) into
     * actual CSS text — _buildContent only records {path, base} for
     * them; the iframe needs the literal CSS or it would try to fetch
     * the .css file against blob: and 404. Inline <style> tags already
     * carry their css. */
    const resolved = await this._resolveStyleTexts(subFragment.styleTexts, blobs);
    const styleTags = resolved.map((r) => `<style>${r.css}</style>`);
    /* The runtime shim must be the FIRST <script> so it overrides
     * document.write before any legacy script calls it. */
    const shim = this._buildRunJsShim(target);
    const htmlDoc = `<!DOCTYPE html><html><head>${styleTags.join('')}${shim}</head>` +
      tempBody.innerHTML + `</html>`;
    /* Serve the sub-frame as a blob: URL. On file:// the blob: iframe
     * gets origin "null" (cross-origin to the parent), so the iframe
     * has sandbox="allow-scripts" only (NO allow-same-origin) and
     * communicates with the parent exclusively via postMessage. This
     * works on both http:// and file:// without SecurityError. */
    const blob = new Blob([htmlDoc], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    const wrapper = doc.createElement('div');
    wrapper.className = SUBFRAME_CLASS;
    wrapper.dataset.path = target;
    const iframe = doc.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('frameborder', '0');
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.src = blobUrl;
    /* Track the iframe's own blob URL alongside asset blobs so it
     * gets revoked when the section is removed/disposed. */
    const iframeBlobKey = `${IFRAME_BLOB_PREFIX}${blobUrl}`;
    blobs.add(iframeBlobKey);
    this.assetCache.set(iframeBlobKey, { url: blobUrl, refs: 1, size: htmlDoc.length });
    wrapper.appendChild(iframe);
    /* Note: do NOT push subFragment.styleTexts to the parent —
     * sub-frame CSS is already inlined into the iframe's <head>.
     * Pushing it would duplicate the CSS in the main shadow DOM
     * where generic rules (body {}, a {}) could clobber the app. */
    return wrapper;
  }

  /** Build an inlined sub-frame (non-runJs mode): recursively build
   *  content, push styles to the parent, wrap in a .subframe div. */
  async _buildInlinedSubFrame(doc, target, asset, blobs, depth, styleTexts) {
    try {
      const { fragment, styleTexts: subStyles } = await this._buildContent(
        target, new Uint8Array(asset.buffer), blobs, depth + 1);
      styleTexts.push(...subStyles);
      const wrapper = doc.createElement('div');
      wrapper.className = SUBFRAME_CLASS;
      wrapper.dataset.path = target;
      wrapper.appendChild(fragment);
      return wrapper;
    } catch {
      return null;
    }
  }

  /**
   * Sanitize a parsed document: strip dangerous tags/attributes.
   * @param {Document} doc
   * @param {boolean} allowScripts — if true, <script> tags survive (used
   *   only for sub-frame fragments that will be serialized into a
   *   sandboxed iframe). Top-level sections always pass false so scripts
   *   never execute in the host app's origin.
   */
  _sanitize(doc, allowScripts = false) {
    this._replaceUnsafeIframes(doc, allowScripts);
    this._dropUnsafeTags(doc, allowScripts);
    this._stripUnsafeAttributes(doc, allowScripts);
  }

  /** Replace <iframe src>/<frame src> pointing to internal CHM pages with
   *  a <p><a> link (unless allowScripts — sub-frames handle their own
   *  iframes). Skips sandboxed .subframe iframes we created ourselves. */
  _replaceUnsafeIframes(doc, allowScripts) {
    if (allowScripts) return;
    for (const frame of doc.querySelectorAll('iframe[src], frame[src]')) {
      if (frame.closest(SUBFRAME_SELECTOR)) continue;
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

  /** Remove DROP_TAGS elements (script, object, embed, iframe, etc.).
   *  In runJs sub-frame mode, <script> is kept (sandboxed iframe handles
   *  execution). Skips .subframe iframes we created ourselves. */
  _dropUnsafeTags(doc, allowScripts) {
    const selector = allowScripts ? DROP_SELECTOR_RUNJS : DROP_SELECTOR;
    for (const el of doc.querySelectorAll(selector)) {
      if (el.closest(SUBFRAME_SELECTOR)) continue;
      el.remove();
    }
  }

  /** Strip dangerous attributes (on* event handlers, javascript: URLs)
   *  and — in override-styles mode — legacy presentational attributes. */
  _stripUnsafeAttributes(doc, allowScripts) {
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    const els = [];
    while (walker.nextNode()) els.push(walker.currentNode);

    for (const el of els) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (!allowScripts && name.startsWith('on')) el.removeAttribute(attr.name);
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

  /**
   * Lazily fetch a single CHM asset and cache its blob URL. The cache
   * (this.runJsBlobs, path → blob URL) persists across chapters and is
   * revoked on dispose, so repeated references to the same asset only
   * hit the worker once.
   *
   * This replaces the earlier "pre-build all entries" approach: instead
   * of materialising the whole archive as blobs (100 MB+ books would
   * spike memory), we only fetch what the current page actually
   * references — static resources (img/background/href), and .txt
   * chapter files discovered by parsing pages[] from the inlined
   * page.js. The shim's BLOBS map is populated from this cache.
   */
  async _getBlobForPath(path) {
    if (!path || this._disposed) return null;
    const key = path.toLowerCase();
    if (this.runJsBlobs?.has(key)) return this.runJsBlobs.get(key);
    /* In-flight dedup: if two concurrent callers request the same path
     * (e.g. _prefetchRunJsBlobs running while a shim request-blob arrives),
     * share a single fetch+createObjectURL. Without this, the loser's
     * blob URL would be overwritten in the map and leak forever. */
    let p = this.runJsBlobsPending.get(key);
    if (!p) {
      p = (async () => {
        const asset = await this._fetchRaw(path);
        if (this._disposed || !asset) return null;
        if (!this.runJsBlobs) this.runJsBlobs = new Map();
        const blob = new Blob([new Uint8Array(asset.buffer)], {
          type: asset.mime || mimeFor(path),
        });
        const url = URL.createObjectURL(blob);
        this.runJsBlobs.set(key, url);
        return url;
      })();
      this.runJsBlobsPending.set(key, p);
      p.finally(() => this.runJsBlobsPending.delete(key));
    }
    return p;
  }

  /**
   * Collect all internal resource paths referenced by [src],[href],
   * [background],[poster] attributes in a fragment. Returns a Set of
   * lowercased normalized paths. Shared by _prefetchRunJsBlobs (to
   * warm the cache) and _rewriteStaticUrls (to rewrite attributes).
   */
  _collectResourceRefs(rootEl, basePath) {
    const paths = new Set();
    for (const el of rootEl.querySelectorAll(RESOURCE_ATTR_SELECTOR)) {
      for (const attr of RESOURCE_ATTRS) {
        const v = el.getAttribute(attr);
        if (!v || v.startsWith('blob:') || isExternalHref(v) || v.startsWith('#')) continue;
        const p = normalizePath(basePath, v);
        if (p) paths.add(p.toLowerCase());
      }
    }
    return paths;
  }

  /**
   * Pre-fetch blob URLs for every asset the current sub-frame is
   * likely to reference: static resources in the fragment, plus .txt
   * chapter files discovered by parsing pages[] from inlined scripts.
   * Populates this.runJsBlobs (lazy + cached across chapters).
   */
  async _prefetchRunJsBlobs(fragment, basePath) {
    const paths = this._collectResourceRefs(fragment, basePath);
    /* .txt chapter files referenced via pages[] in inlined scripts.
     * The novel template's loadtxt(i) does:
     *   document.write('<script src="../txt/'+pages[i][0]+'.txt">')
     * so any pages[i][0] value maps to /txt/<file>.txt. Pre-fetch
     * those so the shim's resolve() finds them synchronously. */
    for (const s of fragment.querySelectorAll('script')) {
      const txt = s.textContent || '';
      const re = /pages\s*\[\s*\d+\s*\]\s*=\s*\[\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const p = normalizePath(basePath, `../txt/${m[1]}.txt`);
        if (p) paths.add(p.toLowerCase());
      }
    }
    /* fetch in bounded parallelism (8 at a time) */
    const arr = [...paths];
    const CONCURRENCY = 8;
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, arr.length) }, async () => {
      while (next < arr.length) {
        const p = arr[next++];
        await this._getBlobForPath(p);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Build the runtime shim <script> for a runJs sub-frame. The shim
   * source lives in runjs-shim.js (imported as a string). Token-replaces
   * the placeholders: embeds the BLOBS map as JSON (snapshot of
   * currently-cached blob URLs), the base path, and the message source.
   *
   * The BLOBS map is embedded (not read live from parent) because on
   * file:// the blob: URL iframe has origin "null" and can't access
   * parent.* — see runjs-shim.js header for details. Cache misses send
   * a request-blob postMessage; the parent fetches + sends back a
   * response-blob message that the shim merges into its local BLOBS.
   */
  _buildRunJsShim(basePath) {
    const blobsJson = this.runJsBlobs
      ? JSON.stringify(Object.fromEntries(this.runJsBlobs))
      : '{}';
    const filled = shimSource
      .replaceAll('__BLOBS_JSON__', blobsJson)
      .replaceAll('__BASE_PATH_JSON__', JSON.stringify(basePath))
      .replaceAll('__IFRAME_MSG_SOURCE__', IFRAME_MSG_SOURCE);
    return `<script>${filled}</script>`;
  }

  /** Route chmv-iframe messages: navigate requests go to onNavigate,
   *  request-blob (shim cache miss) triggers a lazy fetch+cache and
   *  sends the blob URL back to the iframe via response-blob so
   *  subsequent document.write calls find it locally. */
  _onIframeMessage(e) {
    const d = e.data;
    if (!d || d.source !== IFRAME_MSG_SOURCE) return;
    if (d.type === 'navigate') {
      /* Stale-message suppression: track the highest seq seen so
       * navigations from unmounted iframes (lower seq) are dropped.
       * The counter is per-Renderer (not on window) to avoid global
       * pollution. The shim bumps its own local navSeq per call. */
      if (typeof d.seq === 'number') {
        if (d.seq <= this._lastNavSeq) return;
        this._lastNavSeq = d.seq;
      }
      if (this.hooks.onNavigate && d.path) {
        this.hooks.onNavigate(d.path, '');
      }
    } else if (d.type === 'request-blob' && d.path) {
      /* Shim cache miss — fetch, cache, and send the URL back to the
       * iframe so its local BLOBS map is updated for subsequent
       * document.write calls in the same iframe. */
      this._getBlobForPath(d.path).then((url) => {
        if (url && e.source) {
          e.source.postMessage({
            source: 'chmv-parent', type: 'response-blob',
            path: d.path, url,
          }, '*');
        }
      }).catch(() => {});
    }
  }

  /**
   * Rewrite static resource URLs (img src, link href, etc.) in a
   * sub-frame fragment to cached blob URLs. Mirrors what the runtime
   * shim does for dynamic document.write output, but for the initial
   * HTML that the iframe parses directly. Uses _collectResourceRefs
   * for the path-walk, then looks up each in the runJsBlobs cache.
   */
  _rewriteStaticUrls(rootEl, basePath) {
    if (!this.runJsBlobs) return;
    for (const el of rootEl.querySelectorAll(RESOURCE_ATTR_SELECTOR)) {
      for (const attr of RESOURCE_ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const v = el.getAttribute(attr);
        if (!v || v.startsWith('blob:') || isExternalHref(v) || v.startsWith('#')) continue;
        const p = normalizePath(basePath, v);
        const blobUrl = p && this.runJsBlobs.get(p.toLowerCase());
        if (blobUrl) el.setAttribute(attr, blobUrl);
      }
    }
  }

  async _processScripts(rootEl, basePath) {
    if (!this.runJs) return;
    const scripts = [...rootEl.querySelectorAll('script')];
    for (const old of scripts) {
      const newScript = document.createElement('script');
      let srcResolved = false;
      let inlinedText = null;
      for (const attr of [...old.attributes]) {
        const name = attr.name.toLowerCase();
        if (name === 'src') {
          const src = attr.value;
          if (!isExternalHref(src)) {
            const p = normalizePath(basePath, src);
            if (p) {
              const asset = await this._fetchRaw(p);
              if (asset) {
                inlinedText = decodeBytes(new Uint8Array(asset.buffer), 'utf-8');
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
        inlinedText = old.textContent || '';
      }
      /* Rewrite navigation patterns so sub-frame scripts route through
       * the parent app instead of trying to navigate the sandboxed
       * iframe (which would 404 against blob:). The shim installed in
       * _buildRunJsShim provides parent.__chmvNavigate(). */
      if (inlinedText) {
        newScript.textContent = this._rewriteScriptNav(inlinedText);
      }
      old.parentNode.replaceChild(newScript, old);
    }
  }

  /**
   * Rewrite navigation patterns (document.location = …, location.href = …,
   * location.assign(…), etc.) in script source to parent.__chmvNavigate(…).
   * Delegates to the module-level rewriteScriptNav tokenizer which handles
   * string/comment/regex context and balanced parens correctly.
   */
  _rewriteScriptNav(src) {
    return rewriteScriptNav(src);
  }

  async _resolveAssets(rootEl, docPath, blobs) {
    const jobs = [];
    const inSubframe = (el) => el.closest && el.closest(SUBFRAME_SELECTOR) !== null;

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
      /* Legacy `background="images/foo.jpg"` attribute on <body>/<table>/
       * <td> — extremely common in 2000s-era CJK CHMs (e.g. 搜书吧 novel
       * templates). Resolve to a blob URL and project onto the element's
       * inline style, since the `background` HTML attribute has no
       * DOM-property equivalent and would otherwise 404 against the
       * sub-frame's blob:/about:srcdoc base. */
      for (const el of rootEl.querySelectorAll('[background]')) {
        if (inSubframe(el)) continue;
        const bg = el.getAttribute('background');
        if (!bg || bg.startsWith('blob:') || isExternalHref(bg)) continue;
        const assetPath = normalizePath(docPath, bg);
        if (!assetPath) continue;
        el.removeAttribute('background');
        jobs.push(
          this._acquireAsset(assetPath, blobs).then((url) => {
            if (url) {
              const existing = el.getAttribute('style') || '';
              el.setAttribute('style', `${existing}background-image:url("${url}");`.trimStart());
            }
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

  /**
   * Resolve a list of styleTexts ({css?, path?, base}) into actual CSS
   * strings, fetching path-based stylesheets and rewriting url() refs.
   * Used by both _buildSection (top-level <style> injection) and
   * _inlineFrames (sub-frame iframe <head> <style> tags).
   * @returns {Promise<Array<{css: string, base: string}>>}
   */
  async _resolveStyleTexts(styleTexts, blobs) {
    const out = [];
    for (const st of styleTexts) {
      let css = st.css;
      if (css == null && st.path) {
        const asset = await this._fetchRaw(st.path);
        if (!asset) continue;
        css = decodeBytes(new Uint8Array(asset.buffer), 'utf-8');
      }
      if (css) {
        out.push({ css: await this._rewriteCss(css, st.base, blobs, 0), base: st.base });
      }
    }
    return out;
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
        if (this._disposed || !res) return null;
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
    /* Iframe src blob URLs are single-use (one per sub-frame instance);
     * never pool them — revoke immediately when the section lets go. */
    if (key.startsWith(IFRAME_BLOB_PREFIX)) {
      URL.revokeObjectURL(rec.url);
      this.assetCache.delete(key);
      return;
    }
    if (--rec.refs <= 0) {
      rec.refs = 0;
      this.idlePool.push(key);
      this.idlePoolBytes += rec.size || 0;
      this._trimIdlePool();
    }
  }

  _unpoolIdle(key) {
    const i = this.idlePool.indexOf(key);
    if (i >= 0) {
      const rec = this.assetCache.get(key);
      this.idlePoolBytes -= rec?.size || 0;
      this.idlePool.splice(i, 1);
    }
  }

  _trimIdlePool() {
    while (this.idlePool.length && this.idlePoolBytes > this.idlePoolBudget) {
      const key = this.idlePool.shift();
      const rec = this.assetCache.get(key);
      if (rec && rec.refs === 0) {
        URL.revokeObjectURL(rec.url);
        this.assetCache.delete(key);
        this.idlePoolBytes -= rec.size || 0;
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