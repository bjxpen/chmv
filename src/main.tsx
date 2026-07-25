import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { appState, ThemeType } from './utils/appState';
import { ChmReader, ChmFileEntry } from './utils/chmReader';
import { parseSitemap, SitemapNode } from './utils/sitemapParser';
import { Dashboard } from './components/dashboard';
import { Sidebar } from './components/sidebar';
import { ReadingView } from './components/readingView';
import './styles.css';

// Global singleton decompressor instance
const chmReader = new ChmReader();

function App() {
  const [view, setView] = useState<'dashboard' | 'reader' | 'reopen'>('dashboard');
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [toc, setToc] = useState<SitemapNode[]>([]);
  const [index, setIndex] = useState<SitemapNode[]>([]);
  const [encoding, setEncoding] = useState(appState.currentEncoding);
  const [bookName, setBookName] = useState<string | null>(null);
  const [bookHash, setBookHash] = useState<string | null>(null);

  // Re-open state
  const [reopenHash, setReopenHash] = useState<string | null>(null);
  const [reopenName, setReopenName] = useState<string | null>(null);
  const repickInputRef = useRef<HTMLInputElement>(null);

  // Layout states
  const [sidebarVisible, setSidebarVisible] = useState(appState.sidebarVisible);
  const [showTypoPanel, setShowTypoPanel] = useState(false);

  // Monitor global sidebarVisible from appState
  useEffect(() => {
    const unsub = appState.subscribe(() => {
      setSidebarVisible(appState.sidebarVisible);
    });
    return unsub;
  }, []);

  // Set up global shortcut listeners
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // J / ArrowRight or K / ArrowLeft for chapter pagination
      if (e.key === 'ArrowLeft' || key === 'k') {
        e.preventDefault();
        navigateChapter(-1);
      } else if (e.key === 'ArrowRight' || key === 'j') {
        e.preventDefault();
        navigateChapter(1);
      }

      // B to toggle sidebar
      else if (key === 'b') {
        e.preventDefault();
        const nextVis = !appState.sidebarVisible;
        appState.updateState({ sidebarVisible: nextVis });
        setSidebarVisible(nextVis);
      }

      // Ctrl + + / - font sizing
      else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        adjustFontSize(1);
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        adjustFontSize(-1);
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [currentPath]);

  const adjustFontSize = (change: number) => {
    const nextSize = appState.fontSize + change;
    if (nextSize >= 10 && nextSize <= 48) {
      appState.updateState({ fontSize: nextSize });
      // trigger re-render on active page by forcing load
      if (currentPath) {
        // Just trigger a re-render
        setCurrentPath(currentPath);
      }
    }
  };

  const navigateChapter = (offset: number) => {
    if (!currentPath) return;
    const files = chmReader.getFileList().filter(f => f.path.match(/\.(html|htm)$/i));
    const currIndex = files.findIndex(d => d.path.toLowerCase() === currentPath.toLowerCase());
    if (currIndex === -1) return;

    const targetIndex = currIndex + offset;
    if (targetIndex >= 0 && targetIndex < files.length) {
      handleChapterNavigate(files[targetIndex].path);
    }
  };

  const handleFileSelected = async (file: File) => {
    try {
      setView('dashboard'); // loading
      const buffer = await file.arrayBuffer();
      const files = await chmReader.loadArchive(buffer, file.name);

      const hash = chmReader.getHash();
      setBookHash(hash);
      setBookName(file.name);

      appState.currentBookHash = hash;
      appState.currentBookName = file.name;

      // Extract & Parse TOC/Index
      const hhcFile = files.find(f => f.path.toLowerCase().endsWith('.hhc'));
      const hhkFile = files.find(f => f.path.toLowerCase().endsWith('.hhk'));

      let loadedToc: SitemapNode[] = [];
      let loadedIndex: SitemapNode[] = [];

      if (hhcFile) {
        try {
          const raw = chmReader.getRawBytes(hhcFile.path);
          const text = chmReader.decodeText(raw);
          loadedToc = parseSitemap(text);
        } catch (e) {
          loadedToc = generateFallbackToc(files);
        }
      } else {
        loadedToc = generateFallbackToc(files);
      }

      if (hhkFile) {
        try {
          const raw = chmReader.getRawBytes(hhkFile.path);
          const text = chmReader.decodeText(raw);
          loadedIndex = parseSitemap(text);
        } catch (e) {}
      }

      setToc(loadedToc);
      setIndex(loadedIndex);
      setView('reader');

      // Restore last read or load first document
      const recent = appState.getRecentFile(hash);
      if (recent && recent.lastChapterPath) {
        handleChapterNavigate(recent.lastChapterPath, recent.scrollPosition);
      } else {
        const firstDoc = loadedToc.length > 0 && loadedToc[0].local ? loadedToc[0].local : null;
        const fallbackDoc = files.find(f => f.path.match(/\.(html|htm)$/i))?.path || null;
        handleChapterNavigate(firstDoc || fallbackDoc || '');
      }

    } catch (e) {
      alert(`Error loading CHM: ${(e as Error).message}`);
      setView('dashboard');
    }
  };

  const generateFallbackToc = (files: ChmFileEntry[]): SitemapNode[] => {
    return files
      .filter(f => f.path.match(/\.(html|htm)$/i))
      .map(f => {
        let title = f.path.split('/').pop() || f.path;
        title = title.replace(/\.(html|htm)$/i, '').replace(/_/g, ' ');
        return {
          name: title,
          local: f.path
        };
      });
  };

  const handleRecentSelected = (hash: string) => {
    const recent = appState.getRecentFile(hash);
    if (!recent) return;
    setReopenHash(hash);
    setReopenName(recent.name);
    setView('reopen');
  };

  const handleRepickChange = async () => {
    if (repickInputRef.current?.files && repickInputRef.current.files.length > 0) {
      const file = repickInputRef.current.files[0];
      const tempReader = new ChmReader();
      await tempReader.initialize();
      const buffer = await file.arrayBuffer();
      const hashCheck = await tempReader['calculateHash'](buffer, file.name);

      if (hashCheck === reopenHash) {
        handleFileSelected(file);
      } else {
        if (confirm('The file you selected appears to be different. Load it anyway?')) {
          handleFileSelected(file);
        } else {
          setView('dashboard');
        }
      }
    }
  };

  const handleChapterNavigate = (path: string, scrollYPercent: number = 0) => {
    appState.currentChapterPath = path;
    appState.scrollPosition = scrollYPercent;
    setCurrentPath(path);

    // Track state and auto-save progress
    if (appState.currentBookHash && appState.currentBookName) {
      const files = chmReader.getFileList().filter(f => f.path.match(/\.(html|htm)$/i));
      const currIdx = files.findIndex(f => f.path.toLowerCase() === path.toLowerCase());
      const progress = files.length > 0 ? ((currIdx + 1) / files.length) * 100 : 0;

      appState.registerRecentFile(
        appState.currentBookHash,
        appState.currentBookName,
        path,
        scrollYPercent,
        progress
      );
    }
  };

  const handleScrollUpdate = (percent: number) => {
    appState.scrollPosition = percent;
    // Debounce/save reading state silently
    if (appState.currentBookHash && appState.currentBookName && currentPath) {
      const files = chmReader.getFileList().filter(f => f.path.match(/\.(html|htm)$/i));
      const currIdx = files.findIndex(f => f.path.toLowerCase() === currentPath.toLowerCase());
      const progress = files.length > 0 ? ((currIdx + 1) / files.length) * 100 : 0;

      appState.registerRecentFile(
        appState.currentBookHash,
        appState.currentBookName,
        currentPath,
        percent,
        progress
      );
    }
  };

  const handleCloseBook = () => {
    chmReader.cleanupFS();
    setView('dashboard');
    setCurrentPath(null);
    setToc([]);
    setIndex([]);
    setBookName(null);
    setBookHash(null);
  };

  const handleEncodingChange = (newEncoding: string) => {
    appState.updateState({ currentEncoding: newEncoding });
    setEncoding(newEncoding);
    if (currentPath) {
      // Reload chapter with new encoding
      handleChapterNavigate(currentPath, appState.scrollPosition);
    }
  };

  if (view === 'dashboard') {
    return (
      <Dashboard
        onFileSelected={handleFileSelected}
        onRecentSelected={handleRecentSelected}
      />
    );
  }

  if (view === 'reopen') {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <h2>Re-open {reopenName}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '30px' }}>
          To preserve privacy, file data is not stored on the server. Please select the file from your computer again to resume.
        </p>
        <button className="file-picker-btn" onClick={() => repickInputRef.current?.click()} style={{ marginBottom: '20px' }}>
          Choose CHM File
        </button>
        <br />
        <a href="#" onClick={(e) => { e.preventDefault(); setView('dashboard'); }} style={{ color: 'var(--active-bg)', textDecoration: 'none' }}>
          Back to Dashboard
        </a>
        <input
          type="file"
          ref={repickInputRef}
          onChange={handleRepickChange}
          accept=".chm"
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  return (
    <div className="reader-container">
      {/* Header bar */}
      <header className="reader-header">
        <div className="header-left">
          <button className="btn-icon" onClick={handleCloseBook} title="Close document and return to dashboard">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button
            className="btn-icon"
            onClick={() => {
              const nextVis = !appState.sidebarVisible;
              appState.updateState({ sidebarVisible: nextVis });
              setSidebarVisible(nextVis);
            }}
            title="Toggle Sidebar"
          >
            <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <span className="book-title">{bookName}</span>
        </div>
        <div className="header-right">
          {/* Active Encoding selector */}
          <select
            className="encoding-selector"
            value={encoding}
            onChange={(e) => handleEncodingChange((e.target as HTMLSelectElement).value)}
            title="Select legacy document encoding override"
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK (Chinese)</option>
            <option value="gb18030">GB18030</option>
            <option value="big5">Big5 (Traditional)</option>
            <option value="shift-jis">Shift-JIS (Japanese)</option>
          </select>

          <button className="btn-icon" onClick={() => setShowTypoPanel(!showTypoPanel)} title="Typography & Themes">
            <svg viewBox="0 0 24 24"><path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/></svg>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="reader-body">
        <Sidebar
          toc={toc}
          index={index}
          currentPath={currentPath}
          onNodeSelect={(node) => {
            if (node.local) handleChapterNavigate(node.local);
          }}
        />

        <ReadingView
          chmReader={chmReader}
          currentPath={currentPath}
          onChapterNavigate={(path) => handleChapterNavigate(path)}
          onScrollUpdate={handleScrollUpdate}
          showTypoPanel={showTypoPanel}
          setShowTypoPanel={setShowTypoPanel}
          encoding={encoding}
        />
      </div>
    </div>
  );
}

// Render root Preact component
const appNode = document.getElementById('app');
if (appNode) {
  render(<App />, appNode);
}

// Register Progressive Web App Service Worker for offline capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('chmv ServiceWorker registered successfully:', reg))
      .catch(err => console.error('chmv ServiceWorker registration failed:', err));
  });
}
