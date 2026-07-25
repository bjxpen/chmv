/*
 * hhc.js — tolerant parser for HTML Help "sitemap" files (.hhc / .hhk).
 *
 * These files are 1990s tag soup:
 *   <UL>
 *     <LI><OBJECT type="text/sitemap">
 *           <param name="Name" value="Chapter 1">
 *           <param name="Local" value="html/ch01.htm">
 *         </OBJECT>
 *     <UL> ... nested items ... </UL>
 *   </UL>
 *
 * Browsers' DOMParser rewrites this structure badly (auto-closing <li>,
 * hoisting stray tags), so we scan tags manually and track <ul> depth
 * ourselves. Input must already be decoded to a JS string.
 */

'use strict';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', middot: '\u00b7', times: '\u00d7',
};

export function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff) {
        try { return String.fromCodePoint(cp); } catch { return m; }
      }
      return m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body.toLowerCase())
      ? NAMED_ENTITIES[body.toLowerCase()]
      : m;
  });
}

/* parse attributes out of a raw tag body like:  name="Name" value="Ch 1" */
function parseAttrs(tagBody) {
  const attrs = {};
  const re = /([a-zA-Z_][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/**
 * @typedef {Object} SitemapNode
 * @property {string} name
 * @property {string|null} local   internal path, e.g. "html/ch01.htm"
 * @property {SitemapNode[]} children
 */

/**
 * Parse a sitemap document into a tree.
 * @param {string} text decoded .hhc/.hhk content
 * @returns {{ children: SitemapNode[] }} synthetic root
 */
export function parseSitemap(text) {
  const root = { name: '', local: null, children: [] };
  const stack = [root];
  let lastNode = null;      /* candidate parent for the next <ul> */
  let collecting = null;    /* params of the <object> currently open */
  let objectIsSitemap = false;

  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const body = m[3] || '';

    if (tag === 'ul' || tag === 'menu' || tag === 'dir') {
      if (!closing) {
        const parent = lastNode || stack[stack.length - 1];
        stack.push(parent);
        lastNode = null;
      } else if (stack.length > 1) {
        lastNode = stack.pop();
      }
    } else if (tag === 'object') {
      if (!closing) {
        const attrs = parseAttrs(body);
        objectIsSitemap = /text\/sitemap/i.test(attrs.type || '');
        collecting = objectIsSitemap ? { params: [] } : null;
      } else if (collecting) {
        const node = buildNode(collecting.params);
        if (node) {
          stack[stack.length - 1].children.push(node);
          lastNode = node;
        }
        collecting = null;
      }
    } else if (tag === 'param' && collecting && !closing) {
      const attrs = parseAttrs(body);
      if (attrs.name) collecting.params.push([attrs.name.toLowerCase(), attrs.value ?? '']);
    }
  }

  return root;
}

function buildNode(params) {
  let name = null;
  let local = null;
  const locals = [];
  for (const [key, value] of params) {
    if (key === 'name' && name === null) name = value;
    else if (key === 'local') {
      if (local === null) local = value;
      locals.push(value);
    }
  }
  /* skip pure merge/site properties objects */
  if (name === null && local === null) return null;
  return {
    name: (name || local || '').trim() || '(untitled)',
    local: local || null,
    locals,
    children: [],
  };
}

/**
 * Flatten a sitemap tree into unique document paths in reading order.
 * @param {{children: SitemapNode[]}} root
 * @param {(local: string) => string} normalize path normalizer
 * @returns {string[]}
 */
export function flattenSitemapLocals(root, normalize) {
  const seen = new Set();
  const order = [];
  const walk = (node) => {
    if (node.local) {
      const p = normalize(node.local);
      if (p && !seen.has(p.toLowerCase())) {
        seen.add(p.toLowerCase());
        order.push(p);
      }
    }
    for (const child of node.children) walk(child);
  };
  for (const child of root.children) walk(child);
  return order;
}

/**
 * Flatten an index (.hhk) tree into a sorted keyword list.
 * @returns {{name: string, targets: {local: string}[]}[]}
 */
export function flattenIndex(root) {
  const out = [];
  const walk = (node, prefix) => {
    const label = prefix ? `${prefix}, ${node.name}` : node.name;
    if (node.local || (node.locals && node.locals.length)) {
      const targets = (node.locals && node.locals.length ? node.locals : [node.local])
        .filter(Boolean)
        .map((local) => ({ local }));
      out.push({ name: label, targets });
    }
    for (const child of node.children) walk(child, label);
  };
  for (const child of root.children) walk(child, '');
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}
