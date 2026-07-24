/**
 * Application Store
 * Centralized state management with declarative updates
 * Implements dependency injection pattern for services
 */

import type { 
  AppState, AppAction, ReaderState, CHMFile, CHMTOCEntry, CHMIndexEntry,
  EncodingType, ThemeId, TypographySettings, FontFamily, ContainerWidth,
  RecentFile
} from '../types';
import * as storage from '../services/storage';

// Default typography settings
const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontSize: 16,
  lineHeight: 1.6,
  letterSpacing: 0,
  paragraphSpacing: 1.2,
  fontFamily: 'serif',
  containerWidth: 800
};

// Initial state
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

// State type for subscribers
type Subscriber = (state: AppState) => void;

// Store implementation
class AppStore {
  private state: AppState = { ...INITIAL_STATE };
  private subscribers: Set<Subscriber> = new Set();
  private saveTimeout: number | null = null;
  
  // Service references (dependency injection)
  private chmParser: import('../services/chmParser').CHMParser | null = null;
  private chmEntries: Map<string, import('../types').CHMDirectoryEntry> | null = null;
  
  // Get current state
  getState(): AppState {
    return this.state;
  }
  
  // Get specific parts of state
  getReaderState(): ReaderState {
    return this.state.reader;
  }
  
  // Subscribe to state changes
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
  
  // Notify all subscribers
  private notify(): void {
    const state = this.state;
    this.subscribers.forEach(sub => sub(state));
  }
  
  // Debounced save to storage
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveState();
    }, 1000);
  }
  
  // Save current state to storage
  private async saveState(): Promise<void> {
    try {
      await storage.saveAppState(this.state);
      
      // Save reading progress if file is open
      const { chmFile, currentChapter, scrollPosition } = this.state.reader;
      if (chmFile && currentChapter) {
        const recentFile = this.state.recentFiles.find(f => f.hash === chmFile.hash);
        if (recentFile) {
          await storage.saveReadingProgress(
            chmFile.hash,
            currentChapter,
            scrollPosition,
            recentFile.completion
          );
        }
      }
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }
  
  // Dispatch action - main state update method
  dispatch(action: AppAction): void {
    const prevState = this.state;
    
    switch (action.type) {
      case 'SET_CHM_FILE':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, chmFile: action.payload }
        };
        break;
        
      case 'SET_CURRENT_CHAPTER':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, currentChapter: action.payload }
        };
        break;
        
      case 'SET_SCROLL_POSITION':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, scrollPosition: action.payload }
        };
        break;
        
      case 'SET_TOC_ENTRIES':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, tocEntries: action.payload }
        };
        break;
        
      case 'SET_INDEX_ENTRIES':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, indexEntries: action.payload }
        };
        break;
        
      case 'SET_ENCODING':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, encoding: action.payload }
        };
        break;
        
      case 'SET_LEGACY_STYLES_STRIPPED':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, legacyStylesStripped: action.payload }
        };
        break;
        
      case 'SET_THEME':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, themeId: action.payload }
        };
        break;
        
      case 'SET_TYPOGRAPHY':
        this.state = {
          ...this.state,
          reader: {
            ...this.state.reader,
            typography: { ...this.state.reader.typography, ...action.payload }
          }
        };
        break;
        
      case 'SET_SIDEBAR_VISIBLE':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, sidebarVisible: action.payload }
        };
        break;
        
      case 'SET_SIDEBAR_WIDTH':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, sidebarWidth: action.payload }
        };
        break;
        
      case 'SET_READING_MODE':
        this.state = {
          ...this.state,
          reader: { ...this.state.reader, readingMode: action.payload }
        };
        break;
        
      case 'SET_RECENT_FILES':
        this.state = { ...this.state, recentFiles: action.payload };
        break;
        
      case 'ADD_RECENT_FILE':
        const existingIndex = this.state.recentFiles.findIndex(
          f => f.hash === action.payload.hash
        );
        if (existingIndex >= 0) {
          const newRecent = [...this.state.recentFiles];
          newRecent[existingIndex] = action.payload;
          this.state = { ...this.state, recentFiles: newRecent };
        } else {
          this.state = {
            ...this.state,
            recentFiles: [action.payload, ...this.state.recentFiles]
          };
        }
        break;
        
      case 'UPDATE_RECENT_FILE':
        this.state = {
          ...this.state,
          recentFiles: this.state.recentFiles.map(f =>
            f.hash === action.payload.hash ? { ...f, ...action.payload.updates } : f
          )
        };
        break;
        
      case 'SET_INITIALIZED':
        this.state = { ...this.state, initialized: action.payload };
        break;
        
      case 'RESET_READER':
        this.state = {
          ...this.state,
          reader: { ...INITIAL_READER_STATE }
        };
        break;
    }
    
    // Only notify if state actually changed
    if (prevState !== this.state) {
      this.notify();
      this.scheduleSave();
    }
  }
  
  // Initialize store from storage
  async initialize(): Promise<void> {
    try {
      await storage.initStorage();
      
      // Load saved state
      const savedState = await storage.loadAppState();
      if (savedState) {
        this.state = {
          ...this.state,
          ...savedState,
          reader: { ...INITIAL_READER_STATE, ...savedState.reader }
        };
      }
      
      // Load recent files
      const recentFiles = await storage.getRecentFiles();
      this.dispatch({ type: 'SET_RECENT_FILES', payload: recentFiles });
      
      this.dispatch({ type: 'SET_INITIALIZED', payload: true });
      this.notify();
    } catch (error) {
      console.error('Failed to initialize store:', error);
      this.dispatch({ type: 'SET_INITIALIZED', payload: true });
    }
  }
  
  // Set CHM parser reference
  setCHMParser(parser: import('../services/chmParser').CHMParser | null): void {
    this.chmParser = parser;
  }
  
  // Get CHM parser reference
  getCHMParser(): import('../services/chmParser').CHMParser | null {
    return this.chmParser;
  }
  
  // Set CHM entries
  setCHMEntries(entries: Map<string, import('../types').CHMDirectoryEntry> | null): void {
    this.chmEntries = entries;
  }
  
  // Get CHM entries
  getCHMEntries(): Map<string, import('../types').CHMDirectoryEntry> | null {
    return this.chmEntries;
  }
}

// Export singleton instance
export const store = new AppStore();

// Action creators for cleaner dispatch calls
export const actions = {
  setCHMFile: (file: CHMFile | null) => 
    ({ type: 'SET_CHM_FILE' as const, payload: file }),
  
  setCurrentChapter: (chapter: string | null) => 
    ({ type: 'SET_CURRENT_CHAPTER' as const, payload: chapter }),
  
  setScrollPosition: (position: number) => 
    ({ type: 'SET_SCROLL_POSITION' as const, payload: position }),
  
  setTOCEntries: (entries: CHMTOCEntry[]) => 
    ({ type: 'SET_TOC_ENTRIES' as const, payload: entries }),
  
  setIndexEntries: (entries: CHMIndexEntry[]) => 
    ({ type: 'SET_INDEX_ENTRIES' as const, payload: entries }),
  
  setEncoding: (encoding: EncodingType) => 
    ({ type: 'SET_ENCODING' as const, payload: encoding }),
  
  setLegacyStylesStripped: (stripped: boolean) => 
    ({ type: 'SET_LEGACY_STYLES_STRIPPED' as const, payload: stripped }),
  
  setTheme: (themeId: ThemeId) => 
    ({ type: 'SET_THEME' as const, payload: themeId }),
  
  setTypography: (settings: Partial<TypographySettings>) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: settings }),
  
  setFontSize: (size: number) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { fontSize: Math.max(10, Math.min(32, size)) } }),
  
  setLineHeight: (height: number) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { lineHeight: Math.max(1, Math.min(3, height)) } }),
  
  setLetterSpacing: (spacing: number) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { letterSpacing: Math.max(-0.1, Math.min(0.5, spacing)) } }),
  
  setParagraphSpacing: (spacing: number) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { paragraphSpacing: Math.max(0.5, Math.min(3, spacing)) } }),
  
  setFontFamily: (family: FontFamily) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { fontFamily: family } }),
  
  setContainerWidth: (width: ContainerWidth) => 
    ({ type: 'SET_TYPOGRAPHY' as const, payload: { containerWidth: width } }),
  
  setSidebarVisible: (visible: boolean) => 
    ({ type: 'SET_SIDEBAR_VISIBLE' as const, payload: visible }),
  
  setSidebarWidth: (width: number) => 
    ({ type: 'SET_SIDEBAR_WIDTH' as const, payload: Math.max(200, Math.min(600, width)) }),
  
  setReadingMode: (mode: 'paginated' | 'infinite') => 
    ({ type: 'SET_READING_MODE' as const, payload: mode }),
  
  addRecentFile: (file: RecentFile) => 
    ({ type: 'ADD_RECENT_FILE' as const, payload: file }),
  
  updateRecentFile: (hash: string, updates: Partial<RecentFile>) => 
    ({ type: 'UPDATE_RECENT_FILE' as const, payload: { hash, updates } }),
  
  resetReader: () => ({ type: 'RESET_READER' as const })
};
