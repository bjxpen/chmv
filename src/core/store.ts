/**
 * Store - Functional state management with reducer pattern
 * Built on immutable updates and action dispatching
 */

import type { AppState, AppAction, ReaderState, TypographySettings } from '../types';
import { container } from './container';
import * as storage from '../services/storage';

// Default values
const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontSize: 16,
  lineHeight: 1.6,
  letterSpacing: 0,
  paragraphSpacing: 1.2,
  fontFamily: 'serif',
  containerWidth: 800
};

const INITIAL_READER_STATE: ReaderState = {
  chmFile: null,
  currentChapter: null,
  scrollPosition: 0,
  tocEntries: [],
  indexEntries: [],
  encoding: 'utf-8',
  legacyStylesStripped: false,
  themeId: 'light',
  typography: DEFAULT_TYPOGRAPHY,
  sidebarVisible: true,
  sidebarWidth: 280,
  readingMode: 'paginated',
  scrollMode: 'top'
};

const INITIAL_STATE: AppState = {
  reader: INITIAL_READER_STATE,
  recentFiles: [],
  initialized: false
};

// Pure reducer function
function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CHM_FILE':
      return updateReader(state, { chmFile: action.payload });
    case 'SET_CURRENT_CHAPTER':
      return updateReader(state, { currentChapter: action.payload });
    case 'SET_SCROLL_POSITION':
      return updateReader(state, { scrollPosition: action.payload });
    case 'SET_TOC_ENTRIES':
      return updateReader(state, { tocEntries: action.payload });
    case 'SET_INDEX_ENTRIES':
      return updateReader(state, { indexEntries: action.payload });
    case 'SET_ENCODING':
      return updateReader(state, { encoding: action.payload });
    case 'SET_LEGACY_STYLES_STRIPPED':
      return updateReader(state, { legacyStylesStripped: action.payload });
    case 'SET_THEME':
      return updateReader(state, { themeId: action.payload });
    case 'SET_TYPOGRAPHY':
      return updateReader(state, { 
        typography: { ...state.reader.typography, ...action.payload }
      });
    case 'SET_SIDEBAR_VISIBLE':
      return updateReader(state, { sidebarVisible: action.payload ?? true });
    case 'SET_SIDEBAR_WIDTH':
      return updateReader(state, { sidebarWidth: action.payload });
    case 'SET_READING_MODE':
      return updateReader(state, { readingMode: action.payload });
    case 'SET_RECENT_FILES':
      return { ...state, recentFiles: action.payload };
    case 'ADD_RECENT_FILE': {
      const existing = state.recentFiles.findIndex(f => f.hash === action.payload.hash);
      const files = existing >= 0
        ? state.recentFiles.map((f, i) => i === existing ? action.payload : f)
        : [action.payload, ...state.recentFiles];
      return { ...state, recentFiles: files };
    }
    case 'UPDATE_RECENT_FILE':
      return {
        ...state,
        recentFiles: state.recentFiles.map(f =>
          f.hash === action.payload.hash ? { ...f, ...action.payload.updates } : f
        )
      };
    case 'SET_INITIALIZED':
      return { ...state, initialized: action.payload };
    case 'RESET_READER':
      return { ...state, reader: { ...INITIAL_READER_STATE } };
    default:
      return state;
  }
}

// Helper to update reader state immutably
function updateReader(state: AppState, updates: Partial<ReaderState>): AppState {
  return { ...state, reader: { ...state.reader, ...updates } };
}

// Store implementation
class Store {
  private state: AppState = { ...INITIAL_STATE };
  private subscribers = new Set<(state: AppState) => void>();
  private saveTimer: number | null = null;

  getState(): AppState {
    return this.state;
  }

  dispatch(action: AppAction): void {
    const prevState = this.state;
    this.state = reducer(this.state, action);
    
    if (prevState !== this.state) {
      this.notify();
      this.debouncedSave();
    }
  }

  subscribe(fn: (state: AppState) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(): void {
    this.subscribers.forEach(fn => fn(this.state));
  }

  private debouncedSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 1000);
  }

  private async save(): Promise<void> {
    try {
      await storage.saveAppState(this.state);
      
      const { chmFile, currentChapter, scrollPosition } = this.state.reader;
      if (chmFile && currentChapter) {
        const recent = this.state.recentFiles.find(f => f.hash === chmFile.hash);
        if (recent) {
          await storage.saveReadingProgress(
            chmFile.hash,
            currentChapter,
            scrollPosition,
            recent.completion
          );
        }
      }
    } catch (error) {
      console.error('Save failed:', error);
    }
  }

  async initialize(): Promise<void> {
    try {
      await storage.initStorage();
      const saved = await storage.loadAppState();
      if (saved) {
        this.state = {
          ...INITIAL_STATE,
          ...saved,
          reader: { ...INITIAL_READER_STATE, ...saved.reader }
        };
      }
      const files = await storage.getRecentFiles();
      this.dispatch({ type: 'SET_RECENT_FILES', payload: files });
      this.dispatch({ type: 'SET_INITIALIZED', payload: true });
    } catch (error) {
      console.error('Init failed:', error);
      this.dispatch({ type: 'SET_INITIALIZED', payload: true });
    }
  }
}

export const store = new Store();
