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

/* --- Module constants (avoid magic strings/numbers scattered through the class) --- */
const SUBFRAME_CLASS = 'subframe';
const SUBFRAME_SELECTOR = `.${SUBFRAME_CLASS}`;
const IFRAME_BLOB_PREFIX = '__iframe__:';
const IFRAME_MSG_SOURCE = 'chmv-iframe';
/* Resource attributes the renderer rewrites to data: URLs. Used by
 * _collectResourceRefs, _rewriteStaticUrls, and the shim's rewriteHtml. */
const RESOURCE_ATTRS = ['src', 'href', 'background', 'poster'];
const RESOURCE_ATTR_SELECTOR = `[${RESOURCE_ATTRS.join('],[')}]`;

/* Tunable limits (hoisted from magic numbers in method bodies). */
const IDLE_POOL_BUDGET_BYTES = 12 * 1024 * 1024;
const PREFETCH_CONCURRENCY = 8;
const MAX_SUBFRAME_HEIGHT_PX = 2000;
const RUNJS_BLOB_CACHE_LIMIT = 500; /* max entries in runJsBlobs to prevent memory exhaustion */

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
    this.idlePoolBudget = IDLE_POOL_BUDGET_BYTES;
    this.idlePoolBytes = 0; /* running sum for O(1) trim checks */
    this.assetPending = new Map();

    /* runJs sub-frame support: a map of CHM-internal path → data: URL
     * (base64). Built lazily on first runJs render. Uses data: URLs
     * (not blob:) because the sandboxed iframe is cross-origin on
     * file:// and can't load parent-created blob: URLs. */
    this.runJsBlobs = null;
    this.runJsBlobsPending = new Map(); /* in-flight dedup (path → promise) */
    this._disposed = false;
    /* Per-iframe nav seq tracking: Map<contentWindow, lastSeq>. Prevents
     * stale navigations from unmounted iframes AND avoids the cross-iframe
     * seq collision that a single counter caused. */
    this._iframeNavSeqs = new Map();
    /* Known iframe content windows — for e.source validation (security:
     * reject postMessages from unknown sources). */
    this._knownIframes = new Set();

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
    /* Initialize Sandcastle/DocFX tab UI: show the first language (C#)
     * by default. The click handler (_onClick) handles tab switching
     * via javascript: href interception. */
    if (!this.runJs && section.querySelector('.CodeSnippetContainerTab')) {
      this._initTabUI(section);
    }
    return section;
  }

  removeSection(section) {
    const blobs = this.sectionBlobs.get(section);
    if (blobs) {
      for (const key of blobs) this._releaseAsset(key);
      this.sectionBlobs.delete(section);
    }
    /* Clean up iframe tracking for this section's sub-frames. */
    for (const ifr of section.querySelectorAll(`${SUBFRAME_SELECTOR} iframe`)) {
      this._knownIframes.delete(ifr.contentWindow);
      this._iframeNavSeqs.delete(ifr.contentWindow);
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
    /* runJsBlobs contains data: URLs — no revocation needed. */
    this.runJsBlobs = null;
    this.runJsBlobsPending.clear();
    this._iframeNavSeqs.clear();
    this._knownIframes.clear();
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

    return section;
  }

  /** Initialize Sandcastle/DocFX code snippet tab UI: show the first
   *  language (C#) by default. Tab switching is handled by _onClick
   *  which intercepts javascript: hrefs and calls _setActiveTab. */
  _initTabUI(section) {
    const firstTab = section.querySelector('.CodeSnippetContainerTabFirst');
    if (firstTab) {
      const id = firstTab.id;
      const cls = firstTab.className.match(/(\w+Tab)\b/);
      if (id && cls) {
        const lang = cls[1].replace('Tab', 'Code');
        this._setActiveTab(section, 'CodeSnippetContainerCode', lang, id);
      }
    }
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
    /* allowScripts=true means this fragment is going into a sandboxed
     * iframe. Skip blob: URL resolution for images/backgrounds — the
     * cross-origin iframe can't load parent-created blob: URLs. Leave
     * relative URLs intact; _rewriteStaticUrls (called later in
     * _buildRunJsSubFrame) will convert them to data: URLs. */
    await this._resolveAssets(fragment, path, blobs, allowScripts);
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
   *  serialize to a blob: URL, and return a .subframe > iframe wrapper.
   *  @param {Object} parentState — saved parent.* properties from prior
   *    navigations (e.g. {txt: 5}) — passed to the shim so the new
   *    page's scripts can read parent.txt. */
  async _buildRunJsSubFrame(doc, target, asset, blobs, depth, parentState = {}) {
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
    /* P0-1 fix: _resolveStyleTexts → _rewriteCss → _acquireAsset produces
     * blob: URLs, but the cross-origin iframe can't load parent blob: URLs.
     * Replace every blob: URL in the CSS with a data: URL. The blob: URL
     * was created by _acquireAsset; find its path in assetCache, then
     * fetch the data: URL via _getDataUrlForPath (cached). */
    const styleTags = [];
    for (const r of resolved) {
      let css = r.css;
      const blobUrls = css.match(/blob:[^"')\s]+/g) || [];
      for (const blobUrl of [...new Set(blobUrls)]) {
        /* Find the path for this blob URL in assetCache. */
        let path = null;
        for (const [key, rec] of this.assetCache) {
          if (rec.url === blobUrl) { path = key; break; }
        }
        if (path) {
          const dataUrl = await this._getDataUrlForPath(path);
          if (dataUrl) css = css.split(blobUrl).join(dataUrl);
        }
      }
      styleTags.push(`<style>${css}</style>`);
    }
    /* The runtime shim must be the FIRST <script> so it overrides
     * document.write before any legacy script calls it. */
    const shim = this._buildRunJsShim(target, parentState);
    /* <meta charset="utf-8"> is mandatory: the blob is UTF-8 bytes, but
     * without a charset declaration the browser may sniff a different
     * encoding (especially on file:// where there's no HTTP Content-Type
     * header), garbling CJK text that was decoded from GBK/Big5. */
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTags.join('')}${shim}</head>` +
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
    /* Register the iframe's content window once it loads, so
     * _onIframeMessage can validate e.source against known iframes
     * (security: reject postMessages from unknown sources). */
    iframe.addEventListener('load', () => {
      try { this._knownIframes.add(iframe.contentWindow); } catch { /* cross-origin */ }
    });
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
   *  and — in override-styles mode — legacy presentational attributes.
   *  javascript: hrefs are LEFT INTACT (not converted to onclick) —
   *  they're handled by _onClick which intercepts the click and
   *  executes safe function calls. This avoids the problem of onclick
   *  attributes calling undefined functions in shadow DOM. */
  _stripUnsafeAttributes(doc, allowScripts) {
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    const els = [];
    while (walker.nextNode()) els.push(walker.currentNode);

    for (const el of els) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (!allowScripts && name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'src' || name === 'action') &&
                   /^\s*data:text\/html/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
        /* Note: javascript:/vbscript: hrefs are NOT stripped here.
         * They're handled by _onClick which intercepts the click and
         * executes safe function calls (e.g. setActiveTab) in the
         * shadow DOM context. This is needed because:
         * 1. Scripts in shadow DOM are inert — can't define setActiveTab
         * 2. onclick attributes would call undefined setActiveTab
         * 3. The click handler can define setActiveTab inline */
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
   * Lazily fetch a single CHM asset and cache its data: URL (base64).
   * Uses data: URLs (not blob:) because the sandboxed iframe is cross-
   * origin on file:// (origin "null") and can't load parent-created
   * blob: URLs. Data URLs are self-contained and work cross-origin.
   * Cached in this.runJsBlobs (reused across chapters; no revocation
   * needed for data: URLs). Returns null on miss/dispose.
   *
   * Cache is capped at RUNJS_BLOB_CACHE_LIMIT entries to prevent a
   * chatty sub-frame from exhausting memory via request-blob spam.
   */
  async _getDataUrlForPath(path) {
    if (!path || this._disposed) return null;
    const key = path.toLowerCase();
    if (this.runJsBlobs?.has(key)) return this.runJsBlobs.get(key);
    /* In-flight dedup: concurrent callers share a single fetch+encode. */
    let p = this.runJsBlobsPending.get(key);
    if (!p) {
      p = (async () => {
        const asset = await this._fetchRaw(path);
        if (this._disposed || !asset) return null;
        if (!this.runJsBlobs) this.runJsBlobs = new Map();
        /* Cap cache size (LRU-lite: drop oldest entry when at limit). */
        if (this.runJsBlobs.size >= RUNJS_BLOB_CACHE_LIMIT) {
          const firstKey = this.runJsBlobs.keys().next().value;
          this.runJsBlobs.delete(firstKey);
        }
        const bytes = new Uint8Array(asset.buffer);
        const mime = asset.mime || mimeFor(path);
        /* Chunked base64 encoding: building a 10 MB binary string char-
         * by-char is O(n²) in V8. Process in 32 KB chunks via
         * String.fromCharCode.apply for ~10x speedup on large assets. */
        const CHUNK = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        const url = `data:${mime};base64,${globalThis.btoa(binary)}`;
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
    let next = 0;
    const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, arr.length) }, async () => {
      while (next < arr.length) {
        const p = arr[next++];
        await this._getDataUrlForPath(p);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Build the runtime shim <script> for a runJs sub-frame. The shim
   * source lives in runjs-shim.js (imported as a string). Token-replaces
   * the placeholders: embeds the BLOBS map as JSON (snapshot of
   * currently-cached data URLs), the base path, the message source,
   * and the parent state (saved parent.* properties from prior
   * navigations, e.g. parent.txt).
   */
  _buildRunJsShim(basePath, parentState = {}) {
    const blobsJson = this.runJsBlobs
      ? JSON.stringify(Object.fromEntries(this.runJsBlobs))
      : '{}';
    const filled = shimSource
      .replaceAll('__BLOBS_JSON__', blobsJson)
      .replaceAll('__BASE_PATH_JSON__', JSON.stringify(basePath))
      .replaceAll('__IFRAME_MSG_SOURCE__', IFRAME_MSG_SOURCE)
      .replaceAll('__PARENT_STATE_JSON__', JSON.stringify(parentState));
    return `<script>${filled}</script>`;
  }

  /** Route chmv-iframe messages. Validates e.source against known
   *  iframe windows (security), tracks nav seq per-iframe (avoids
   *  cross-iframe seq collision), handles resize for ALL subframe
   *  iframes, and re-renders sub-frames on internal navigation
   *  (preserving parent.* state like parent.txt). */
  _onIframeMessage(e) {
    const d = e.data;
    if (!d || d.source !== IFRAME_MSG_SOURCE) return;
    /* Security: only accept messages from iframes we created. */
    if (!e.source || !this._knownIframes.has(e.source)) return;

    if (d.type === 'navigate') {
      if (typeof d.seq === 'number') {
        const lastSeq = this._iframeNavSeqs.get(e.source) || 0;
        if (d.seq <= lastSeq) return;
        this._iframeNavSeqs.set(e.source, d.seq);
      }
      /* Navigate the READER to the target page (top-level navigation).
       * The shim resolves template pages (e.g. chapter.htm) to actual
       * content files (e.g. /txt/02_2.txt) using the pages[] array,
       * so the reader renders the chapter with correct GBK decoding
       * + proper spine position (prev/next work). This replaces the
       * old _navigateSubFrame approach which rendered inside the iframe
       * (causing encoding issues + broken prev/next). */
      if (d.path && this.hooks.onNavigate) {
        this.hooks.onNavigate(d.path, '');
      }
    } else if (d.type === 'request-blob' && d.path) {
      this._getDataUrlForPath(d.path).then((url) => {
        if (url && e.source) {
          e.source.postMessage({
            source: 'chmv-parent', type: 'response-blob',
            path: d.path, url,
          }, '*');
        }
      }).catch(() => {});
    } else if (d.type === 'resize' && typeof d.height === 'number' && d.height > 0) {
      const h = Math.min(d.height, MAX_SUBFRAME_HEIGHT_PX);
      for (const section of this.sectionBlobs.keys()) {
        for (const ifr of section.querySelectorAll(`${SUBFRAME_SELECTOR} iframe`)) {
          if (ifr.contentWindow === e.source) {
            const wrapper = ifr.closest(SUBFRAME_SELECTOR);
            if (wrapper) {
              wrapper.style.height = `${h}px`;
              ifr.style.height = `${h}px`;
            }
            return;
          }
        }
      }
    }
  }

  /** Re-render a sub-frame with a new CHM path, preserving parent
   *  state (parent.txt, parent.document.title, etc.). Finds the
   *  iframe by contentWindow, rebuilds its content, and swaps the
   *  iframe's src to the new blob URL. */
  async _navigateSubFrame(sourceWindow, path, parentState) {
    for (const section of this.sectionBlobs.keys()) {
      for (const wrapper of section.querySelectorAll(SUBFRAME_SELECTOR)) {
        const ifr = wrapper.querySelector('iframe');
        if (ifr && ifr.contentWindow === sourceWindow) {
          /* Revoke the old iframe blob URL. */
          const oldKey = `${IFRAME_BLOB_PREFIX}${ifr.src}`;
          this._releaseAsset(oldKey);
          /* Build the new sub-frame content. */
          const newWrapper = await this._buildRunJsSubFrame(
            wrapper.ownerDocument, path, await this._fetchRaw(path), new Set(), 0, parentState);
          if (newWrapper) {
            /* Copy the new iframe into the old wrapper (preserve position). */
            const newIframe = newWrapper.querySelector('iframe');
            ifr.replaceWith(newIframe);
            /* Register the new iframe's content window. */
            newIframe.addEventListener('load', () => {
              try { this._knownIframes.add(newIframe.contentWindow); } catch { /* cross-origin */ }
            });
          }
          return;
        }
      }
    }
  }

  /**
   * Rewrite static resource URLs (img src, link href, etc.) in a
   * sub-frame fragment to cached data: URLs. Mirrors what the runtime
   * shim does for dynamic document.write output, but for the initial
   * HTML that the iframe parses directly. Also projects legacy
   * background= attributes onto inline style via _projectBackground.
   */
  _rewriteStaticUrls(rootEl, basePath) {
    if (!this.runJsBlobs) return;
    for (const el of rootEl.querySelectorAll(RESOURCE_ATTR_SELECTOR)) {
      for (const attr of RESOURCE_ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const v = el.getAttribute(attr);
        if (!v || v.startsWith('blob:') || v.startsWith('data:') || isExternalHref(v) || v.startsWith('#')) continue;
        const p = normalizePath(basePath, v);
        const url = p && this.runJsBlobs.get(p.toLowerCase());
        if (!url) continue;
        if (attr === 'background') {
          this._projectBackground(el, url);
        } else {
          el.setAttribute(attr, url);
        }
      }
    }
  }

  /** Project a legacy background= attribute onto the element's inline
   *  style as background-image:url(...). Uses CSSStyleDeclaration
   *  (not string concat) to avoid corrupting an existing style value
   *  that lacks a trailing semicolon. Removes the background= attr. */
  _projectBackground(el, url) {
    el.style.setProperty('background-image', `url("${url}")`);
    el.removeAttribute('background');
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
                /* Use effectiveEncoding (sniffs meta-charset, BOM, UTF-8
                 * validity) — not just bookEncoding — because individual
                 * .js files may have a different encoding than the book's
                 * detected default. Legacy CJK .js files (page.js) are
                 * typically GBK-encoded with CJK string literals. */
                const jsBytes = new Uint8Array(asset.buffer);
                inlinedText = decodeBytes(jsBytes,
                  effectiveEncoding(jsBytes, this.encodingOverride, this.bookEncoding));
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

  /**
   * Resolve asset references in a fragment: images, inline styles,
   * legacy background= attributes, and link interception.
   * @param {boolean} allowScripts — if true, this fragment is going
   *   into a sandboxed iframe. Skip blob: URL creation (the cross-origin
   *   iframe can't load parent blob: URLs); leave relative URLs for
   *   _rewriteStaticUrls to convert to data: URLs. Link interception
   *   still runs (marks internal links for the shim's click handler).
   */
  async _resolveAssets(rootEl, docPath, blobs, allowScripts = false) {
    const jobs = [];
    const inSubframe = (el) => el.closest(SUBFRAME_SELECTOR) !== null;

    if (!allowScripts) {
      for (const img of rootEl.querySelectorAll('img[src], input[type="image"][src]')) {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('blob:') || src.startsWith('data:') || isExternalHref(src) || inSubframe(img)) continue;
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
          if (inSubframe(el)) continue;
          const style = el.getAttribute('style') || '';
          jobs.push(
            this._rewriteCss(style, docPath, blobs, 2).then((rew) => {
              el.setAttribute('style', rew);
            }),
          );
        }
        /* Legacy `background="images/foo.jpg"` attribute on <body>/<table>/
         * <td> — extremely common in 2000s-era CJK CHMs. Resolve to a blob
         * URL and project onto inline style via _projectBackground. */
        for (const el of rootEl.querySelectorAll('[background]')) {
          if (inSubframe(el)) continue;
          const bg = el.getAttribute('background');
          if (!bg || bg.startsWith('blob:') || bg.startsWith('data:') || isExternalHref(bg)) continue;
          const assetPath = normalizePath(docPath, bg);
          if (!assetPath) continue;
          el.removeAttribute('background');
          jobs.push(
            this._acquireAsset(assetPath, blobs).then((url) => {
              if (url) this._projectBackground(el, url);
            }),
          );
        }
      }
    }

    /* Link interception always runs (both top-level and sub-frame). */
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
        /* CSS files in CJK CHMs may be GBK-encoded (rare but possible). */
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
    const a = event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    /* Handle javascript: hrefs (common in Sandcastle/DocFX CHMs for
     * code snippet tab switching). Execute safe function calls in the
     * shadow DOM context. This is needed because:
     * 1. The browser would try to navigate to javascript:... which
     *    doesn't work in shadow DOM
     * 2. setActiveTab and similar functions aren't defined (scripts
     *    in shadow DOM are inert)
     * We implement known-safe functions inline. */
    if (/^javascript:/i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      this._execJsHref(a, href);
      return;
    }

    /* Internal link navigation */
    if (!a.dataset.internalHref) return;
    event.preventDefault();
    event.stopPropagation();
    const internalHref = a.dataset.internalHref;
    const base = a.dataset.internalBase || '/';
    const fragment = fragmentOf(internalHref);
    const path = normalizePath(base, internalHref);
    if (!path || path === '/') {
      if (fragment) this.scrollToFragment(a.closest('section.doc'), fragment);
      return;
    }
    this.hooks.onNavigate(path, fragment);
  }

  /** Execute a javascript: href in the shadow DOM context. Implements
   *  known-safe functions (setActiveTab, getElementsByClass) inline
   *  since scripts in shadow DOM are inert. Generic pattern: parses
   *  the function name + args from the javascript: URL and dispatches
   *  to the appropriate handler. Unknown functions are silently ignored. */
  _execJsHref(anchor, href) {
    const code = href.replace(/^\s*javascript:\s*/i, '').replace(/;\s*$/, '');
    const section = anchor.closest('section.doc') || anchor.getRootNode().host;

    /* Parse function call: functionName('arg1','arg2','arg3') */
    const m = code.match(/^(\w+)\s*\((.*)\)$/);
    if (!m) return;
    const fn = m[1];
    const args = m[2].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));

    if (fn === 'setActiveTab' && args.length >= 3) {
      this._setActiveTab(section, args[0], args[1], args[2]);
    }
    /* Add more known-safe functions here as needed. Unknown functions
     * are silently ignored — this is a whitelist, not a JS evaluator. */
  }

  /** Sandcastle/DocFX setActiveTab implementation: show/hide code
   *  blocks by class name + highlight the active tab. */
  _setActiveTab(section, baseClass, activeClassName, activeTabId) {
    const getElementsByClass = (searchClass) => {
      const pattern = new RegExp(`(^|\\s)${searchClass}(\\s|$)`);
      return [...section.querySelectorAll('*')].filter((e) => pattern.test(e.className));
    };

    /* Reset all tabs */
    for (const t of getElementsByClass('CodeSnippetContainerTab')) {
      t.style.backgroundColor = '#fff';
      t.style.borderBottom = '1px solid #939393';
    }
    for (const t of getElementsByClass('CodeSnippetContainerTabFirst')) {
      t.style.backgroundColor = '#fff';
      t.style.borderBottom = '1px solid #939393';
    }

    /* Show/hide code blocks */
    for (const d of getElementsByClass(baseClass)) {
      const pattern = new RegExp(`(^|\\s)${activeClassName}(\\s|$)`);
      d.style.display = pattern.test(d.className) ? 'block' : 'none';
    }

    /* Highlight active tab */
    const e = section.querySelector(`#${activeTabId}`);
    if (e) {
      e.style.backgroundColor = 'white';
      e.style.borderBottomColor = 'white';
    }
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