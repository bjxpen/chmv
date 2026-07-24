/**
 * Asset Service
 * Handles internal asset extraction and blob URL creation
 * Manages sandboxed rendering and link interception
 */

import { decodeText } from './encoding';

// Blob URL cache to prevent duplicates
const blobUrlCache = new Map<string, string>();
const blobContentCache = new Map<string, Uint8Array>();

// Track content base paths for relative URL resolution
let currentBasePath = '';

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[`.${ext}`] || 'application/octet-stream';
}

export function getExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return `.${ext}`;
}

export function isImageType(path: string): boolean {
  const mime = getMimeType(path);
  return mime.startsWith('image/');
}

export function isStyleType(path: string): boolean {
  const mime = getMimeType(path);
  return mime === 'text/css';
}

export function isHtmlType(path: string): boolean {
  const mime = getMimeType(path);
  return mime === 'text/html';
}

export function normalizePath(path: string, basePath: string = currentBasePath): string {
  // Remove leading slash
  path = path.replace(/^\/+/, '');
  
  // Handle absolute paths
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
    return path;
  }
  
  // Handle protocol-relative URLs
  if (path.startsWith('//')) {
    return 'https:' + path;
  }
  
  // Handle fragment anchors
  const [mainPath, fragment] = path.split('#');
  
  if (!mainPath || mainPath === '') {
    // Relative to current base
    return fragment ? `${basePath}#${fragment}` : basePath;
  }
  
  // Handle absolute paths from root
  if (mainPath.startsWith('/')) {
    const normalized = mainPath.substring(1);
    return fragment ? `${normalized}#${fragment}` : normalized;
  }
  
  // Handle relative paths
  const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
  let resolved = baseDir + mainPath;
  
  // Normalize . and .. references
  const parts = resolved.split('/');
  const normalized: string[] = [];
  
  for (const part of parts) {
    if (part === '..' && normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  
  resolved = normalized.join('/');
  return fragment ? `${resolved}#${fragment}` : resolved;
}

export function createBlobUrl(content: Uint8Array, path: string): string {
  // Check cache first
  const cacheKey = `${path}:${Array.from(content.slice(0, 100)).join(',')}`;
  
  if (blobUrlCache.has(cacheKey)) {
    return blobUrlCache.get(cacheKey)!;
  }
  
  const mimeType = getMimeType(path);
  const blob = new Blob([new Uint8Array(content)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  blobUrlCache.set(cacheKey, url);
  blobContentCache.set(cacheKey, content);
  
  return url;
}

export function revokeBlobUrl(url: string): void {
  // Find and remove from cache
  for (const [key, cachedUrl] of blobUrlCache.entries()) {
    if (cachedUrl === url) {
      blobUrlCache.delete(key);
      blobContentCache.delete(key);
      break;
    }
  }
  
  URL.revokeObjectURL(url);
}

export function revokeAllBlobUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
  blobContentCache.clear();
}

// Resolve relative paths from HTML content
export function resolveContentPaths(html: string, basePath: string): string {
  currentBasePath = basePath;
  
  // Resolve src attributes
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, src, suffix) => {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('blob:')) {
      return match;
    }
    const resolved = normalizePath(src, basePath);
    return `${prefix}${resolved}${suffix}`;
  });
  
  // Resolve href attributes
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, href, suffix) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) {
      return match;
    }
    const resolved = normalizePath(href, basePath);
    return `${prefix}${resolved}${suffix}`;
  });
  
  // Resolve url() in CSS
  html = html.replace(/(url\s*\(\s*["']?)([^"'\)]+)(["']?\s*\))/gi, (match, prefix, url, suffix) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
      return match;
    }
    const resolved = normalizePath(url, basePath);
    return `${prefix}${resolved}${suffix}`;
  });
  
  return html;
}

// Process HTML content for rendering
export function processHTMLContent(
  html: string,
  _parser: unknown,
  basePath: string,
  stripLegacyStyles: boolean
): { html: string; basePath: string } {
  // Decode content if it's in bytes
  let content = typeof html === 'string' ? html : decodeText(html as unknown as Uint8Array, 'utf-8');
  
  // Resolve internal paths
  content = resolveContentPaths(content, basePath);
  
  // Strip legacy styles if requested
  if (stripLegacyStyles) {
    content = stripLegacyInlineStyles(content);
  }
  
  return { html: content, basePath };
}

// Strip inline styles and deprecated HTML attributes
function stripLegacyInlineStyles(html: string): string {
  // Remove style attributes
  html = html.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove deprecated bgcolor, text, link attributes
  html = html.replace(/\s*(bgcolor|text|link|vlink|alink)\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove font tags
  html = html.replace(/<\/?font[^>]*>/gi, '');
  
  // Remove center tags (deprecated)
  html = html.replace(/<\/?center[^>]*>/gi, '');
  
  // Remove deprecated align attributes
  html = html.replace(/\s*align\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove background attributes
  html = html.replace(/\s*background\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove class attributes (optional - preserves semantic classes)
  // html = html.replace(/\s*class\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove on* event handlers for security
  html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  
  return html;
}

// Extract base path from file path
export function extractBasePath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash > 0 ? filePath.substring(0, lastSlash + 1) : '';
}

// Create sandboxed iframe content
export function createSandboxedContent(
  html: string,
  baseUrl: string
): { html: string; sandboxAttr: string } {
  // Inject base tag for proper relative URL resolution
  const baseTag = `<base href="${baseUrl}">`;
  
  // Wrap content in sandboxed iframe
  return {
    html: `<!DOCTYPE html>
<html>
<head>
  ${baseTag}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      overflow-x: hidden;
    }
  </style>
</head>
<body>
${html}
</body>
</html>`,
    sandboxAttr: 'allow-same-origin allow-scripts'
  };
}

// Extract text content for search/indexing
export function extractTextContent(html: string): string {
  // Simple text extraction
  let text = html;
  
  // Remove script and style content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Replace common block elements with newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n');
  
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  
  // Normalize whitespace
  text = text.replace(/[\r\n]+/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.trim();
  
  return text;
}
