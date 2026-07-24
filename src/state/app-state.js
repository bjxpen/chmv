/**
 * Application State Management
 * Handles reading progress, recent files, and user preferences
 */

export class AppState {
  constructor() {
    this.dbName = 'chmv-db';
    this.dbVersion = 1;
    this.db = null;
    this.currentFile = null;
    this.currentChapter = null;
    this.scrollPosition = 0;
    this.preferences = this.getDefaultPreferences();
    this.recentFiles = [];
  }

  /**
   * Get default preferences
   * @returns {Object} Default preference values
   */
  getDefaultPreferences() {
    return {
      theme: 'light',
      fontSize: 16,
      contentWidth: '800px',
      lineHeight: 1.6,
      letterSpacing: 0,
      paragraphSpacing: 1,
      fontFamily: 'system-ui',
      stripLegacyStyles: false,
      infiniteScroll: false,
      sidebarVisible: true,
      sidebarWidth: 280,
      encoding: 'UTF-8',
      autoDetectEncoding: true
    };
  }

  /**
   * Initialize IndexedDB
   * @returns {Promise<void>}
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Recent files store
        if (!db.objectStoreNames.contains('recentFiles')) {
          db.createObjectStore('recentFiles', { keyPath: 'fileHash' });
        }

        // Reading progress store
        if (!db.objectStoreNames.contains('readingProgress')) {
          db.createObjectStore('readingProgress', { keyPath: 'fileHash' });
        }

        // Preferences store
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Generate hash for file identification
   * @param {File} file - File object
   * @returns {Promise<string>} File hash
   */
  async generateFileHash(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Save reading progress
   * @param {string} fileHash - File identifier
   * @param {Object} progress - Progress data
   * @returns {Promise<void>}
   */
  async saveReadingProgress(fileHash, progress) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['readingProgress'], 'readwrite');
      const store = transaction.objectStore('readingProgress');
      
      const data = {
        fileHash,
        chapterPath: progress.chapterPath,
        scrollPosition: progress.scrollPosition,
        timestamp: Date.now(),
        completionPercent: progress.completionPercent || 0
      };

      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load reading progress for a file
   * @param {string} fileHash - File identifier
   * @returns {Promise<Object|null>} Progress data or null
   */
  async loadReadingProgress(fileHash) {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['readingProgress'], 'readonly');
      const store = transaction.objectStore('readingProgress');
      const request = store.get(fileHash);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add file to recent files list
   * @param {Object} fileInfo - File information
   * @returns {Promise<void>}
   */
  async addRecentFile(fileInfo) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['recentFiles'], 'readwrite');
      const store = transaction.objectStore('recentFiles');

      const data = {
        fileHash: fileInfo.fileHash,
        fileName: fileInfo.fileName,
        fileSize: fileInfo.fileSize,
        lastOpened: Date.now(),
        chapterPath: fileInfo.chapterPath || null,
        completionPercent: fileInfo.completionPercent || 0
      };

      const request = store.put(data);
      request.onsuccess = () => {
        this.loadRecentFiles();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load recent files list
   * @returns {Promise<Array>} Array of recent file entries
   */
  async loadRecentFiles() {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['recentFiles'], 'readonly');
      const store = transaction.objectStore('recentFiles');
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result || [];
        // Sort by last opened, most recent first
        files.sort((a, b) => b.lastOpened - a.lastOpened);
        // Keep only last 20 files
        this.recentFiles = files.slice(0, 20);
        resolve(this.recentFiles);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove file from recent files
   * @param {string} fileHash - File identifier
   * @returns {Promise<void>}
   */
  async removeRecentFile(fileHash) {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['recentFiles'], 'readwrite');
      const store = transaction.objectStore('recentFiles');
      const request = store.delete(fileHash);

      request.onsuccess = () => {
        this.loadRecentFiles();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save user preferences
   * @returns {Promise<void>}
   */
  async savePreferences() {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['preferences'], 'readwrite');
      const store = transaction.objectStore('preferences');
      const request = store.put({ id: 'user', ...this.preferences });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load user preferences
   * @returns {Promise<void>}
   */
  async loadPreferences() {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['preferences'], 'readonly');
      const store = transaction.objectStore('preferences');
      const request = store.get('user');

      request.onsuccess = () => {
        if (request.result) {
          // Merge with defaults to ensure all keys exist
          this.preferences = { 
            ...this.getDefaultPreferences(), 
            ...request.result 
          };
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a single preference
   * @param {string} key - Preference key
   * @param {*} value - New value
   */
  setPreference(key, value) {
    this.preferences[key] = value;
    this.savePreferences();
  }

  /**
   * Get a preference value
   * @param {string} key - Preference key
   * @returns {*} Preference value
   */
  getPreference(key) {
    return this.preferences[key];
  }

  /**
   * Get all preferences
   * @returns {Object} All preferences
   */
  getPreferences() {
    return { ...this.preferences };
  }

  /**
   * Set current file context
   * @param {Object} fileContext - File context data
   */
  setCurrentFile(fileContext) {
    this.currentFile = fileContext;
  }

  /**
   * Get current file context
   * @returns {Object|null} Current file context
   */
  getCurrentFile() {
    return this.currentFile;
  }

  /**
   * Set current chapter
   * @param {string} chapterPath - Chapter path
   */
  setCurrentChapter(chapterPath) {
    this.currentChapter = chapterPath;
  }

  /**
   * Get current chapter
   * @returns {string|null} Current chapter path
   */
  getCurrentChapter() {
    return this.currentChapter;
  }

  /**
   * Clear all data (for testing/debugging)
   * @returns {Promise<void>}
   */
  async clearAll() {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        ['recentFiles', 'readingProgress', 'preferences'], 
        'readwrite'
      );
      
      transaction.objectStore('recentFiles').clear();
      transaction.objectStore('readingProgress').clear();
      
      transaction.oncomplete = () => {
        this.recentFiles = [];
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// Singleton instance
export const appState = new AppState();
