/**
 * Action Creators - Declarative state mutations with validation
 */

import type { 
  AppAction, CHMFile, CHMTOCEntry, CHMIndexEntry, 
  EncodingType, ThemeId, TypographySettings, FontFamily, 
  ContainerWidth, RecentFile 
} from '../types';

// Clamp utility for validation
const clamp = (value: number, min: number, max: number): number => 
  Math.max(min, Math.min(max, value));

// Typography actions
export const typography = {
  set: (settings: Partial<TypographySettings>): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: settings }),
  
  fontSize: (size: number): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { fontSize: clamp(size, 10, 32) } }),
  
  lineHeight: (height: number): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { lineHeight: clamp(height, 1, 3) } }),
  
  letterSpacing: (spacing: number): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { letterSpacing: clamp(spacing, -0.1, 0.5) } }),
  
  paragraphSpacing: (spacing: number): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { paragraphSpacing: clamp(spacing, 0.5, 3) } }),
  
  fontFamily: (family: FontFamily): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { fontFamily: family } }),
  
  containerWidth: (width: ContainerWidth): AppAction => 
    ({ type: 'SET_TYPOGRAPHY', payload: { containerWidth: width } })
};

// Reader actions
export const reader = {
  setCHMFile: (file: CHMFile | null): AppAction => 
    ({ type: 'SET_CHM_FILE', payload: file }),
  
  setChapter: (chapter: string | null): AppAction => 
    ({ type: 'SET_CURRENT_CHAPTER', payload: chapter }),
  
  setScroll: (position: number): AppAction => 
    ({ type: 'SET_SCROLL_POSITION', payload: position }),
  
  setTOC: (entries: CHMTOCEntry[]): AppAction => 
    ({ type: 'SET_TOC_ENTRIES', payload: entries }),
  
  setIndex: (entries: CHMIndexEntry[]): AppAction => 
    ({ type: 'SET_INDEX_ENTRIES', payload: entries }),
  
  setEncoding: (encoding: EncodingType): AppAction => 
    ({ type: 'SET_ENCODING', payload: encoding }),
  
  toggleLegacyStyles: (): AppAction => 
    ({ type: 'SET_LEGACY_STYLES_STRIPPED', payload: true }),
  
  setTheme: (themeId: ThemeId): AppAction => 
    ({ type: 'SET_THEME', payload: themeId }),
  
  toggleSidebar: (visible?: boolean): AppAction => 
    ({ type: 'SET_SIDEBAR_VISIBLE', payload: visible ?? null }), // Handle in reducer
  
  setSidebarWidth: (width: number): AppAction => 
    ({ type: 'SET_SIDEBAR_WIDTH', payload: clamp(width, 200, 600) }),
  
  setReadingMode: (mode: 'paginated' | 'infinite'): AppAction => 
    ({ type: 'SET_READING_MODE', payload: mode }),
  
  reset: (): AppAction => ({ type: 'RESET_READER' })
};

// Recent files actions
export const recentFiles = {
  set: (files: RecentFile[]): AppAction => 
    ({ type: 'SET_RECENT_FILES', payload: files }),
  
  add: (file: RecentFile): AppAction => 
    ({ type: 'ADD_RECENT_FILE', payload: file }),
  
  update: (hash: string, updates: Partial<RecentFile>): AppAction => 
    ({ type: 'UPDATE_RECENT_FILE', payload: { hash, updates } })
};

// App actions
export const app = {
  init: (): AppAction => ({ type: 'SET_INITIALIZED', payload: true })
};
