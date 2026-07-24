/*
 * paths.js — internal CHM path helpers shared by the worker and the UI.
 */

'use strict';

/**
 * Resolve a (possibly relative) href against a base CHM-internal path.
 * Returns a normalized "/dir/file.htm" path, or null.
 * Also strips ms-its: / mk:@MSITStore: prefixes used by legacy CHMs.
 */
export function normalizePath(base, href) {
  if (href == null) return null;
  let path = String(href).replace(/\\/g, '/').trim();

  /* legacy protocol forms: ms-its:file.chm::/page.htm, mk:@MSITStore:... */
  const itsMatch = path.match(/^(?:ms-its:|mk:@msitstore:)?.*?\.chm::(.*)$/i);
  if (itsMatch) path = itsMatch[1];

  /* strip anchors/queries */
  const hash = path.indexOf('#');
  if (hash >= 0) path = path.slice(0, hash);
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch { /* keep raw */ }

  if (!path.startsWith('/')) {
    const dir = base ? base.slice(0, base.lastIndexOf('/') + 1) : '/';
    path = dir + path;
  }
  /* collapse ./ and ../ */
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

/** Extract the fragment identifier of an href ('' if none). */
export function fragmentOf(href) {
  if (href == null) return '';
  const s = String(href);
  const hash = s.indexOf('#');
  return hash >= 0 ? s.slice(hash + 1) : '';
}

const MIME_TYPES = {
  htm: 'text/html', html: 'text/html', xhtml: 'application/xhtml+xml', xht: 'application/xhtml+xml',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  wav: 'audio/wav', mp3: 'audio/mpeg', mid: 'audio/midi', midi: 'audio/midi',
  txt: 'text/plain', xml: 'text/xml', json: 'application/json',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

export function mimeFor(path) {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function isHtmlPath(path) {
  return /\.(x?html?|xht)$/i.test(path);
}

export function isExternalHref(href) {
  return /^(https?|mailto|ftp|tel|data|javascript|about):/i.test(String(href).trim());
}
