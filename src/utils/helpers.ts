/**
 * Utility Functions - Shared helpers for the application
 */

import type { CHMTOCEntry } from '../types';

// Flatten nested TOC entries
export function flattenTOC(entries: CHMTOCEntry[]): CHMTOCEntry[] {
  const result: CHMTOCEntry[] = [];
  
  const walk = (items: CHMTOCEntry[]): void => {
    for (const item of items) {
      if (item.path) result.push(item);
      if (item.children.length) walk(item.children);
    }
  };
  
  walk(entries);
  return result;
}

// Find first chapter in TOC
export function findFirstChapter(entries: CHMTOCEntry[]): string | null {
  for (const entry of entries) {
    if (entry.path) return entry.path;
    if (entry.children.length) {
      const found = findFirstChapter(entry.children);
      if (found) return found;
    }
  }
  return null;
}

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: number | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

// Throttle function
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Normalize file path for CHM
export function normalizePath(path: string): string {
  return path.replace(/^.*::/, '').replace(/^\//, '');
}

// Generate alternate paths to try
export function* pathVariants(base: string): Generator<string> {
  yield base;
  yield base.replace(/\\/g, '/');
  yield base.replace(/\//g, '\\');
  yield `/${base}`;
  yield `\\${base}`;
}

// Simple memoization
export function memoize<T extends (...args: unknown[]) => unknown>(fn: T): T {
  const cache = new Map<string, unknown>();
  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

// Format file size
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Format relative time
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
