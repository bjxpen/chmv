/* runjs-shim.js — runtime shim injected at the top of every runJs sub-frame.
 *
 * This file is imported as a string by renderer.js and wrapped in
 * <script>…</script>. It runs INSIDE the sandboxed iframe.
 *
 * CRITICAL: the iframe has sandbox="allow-scripts" (NO allow-same-origin).
 * On file:// the blob: URL iframe gets origin "null" which differs from
 * the parent — so parent.* access throws SecurityError. The shim
 * communicates with the parent EXCLUSIVELY via postMessage, which works
 * cross-origin. No parent.* direct access anywhere.
 *
 * Placeholders (token-replaced by _buildRunJsShim):
 *   __BLOBS_JSON__          — embedded path→blobURL map (snapshot)
 *   __BASE_PATH_JSON__      — JSON string of the sub-frame's CHM path
 *   __IFRAME_MSG_SOURCE__   — 'chmv-iframe' message source tag
 *
 * The BLOBS map is embedded (not read live from parent) because cross-
 * origin parent access is blocked. Cache misses fall back to the raw
 * URL + a request-blob postMessage that warms the parent's cache for
 * the NEXT render. An async response-blob message updates a local
 * BLOBS map so subsequent document.write calls in the SAME iframe
 * find the newly-fetched URL.
 */

/* The shim source as a plain string (default export). */
export default `(function(){
var BLOBS = __BLOBS_JSON__;
var BASE = __BASE_PATH_JSON__;
var MSG_SRC = '__IFRAME_MSG_SOURCE__';

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

function resolve(href) {
  if (/^(https?:|mailto:|ftp:|javascript:|data:|blob:|#)/i.test(href)) return href;
  var p = norm(BASE, href);
  if (!p) return href;
  var k = p.toLowerCase();
  if (BLOBS[k]) return BLOBS[k];
  /* cache miss — ask parent to warm its cache for next time. The
   * current call falls back to the raw URL (will 404 against blob:,
   * but legacy scripts usually tolerate that for non-critical assets). */
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

/* Navigation: pure postMessage, no parent.* access. The parent
 * tracks a seq counter to drop stale messages from unmounted iframes.
 * __chmvNavigate is exposed as a global so rewritten scripts (which
 * call __chmvNavigate(url) after the nav-rewriter transforms
 * document.location = url) can invoke it directly. */
var navSeq = 0;
function navigate(url) {
  navSeq++;
  var p = norm(BASE, String(url));
  parent.postMessage({ source: MSG_SRC, type: 'navigate', path: p, seq: navSeq }, '*');
}
window.__chmvNavigate = navigate;

document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href) return;
  if (/^(https?:|mailto:|ftp:|blob:|data:|#)/i.test(href)) return;
  if (/^javascript:/i.test(href)) return;
  e.preventDefault();
  e.stopPropagation();
  navigate(href);
  return false;
}, true);

/* Auto-resize: report the iframe's content height to the parent so
 * the parent can size the .subframe wrapper. Without this, the iframe
 * has a fixed height and content gets clipped. Runs after load and
 * after any document.write (via MutationObserver, debounced via rAF
 * to avoid postMessage storms during rapid mutations). */
var resizeRaf = 0;
function reportHeight() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(function () {
    resizeRaf = 0;
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    /* Guard against h=0 (before content is parsed) — sending 0 would
     * collapse the iframe until the next non-zero height arrives. */
    if (h > 0) parent.postMessage({ source: MSG_SRC, type: 'resize', height: h }, '*');
  });
}
if (document.readyState === 'complete') reportHeight();
else window.addEventListener('load', reportHeight);
/* Also report after mutations (document.write may add content after load). */
var mo = new MutationObserver(function () { reportHeight(); });
mo.observe(document.documentElement, { childList: true, subtree: true });

/* Receive response-blob messages from the parent: updates the local
 * BLOBS map so subsequent document.write calls find the newly-fetched
 * URL. Also handles parent-injected navigation if needed. */
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.source !== 'chmv-parent') return;
  if (d.type === 'response-blob' && d.path && d.url) {
    BLOBS[d.path.toLowerCase()] = d.url;
  }
});
})();`;

