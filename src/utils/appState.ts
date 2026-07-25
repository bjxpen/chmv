export interface RecentFileEntry {
  hash: string;
  name: string;
  timestamp: number;
  lastChapterPath: string | null;
  scrollPosition: number;
  completedPercent: number;
}

export type ThemeType = 'light' | 'sepia' | 'dark' | 'oled';
export type ContainerWidthType = '600px' | '800px' | '1000px' | '100%';
export type FontFamilyType = 'sans-serif' | 'serif' | 'kaiti';

export class AppState {
  // State variables
  currentBookHash: string | null = null;
  currentBookName: string | null = null;
  currentChapterPath: string | null = null;
  currentEncoding: string = 'utf-8';
  detectedEncoding: string | null = null;
  activeTab: 'toc' | 'index' = 'toc';
  searchQuery: string = '';
  sidebarVisible: boolean = true;
  sidebarWidth: number = 300;
  distractionFree: boolean = false;

  // Typography & Themes
  theme: ThemeType = 'light';
  fontSize: number = 16;
  lineHeight: number = 1.6;
  letterSpacing: number = 0; // in em or px
  paragraphSpacing: number = 1.2; // in em
  containerWidth: ContainerWidthType = '800px';
  fontFamily: FontFamilyType = 'sans-serif';
  legacyStyleOverride: boolean = true;
  infiniteScroll: boolean = false;
  scrollPosition: number = 0;

  // History & Storage
  recentFiles: RecentFileEntry[] = [];

  // Listeners for reactivity
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadSettings();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    this.listeners.forEach(l => l());
  }

  // Load typography & global app settings from LocalStorage
  private loadSettings(): void {
    try {
      this.theme = (localStorage.getItem('chmv-theme') as ThemeType) || 'light';
      this.fontSize = parseInt(localStorage.getItem('chmv-font-size') || '16', 10);
      this.lineHeight = parseFloat(localStorage.getItem('chmv-line-height') || '1.6');
      this.letterSpacing = parseFloat(localStorage.getItem('chmv-letter-spacing') || '0');
      this.paragraphSpacing = parseFloat(localStorage.getItem('chmv-paragraph-spacing') || '1.2');
      this.containerWidth = (localStorage.getItem('chmv-container-width') as ContainerWidthType) || '800px';
      this.fontFamily = (localStorage.getItem('chmv-font-family') as FontFamilyType) || 'sans-serif';
      this.legacyStyleOverride = localStorage.getItem('chmv-legacy-override') !== 'false';
      this.sidebarWidth = parseInt(localStorage.getItem('chmv-sidebar-width') || '300', 10);
      this.infiniteScroll = localStorage.getItem('chmv-infinite-scroll') === 'true';

      const recentRaw = localStorage.getItem('chmv-recent-files');
      if (recentRaw) {
        this.recentFiles = JSON.parse(recentRaw);
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem('chmv-theme', this.theme);
      localStorage.setItem('chmv-font-size', this.fontSize.toString());
      localStorage.setItem('chmv-line-height', this.lineHeight.toString());
      localStorage.setItem('chmv-letter-spacing', this.letterSpacing.toString());
      localStorage.setItem('chmv-paragraph-spacing', this.paragraphSpacing.toString());
      localStorage.setItem('chmv-container-width', this.containerWidth);
      localStorage.setItem('chmv-font-family', this.fontFamily);
      localStorage.setItem('chmv-legacy-override', this.legacyStyleOverride.toString());
      localStorage.setItem('chmv-sidebar-width', this.sidebarWidth.toString());
      localStorage.setItem('chmv-infinite-scroll', this.infiniteScroll.toString());
      localStorage.setItem('chmv-recent-files', JSON.stringify(this.recentFiles));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  updateState(updates: Partial<AppState>): void {
    Object.assign(this, updates);
    this.saveSettings();
    this.notify();
  }

  /**
   * Add or update a file in the recent dashboard.
   */
  registerRecentFile(hash: string, name: string, lastChapterPath: string | null, scrollPos: number, progressPercent: number): void {
    // Remove if already exists to move to top
    this.recentFiles = this.recentFiles.filter(f => f.hash !== hash);
    this.recentFiles.unshift({
      hash,
      name,
      timestamp: Date.now(),
      lastChapterPath,
      scrollPosition: scrollPos,
      completedPercent: progressPercent
    });
    // Cap at 15 files
    if (this.recentFiles.length > 15) {
      this.recentFiles.pop();
    }
    this.saveSettings();
    this.notify();
  }

  getRecentFile(hash: string): RecentFileEntry | undefined {
    return this.recentFiles.find(f => f.hash === hash);
  }
}

export const appState = new AppState();
