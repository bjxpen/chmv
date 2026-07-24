/**
 * IndexedDB State Manager using idb library
 * Handles reading progress, recent files, and preferences
 */
import { openDB } from 'idb';

const DB_NAME = 'chmv-db';
const DB_VERSION = 1;

export class StateManager {
  constructor() {
    this.db = null;
    this.prefs = this.defaultPrefs();
  }

  defaultPrefs() {
    return {
      theme: 'light', fontSize: 16, contentWidth: '800px',
      lineHeight: 1.6, letterSpacing: 0, fontFamily: 'system-ui',
      stripLegacyStyles: false, sidebarVisible: true, sidebarWidth: 280,
      encoding: 'UTF-8', autoDetectEncoding: true
    };
  }

  async init() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('recentFiles')) db.createObjectStore('recentFiles', { keyPath: 'fileHash' });
        if (!db.objectStoreNames.contains('readingProgress')) db.createObjectStore('readingProgress', { keyPath: 'fileHash' });
        if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
      }
    });
    await this.loadPrefs();
  }

  async hashFile(file) {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async saveProgress(fileHash, { chapterPath, scrollPosition, completionPercent }) {
    await this.db.put('readingProgress', {
      fileHash, chapterPath, scrollPosition,
      completionPercent: completionPercent || 0, timestamp: Date.now()
    });
  }

  async loadProgress(fileHash) {
    return this.db.get('readingProgress', fileHash) || null;
  }

  async addRecentFile({ fileHash, fileName, fileSize, chapterPath, completionPercent }) {
    await this.db.put('recentFiles', {
      fileHash, fileName, fileSize,
      lastOpened: Date.now(), chapterPath: chapterPath || null,
      completionPercent: completionPercent || 0
    });
  }

  async getRecentFiles() {
    const files = await this.db.getAll('recentFiles');
    return files.sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 20);
  }

  async removeRecentFile(fileHash) {
    await this.db.delete('recentFiles', fileHash);
  }

  async savePrefs() {
    await this.db.put('preferences', { id: 'user', ...this.prefs });
  }

  async loadPrefs() {
    const saved = await this.db.get('preferences', 'user');
    if (saved) this.prefs = { ...this.defaultPrefs(), ...saved };
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.savePrefs();
  }

  getPref(key) {
    return this.prefs[key];
  }

  getPrefs() {
    return { ...this.prefs };
  }

  async clear() {
    await this.db.clear('recentFiles');
    await this.db.clear('readingProgress');
  }
}
