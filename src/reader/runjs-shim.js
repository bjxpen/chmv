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
 * NAVIGATION MODEL: when scripts call document.location = "chapter.htm"
 * (rewritten by the nav-rewriter to __chmvNavigate("chapter.htm")), the
 * shim sends a 'navigate' postMessage to the parent. The parent re-
 * renders the sub-frame with the new page, preserving parent.* state
 * (parent.txt, parent.document.title, etc.) that the shim captured via
 * the parent proxy and sent via 'parent-state' messages.
 *
 * Placeholders (token-replaced by _buildRunJsShim):
 *   __BLOBS_JSON__          — embedded path→dataURL map (snapshot)
 *   __BASE_PATH_JSON__      — JSON string of the sub-frame's CHM path
 *   __IFRAME_MSG_SOURCE__   — 'chmv-iframe' message source tag
 *   __PARENT_STATE_JSON__   — JSON object of saved parent.* properties
 */

/* The shim source as a plain string (default export). */
export default `(function(){
var BLOBS = __BLOBS_JSON__;
var BASE = __BASE_PATH_JSON__;
var MSG_SRC = '__IFRAME_MSG_SOURCE__';
/* parentState: properties set by legacy scripts via parent.X = value
 * (e.g. parent.txt = 5, parent.document.title = "..."). Sent to the
 * parent on navigation so the next page's shim can restore them. */
var parentState = __PARENT_STATE_JSON__ || {};

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

/* Parent proxy: legacy scripts do parent.txt = 5, parent.document.title
 * = "...", etc. We capture these assignments in parentState and sync to
 * the parent on navigation. Reads return the stored value. This makes
 * parent.txt survive iframe-internal navigations (the parent passes
 * parentState back to the next page's shim).
 *
 * CRITICAL: the shim itself calls parent.postMessage(...) for
 * navigate/request-blob/resize messages. The proxy MUST delegate
 * postMessage (and hasOwnProperty, etc.) to the real window.parent.
 * The real parent is cross-origin but postMessage works cross-origin. */
var realParent = window.parent;
var parentProxy = new Proxy({}, {
  get: function (_, prop) {
    /* Delegate communication + introspection to the real parent. */
    if (prop === 'postMessage') return function () { return realParent.postMessage.apply(realParent, arguments); };
    if (prop === 'addEventListener') return function () { return realParent.addEventListener.apply(realParent, arguments); };
    if (prop === 'removeEventListener') return function () { return realParent.removeEventListener.apply(realParent, arguments); };
    if (prop === 'toString' || prop === Symbol.toPrimitive) return function () { return '[object Window]'; };
    /* Delegate common parent.* reads that legacy scripts expect. */
    if (prop === 'document') return document;
    if (prop === 'window') return window;
    if (prop === 'location') return window.location;
    if (prop === 'navigator') return window.navigator;
    return parentState[prop];
  },
  set: function (_, prop, value) {
    parentState[prop] = value;
    return true;
  },
  has: function (prop) {
    return prop in parentState || prop in realParent;
  },
});
/* Expose parent as a global so rewritten scripts can use it. Only set
 * if not already defined (the real parent is cross-origin and throws). */
try { Object.defineProperty(window, 'parent', { value: parentProxy, configurable: false, writable: false }); } catch (e) {}

/* Navigation: tell the parent to re-render the sub-frame with the new
 * page. The parent preserves parentState across navigations. */
var navSeq = 0;
function navigate(url) {
  navSeq++;
  var p = norm(BASE, String(url));
  parent.postMessage({
    source: MSG_SRC, type: 'navigate', path: p, seq: navSeq,
    state: parentState,
  }, '*');
}
window.__chmvNavigate = navigate;

/* Click interceptor for <a href> internal links + javascript: links.
 * For javascript: links, extract the function call and execute it
 * in a try/catch. This makes javascript:loadurl(...) links work in
 * the sandboxed iframe (they can't use the real javascript: protocol
 * because the iframe is cross-origin). */
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href) return;
  if (/^(https?:|mailto:|ftp:|blob:|data:|#)/i.test(href)) return;
  if (/^javascript:/i.test(href)) {
    /* Execute the javascript: code in the iframe's scope. This is safe
     * because the iframe is sandboxed (allow-scripts only). */
    e.preventDefault();
    e.stopPropagation();
    try {
      var code = href.replace(/^javascript:/i, '').trim();
      /* Use Function instead of eval to avoid strict-mode issues. */
      new Function(code).call(window);
    } catch (ex) { /* ignore errors from legacy scripts */ }
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  navigate(href);
  return false;
}, true);

/* Intercept location.href = ... on <select> onChange (and any other
 * element). Legacy templates use <select onChange='location.href=...'>
 * for template switchers (e.g. mb.js's 模板选择). We can't intercept
 * location.href directly (it's a native property), but we CAN intercept
 * the change event on <select> elements and check if the handler would
 * navigate. The nav-rewriter already rewrites location.href = X in
 * inline handlers to __chmvNavigate(X). For dynamically-written <select>
 * (via document.write), the onChange handler is a string that the shim
 * can't rewrite — so we intercept the change event and parse the
 * selected option's value as a URL. */
document.addEventListener('change', function (e) {
  if (e.target.tagName !== 'SELECT') return;
  var val = e.target.value;
  if (!val || /^(https?:|mailto:|ftp:|blob:|data:|#|javascript:)/i.test(val)) return;
  e.preventDefault();
  e.stopPropagation();
  navigate(val);
  return false;
}, true);

/* Auto-resize: report the iframe's content height to the parent. */
var resizeRaf = 0;
function reportHeight() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(function () {
    resizeRaf = 0;
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    if (h > 0) parent.postMessage({ source: MSG_SRC, type: 'resize', height: h }, '*');
  });
}
if (document.readyState === 'complete') reportHeight();
else window.addEventListener('load', reportHeight);
var mo = new MutationObserver(function () { reportHeight(); });
mo.observe(document.documentElement, { childList: true, subtree: true });

/* Receive messages from the parent. */
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.source !== 'chmv-parent') return;
  if (d.type === 'response-blob' && d.path && d.url) {
    BLOBS[d.path.toLowerCase()] = d.url;
  }
});
})();`;

