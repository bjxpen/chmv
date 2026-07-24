// Core CHM Types
export interface CHMFile {
  file: File;
  name: string;
  size: number;
  hash: string;
}

export interface CHMHeader {
  signature: string;
  version: number;
  headerLength: number;
  unknown1: number;
  unknown2: number;
  lastModified: number;
  unknown3: number;
  unknown4: number;
}

export interface CHMDirectoryEntry {
  name: string;
  offset: number;
  length: number;
  flags: number;
}

export interface CHMFileEntry {
  path: string;
  content: Uint8Array;
  contentType: string;
}

export interface CHMTOCEntry {
  name: string;
  path: string;
  children: CHMTOCEntry[];
  expanded?: boolean;
}

export interface CHMIndexEntry {
  name: string;
  references: CHMIndexReference[];
}

export interface CHMIndexReference {
  name: string;
  url: string;
}

// Encoding types
export type EncodingType = 'utf-8' | 'gbk' | 'gb18030' | 'big5' | 'shift-jis';

export interface EncodingOption {
  id: EncodingType;
  label: string;
  nativeLabel: string;
}

export const ENCODING_OPTIONS: EncodingOption[] = [
  { id: 'utf-8', label: 'UTF-8', nativeLabel: 'UTF-8' },
  { id: 'gbk', label: 'GBK', nativeLabel: '简体中文 (GBK)' },
  { id: 'gb18030', label: 'GB18030', nativeLabel: '简体中文 (GB18030)' },
  { id: 'big5', label: 'Big5', nativeLabel: '繁體中文 (Big5)' },
  { id: 'shift-jis', label: 'Shift-JIS', nativeLabel: '日本語 (Shift-JIS)' }
];

// Theme types
export type ThemeId = 'light' | 'sepia' | 'dark' | 'oled';

export interface Theme {
  id: ThemeId;
  name: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  accent: string;
  sidebarBg: string;
  scrollbar: string;
  scrollbarHover: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  light: {
    id: 'light',
    name: 'Clean Light',
    background: '#ffffff',
    surface: '#f8f9fa',
    text: '#1a1a2e',
    textSecondary: '#6c757d',
    border: '#dee2e6',
    accent: '#4a90d9',
    sidebarBg: '#f1f3f5',
    scrollbar: '#c1c1c1',
    scrollbarHover: '#a1a1a1'
  },
  sepia: {
    id: 'sepia',
    name: 'Sepia',
    background: '#f4ecd8',
    surface: '#ebe2cc',
    text: '#5b4636',
    textSecondary: '#8b7355',
    border: '#d4c4a8',
    accent: '#b8860b',
    sidebarBg: '#e8dcc8',
    scrollbar: '#c9b896',
    scrollbarHover: '#b8a885'
  },
  dark: {
    id: 'dark',
    name: 'Warm Dark',
    background: '#2d2d3a',
    surface: '#3a3a4a',
    text: '#e8e8f0',
    textSecondary: '#a0a0b0',
    border: '#4a4a5a',
    accent: '#7eb8e8',
    sidebarBg: '#252532',
    scrollbar: '#5a5a6a',
    scrollbarHover: '#6a6a7a'
  },
  oled: {
    id: 'oled',
    name: 'Pure OLED Black',
    background: '#000000',
    surface: '#121212',
    text: '#e0e0e0',
    textSecondary: '#808080',
    border: '#2a2a2a',
    accent: '#6aa8e8',
    sidebarBg: '#0a0a0a',
    scrollbar: '#333333',
    scrollbarHover: '#444444'
  }
};

// Typography types
export interface TypographySettings {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  fontFamily: FontFamily;
  containerWidth: ContainerWidth;
}

export type FontFamily = 'sans-serif' | 'serif' | 'kai-ti';
export type ContainerWidth = 600 | 800 | 1000 | 'fluid';

export const FONT_FAMILIES: Record<FontFamily, string> = {
  'sans-serif': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'serif': 'Georgia, "Times New Roman", serif',
  'kai-ti': '"KaiTi", "STKaiti", "FangSong", serif'
};

export const CONTAINER_WIDTHS: Record<ContainerWidth, string> = {
  600: '600px',
  800: '800px',
  1000: '1000px',
  fluid: '100%'
};

// Reader state
export interface ReaderState {
  chmFile: CHMFile | null;
  currentChapter: string | null;
  scrollPosition: number;
  tocEntries: CHMTOCEntry[];
  indexEntries: CHMIndexEntry[];
  encoding: EncodingType;
  legacyStylesStripped: boolean;
  themeId: ThemeId;
  typography: TypographySettings;
  sidebarVisible: boolean;
  sidebarWidth: number;
  readingMode: 'paginated' | 'infinite';
  scrollMode: 'top' | 'bottom';
}

// Recent file entry
export interface RecentFile {
  hash: string;
  name: string;
  size: number;
  lastChapter: string | null;
  lastPosition: number;
  completion: number;
  lastAccessed: number;
  tocEntries: CHMTOCEntry[];
}

// App state
export interface AppState {
  reader: ReaderState;
  recentFiles: RecentFile[];
  initialized: boolean;
}

// Action types for declarative updates
export type AppAction =
  | { type: 'SET_CHM_FILE'; payload: CHMFile | null }
  | { type: 'SET_CURRENT_CHAPTER'; payload: string | null }
  | { type: 'SET_SCROLL_POSITION'; payload: number }
  | { type: 'SET_TOC_ENTRIES'; payload: CHMTOCEntry[] }
  | { type: 'SET_INDEX_ENTRIES'; payload: CHMIndexEntry[] }
  | { type: 'SET_ENCODING'; payload: EncodingType }
  | { type: 'SET_LEGACY_STYLES_STRIPPED'; payload: boolean }
  | { type: 'SET_THEME'; payload: ThemeId }
  | { type: 'SET_TYPOGRAPHY'; payload: Partial<TypographySettings> }
  | { type: 'SET_SIDEBAR_VISIBLE'; payload: boolean }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: number }
  | { type: 'SET_READING_MODE'; payload: 'paginated' | 'infinite' }
  | { type: 'SET_RECENT_FILES'; payload: RecentFile[] }
  | { type: 'ADD_RECENT_FILE'; payload: RecentFile }
  | { type: 'UPDATE_RECENT_FILE'; payload: { hash: string; updates: Partial<RecentFile> } }
  | { type: 'SET_INITIALIZED'; payload: boolean }
  | { type: 'RESET_READER' };
