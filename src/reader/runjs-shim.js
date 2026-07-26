/* runjs-shim.js — runtime shim injected at the top of every runJs sub-frame.
 *
 * This file serves double duty:
 *   1. As a ?raw import in the Vite build (renderer.js does
 *      `import shimSource from './runjs-shim.js?raw'`), Vite reads the
 *      raw file text — so the shim body stays framework-free (no module
 *      system, no imports) for the sandboxed iframe.
 *   2. As a regular ES module in Node tests (which don't understand
 *      ?raw), it exports its own source via a tagged-template trick:
 *      the function body is a string, returned verbatim.
 *
 * The shim runs INSIDE the sandboxed iframe, so it:
 *   - must not import anything (framework-free, no module system)
 *   - accesses parent.* (allowed via sandbox="allow-same-origin")
 *   - uses ES5 syntax for max legacy-browser compat
 *
 * Placeholders __BLOBS_GLOBAL__, __BASE_PATH_JSON__, __IFRAME_MSG_SOURCE__,
 * __NAV_COUNTER_GLOBAL__, __NAVIGATE_GLOBAL__ are token-replaced by
 * _buildRunJsShim() at serialization time.
 *
 * The shim reads parent[__BLOBS_GLOBAL__] LIVE (a Map) instead of an
 * embedded snapshot — so cache entries warmed by request-blob are
 * visible immediately to the next document.write call, and the iframe
 * HTML stays small (no multi-KB JSON blob).
 */

/* The shim source as a plain string. In Vite this file is imported ?raw
 * (bypassing this export); in Node tests this default export is used. */
export default `(function(){
var BLOBS_KEY = '__BLOBS_GLOBAL__';
var BASE = __BASE_PATH_JSON__;
var MSG_SRC = '__IFRAME_MSG_SOURCE__';
var NAV_CTR = '__NAV_COUNTER_GLOBAL__';
var NAV_FN = '__NAVIGATE_GLOBAL__';

function norm(base, href) {
  if (href == null) return null;
  var p = String(href).replace(/\\\\/g, '/').trim();
  var m = p.match(/^(?:ms-its:|mk:@msitstore:)?.*?\\.chm::(.*)$/i);
  if (m) p = m[1];
  var h = p.indexOf('#'); if (h >= 0) p = p.slice(0, h);
  var q = p.indexOf('?'); if (q >= 0) p = p.slice(0, q);
  if (!p) return null;
  try { p = decodeURIComponent(p); } catch (e) {}
  if (p.charAt(0) !== '/') {
    var dir = base ? base.slice(0, base.lastIndexOf('/') + 1) : '/';
    p = dir + p;
  }
  var parts = [];
  p.split('/').forEach(function (part) {
    if (part === '' || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return '/' + parts.join('/');
}

function getBlobs() {
  var b = parent[BLOBS_KEY];
  return b || {};
}

function resolve(href) {
  if (/^(https?:|mailto:|ftp:|javascript:|data:|blob:|#)/i.test(href)) return href;
  var p = norm(BASE, href);
  if (!p) return href;
  var k = p.toLowerCase();
  var BLOBS = getBlobs();
  var url = BLOBS.get ? BLOBS.get(k) : BLOBS[k];
  if (url) return url;
  parent.postMessage({ source: MSG_SRC, type: 'request-blob', path: p }, '*');
  return href;
}

function rewriteHtml(s) {
  return String(s).replace(
    /(<[^>]+\\s(?:src|href|action|background|poster)\\s*=\\s*)(["']?)([^"'>\\s]+)\\2/gi,
    function (m, pre, q, url) { return pre + q + resolve(url) + q; }
  );
}

var _w = Function.prototype.bind.call(document.write, document);
var _wl = Function.prototype.bind.call(document.writeln, document);
document.write = function (s) { return _w(rewriteHtml(s)); };
document.writeln = function (s) { return _wl(rewriteHtml(s)); };

parent[NAV_CTR] = parent[NAV_CTR] || 0;
parent[NAV_FN] = function (url) {
  var seq = ++parent[NAV_CTR];
  var p = norm(BASE, String(url));
  parent.postMessage({ source: MSG_SRC, type: 'navigate', path: p, seq: seq }, '*');
};

document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href) return;
  if (/^(https?:|mailto:|ftp:|blob:|data:|#)/i.test(href)) return;
  if (/^javascript:/i.test(href)) return;
  e.preventDefault();
  e.stopPropagation();
  parent[NAV_FN](href);
  return false;
}, true);

try {
  var realTitle = Object.getOwnPropertyDescriptor(parent.document, 'title');
  if (realTitle && realTitle.configurable) {
    Object.defineProperty(parent.document, 'title', {
      configurable: true,
      get: function () { return realTitle.get.call(parent.document); },
      set: function (v) { try { realTitle.set.call(parent.document, v); } catch (e) {} }
    });
  }
} catch (e) {}
})();`;
