/**
 * Storage Service
 * Handles persistent storage using IndexedDB for state persistence and recent files
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { AppState, RecentFile, ReaderState, CHMTOCEntry } from '../types';

interface CHMDatabase extends DBSchema {
  recentFiles: {
    key: string;
    value: RecentFile;
    indexes: { 'by-lastAccessed': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
  state: {
    key: string;
    value: AppState;
  };
}

const DB_NAME = 'chmv-database';
const DB_VERSION = 1;

let db: IDBPDatabase<CHMDatabase> | null = null;

export async function initStorage(): Promise<void> {
  db = await openDB<CHMDatabase>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // Create recent files store
      if (!database.objectStoreNames.contains('recentFiles')) {
        const recentStore = database.createObjectStore('recentFiles', { keyPath: 'hash' });
        recentStore.createIndex('by-lastAccessed', 'lastAccessed');
      }
      
      // Create settings store
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
      
      // Create state store
      if (!database.objectStoreNames.contains('state')) {
        database.createObjectStore('state');
      }
    }
  });
}

async function getDB(): Promise<IDBPDatabase<CHMDatabase>> {
  if (!db) {
    await initStorage();
  }
  return db!;
}

// Recent Files Operations
export async function saveRecentFile(file: RecentFile): Promise<void> {
  const database = await getDB();
  await database.put('recentFiles', file);
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  const database = await getDB();
  const files = await database.getAllFromIndex('recentFiles', 'by-lastAccessed');
  return files.reverse(); // Most recent first
}

export async function getRecentFile(hash: string): Promise<RecentFile | undefined> {
  const database = await getDB();
  return database.get('recentFiles', hash);
}

export async function deleteRecentFile(hash: string): Promise<void> {
  const database = await getDB();
  await database.delete('recentFiles', hash);
}

export async function clearRecentFiles(): Promise<void> {
  const database = await getDB();
  await database.clear('recentFiles');
}

// Reading Progress Operations
export async function saveReadingProgress(
  hash: string,
  chapter: string,
  position: number,
  completion: number
): Promise<void> {
  const recentFile = await getRecentFile(hash);
  
  if (recentFile) {
    recentFile.lastChapter = chapter;
    recentFile.lastPosition = position;
    recentFile.completion = completion;
    recentFile.lastAccessed = Date.now();
    await saveRecentFile(recentFile);
  }
}

// Settings Operations
export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const database = await getDB();
  await database.put('settings', value, key);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const database = await getDB();
  return database.get('settings', key) as Promise<T | undefined>;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const database = await getDB();
  const keys = await database.getAllKeys('settings');
  const settings: Record<string, unknown> = {};
  
  for (const key of keys) {
    const value = await database.get('settings', key);
    if (value !== undefined) {
      settings[key] = value;
    }
  }
  
  return settings;
}

// Full State Operations
export async function saveAppState(state: AppState): Promise<void> {
  const database = await getDB();
  await database.put('state', state, 'current');
}

export async function loadAppState(): Promise<AppState | undefined> {
  const database = await getDB();
  return database.get('state', 'current');
}

// Generate file hash for identification
export async function generateFileHash(file: File): Promise<string> {
  const buffer = await file.slice(0, 1024 * 1024).arrayBuffer(); // First 1MB
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Include file size for more uniqueness
  return `${hashHex}-${file.size}`;
}

// Create recent file entry
export async function createRecentFileEntry(
  file: File,
  hash: string,
  tocEntries: CHMTOCEntry[]
): Promise<RecentFile> {
  return {
    hash,
    name: file.name,
    size: file.size,
    lastChapter: null,
    lastPosition: 0,
    completion: 0,
    lastAccessed: Date.now(),
    tocEntries
  };
}

// Cleanup old entries (keep last N files)
export async function cleanupRecentFiles(keepCount: number = 20): Promise<void> {
  const files = await getRecentFiles();
  
  if (files.length > keepCount) {
    const toDelete = files.slice(keepCount);
    for (const file of toDelete) {
      await deleteRecentFile(file.hash);
    }
  }
}
