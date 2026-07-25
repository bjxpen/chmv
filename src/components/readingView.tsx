import { h, Fragment } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { appState, ThemeType, FontFamilyType, ContainerWidthType } from '../utils/appState';
import { ChmReader } from '../utils/chmReader';

interface ReadingViewProps {
  chmReader: ChmReader;
  currentPath: string | null;
  onChapterNavigate: (relPath: string) => void;
  onScrollUpdate: (percent: number) => void;
  showTypoPanel: boolean;
  setShowTypoPanel: (show: boolean) => void;
  encoding: string;
}

export function ReadingView({
  chmReader,
  currentPath,
  onChapterNavigate,
  onScrollUpdate,
  showTypoPanel,
  setShowTypoPanel,
  encoding,
}: ReadingViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Local state synced from appState for re-rendering
  const [theme, setTheme] = useState(appState.theme);
  const [fontFamily, setFontFamily] = useState(appState.fontFamily);
  const [fontSize, setFontSize] = useState(appState.fontSize);
  const [lineHeight, setLineHeight] = useState(appState.lineHeight);
  const [letterSpacing, setLetterSpacing] = useState(appState.letterSpacing);
  const [paragraphSpacing, setParagraphSpacing] = useState(appState.paragraphSpacing);
  const [containerWidth, setContainerWidth] = useState(appState.containerWidth);
  const [legacyOverride, setLegacyOverride] = useState(appState.legacyStyleOverride);

  // Active resource blob URLs clean up
  const cleanupBlobUrls = () => {
    blobUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    blobUrlsRef.current.clear();
  };

  useEffect(() => {
    return () => {
      cleanupBlobUrls();
    };
  }, []);

  // Whenever relevant path, theme, typography, override changes: reload chapter!
  useEffect(() => {
    if (currentPath) {
      loadChapterContent(currentPath);
    }
  }, [
    currentPath,
    theme,
    fontFamily,
    fontSize,
    lineHeight,
    letterSpacing,
    paragraphSpacing,
    containerWidth,
    legacyOverride,
    encoding,
  ]);

  const loadChapterContent = async (relPath: string) => {
    if (!iframeRef.current) return;
    cleanupBlobUrls();

    try {
      const rawBytes = chmReader.getRawBytes(relPath);
      let htmlText = chmReader.decodeText(rawBytes, encoding);

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      resolveRelativeAssets(doc, relPath);
      applyThemeAndTypographyOverrides(doc);
      interceptLinks(doc, relPath);

      const updatedHtml = new XMLSerializer().serializeToString(doc);
      iframeRef.current.srcdoc = updatedHtml;

      iframeRef.current.onload = () => {
        setupIframeScrollTracking();
      };
    } catch (e) {
      console.error('Error loading chapter content', e);
      iframeRef.current.srcdoc = `
        <div style="padding: 40px; text-align: center; font-family: sans-serif; color: #ff453a;">
          <h3>Failed to load chapter content</h3>
          <p>${(e as Error).message}</p>
        </div>
      `;
    }
  };

  const resolveRelativeAssets = (doc: Document, baseRelPath: string) => {
    const basePathDir = baseRelPath.includes('/') ? baseRelPath.substring(0, baseRelPath.lastIndexOf('/')) : '';
    const parser = new DOMParser();

    // Resolve Images
    const imgs = Array.from(doc.querySelectorAll('img, image'));
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:')) {
        const resolvedPath = resolveRelativePath(basePathDir, src);
        try {
          const raw = chmReader.getRawBytes(resolvedPath);
          const mime = getMimeType(resolvedPath);
          const blob = new Blob([raw], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlsRef.current.add(blobUrl);
          img.setAttribute('src', blobUrl);
        } catch (e) {}
      }
    });

    // Resolve Style sheets
    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('blob:')) {
        const resolvedPath = resolveRelativePath(basePathDir, href);
        try {
          const raw = chmReader.getRawBytes(resolvedPath);
          const blob = new Blob([raw], { type: 'text/css' });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlsRef.current.add(blobUrl);
          link.setAttribute('href', blobUrl);
        } catch (e) {}
      }
    });

    // Resolve nested IFRAMEs or FRAMEs (very common in wrapper index pages of legacy CJK novels)
    const frames = Array.from(doc.querySelectorAll('iframe, frame'));
    frames.forEach((frame) => {
      const src = frame.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:')) {
        const resolvedPath = resolveRelativePath(basePathDir, src);
        try {
          const raw = chmReader.getRawBytes(resolvedPath);
          let subHtmlText = chmReader.decodeText(raw, encoding);

          const subDoc = parser.parseFromString(subHtmlText, 'text/html');
          resolveRelativeAssets(subDoc, resolvedPath);
          applyThemeAndTypographyOverrides(subDoc);
          interceptLinks(subDoc, resolvedPath);

          const subSerialized = new XMLSerializer().serializeToString(subDoc);
          const blob = new Blob([subSerialized], { type: 'text/html' });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlsRef.current.add(blobUrl);
          frame.setAttribute('src', blobUrl);
        } catch (e) {}
      }
    });
  };

  const resolveRelativePath = (baseDir: string, relPath: string): string => {
    if (!baseDir) return relPath;
    const parts = (baseDir + '/' + relPath).split('/');
    const result: string[] = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        result.pop();
      } else {
        result.push(part);
      }
    }
    return result.join('/');
  };

  const getMimeType = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'svg': return 'image/svg+xml';
      default: return 'application/octet-stream';
    }
  };

  const applyThemeAndTypographyOverrides = (doc: Document) => {
    const body = doc.body;
    if (!body) return;

    if (legacyOverride) {
      body.removeAttribute('bgcolor');
      body.removeAttribute('text');
      body.removeAttribute('link');
      body.removeAttribute('vlink');
      body.removeAttribute('alink');
      body.removeAttribute('background');

      const elementsWithStyles = doc.querySelectorAll('[style], font');
      elementsWithStyles.forEach((elem) => {
        if (elem.tagName.toLowerCase() === 'font') {
          elem.removeAttribute('color');
          elem.removeAttribute('size');
          elem.removeAttribute('face');
        } else {
          const style = elem.getAttribute('style') || '';
          const cleaned = style
            .replace(/background-color\s*:[^;]+;?/gi, '')
            .replace(/background\s*:[^;]+;?/gi, '')
            .replace(/color\s*:[^;]+;?/gi, '')
            .replace(/font-family\s*:[^;]+;?/gi, '');
          elem.setAttribute('style', cleaned);
        }
      });
    }

    let styleTag = doc.getElementById('chmv-override-style');
    if (!styleTag) {
      styleTag = doc.createElement('style');
      styleTag.id = 'chmv-override-style';
      doc.head.appendChild(styleTag);
    }

    const themeColors = getThemeColors(theme);
    const fontStack = getFontStack(fontFamily);

    styleTag.textContent = `
      html, body {
        background-color: ${themeColors.bg} !important;
        color: ${themeColors.text} !important;
        font-family: ${fontStack} !important;
        font-size: ${fontSize}px !important;
        line-height: ${lineHeight} !important;
        letter-spacing: ${letterSpacing}em !important;
        margin: 0 !important;
        padding: 20px !important;
        transition: background-color 0.2s, color 0.2s;
        word-wrap: break-word;
        word-break: break-all;
        overflow-x: hidden;
      }
      p {
        margin-bottom: ${paragraphSpacing}em !important;
        margin-top: 0 !important;
      }
      a {
        color: ${themeColors.accent} !important;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
    `;
  };

  const getThemeColors = (t: ThemeType) => {
    switch (t) {
      case 'sepia': return { bg: '#fbf0db', text: '#4a3525', accent: '#a0522d' };
      case 'dark': return { bg: '#1e1e1e', text: '#e3e3e3', accent: '#0a84ff' };
      case 'oled': return { bg: '#000000', text: '#f5f5f7', accent: '#0a84ff' };
      default: return { bg: '#ffffff', text: '#1d1d1f', accent: '#0071e3' };
    }
  };

  const getFontStack = (f: FontFamilyType) => {
    switch (f) {
      case 'serif': return 'Georgia, "Times New Roman", Times, serif';
      case 'kaiti': return '"KaiTi", "STKaiti", "BiauKai", "Calligraphy", serif';
      default: return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }
  };

  const interceptLinks = (doc: Document, baseRelPath: string) => {
    const basePathDir = baseRelPath.substring(0, baseRelPath.lastIndexOf('/'));
    const anchors = Array.from(doc.querySelectorAll('a'));

    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('javascript:')) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          if (href.startsWith('#')) {
            const targetElem = doc.getElementById(href.substring(1));
            targetElem?.scrollIntoView({ behavior: 'smooth' });
          } else {
            const [pathPart, anchorPart] = href.split('#');
            const resolvedPath = resolveRelativePath(basePathDir, pathPart);
            onChapterNavigate(resolvedPath);

            if (anchorPart) {
              setTimeout(() => {
                const innerDoc = iframeRef.current?.contentDocument;
                const target = innerDoc?.getElementById(anchorPart);
                target?.scrollIntoView();
              }, 300);
            }
          }
        });
      }
    });
  };

  const setupIframeScrollTracking = () => {
    const innerWindow = iframeRef.current?.contentWindow;
    const innerDoc = iframeRef.current?.contentDocument;
    if (!innerWindow || !innerDoc) return;

    // Restore scroll position
    if (appState.scrollPosition > 0) {
      const maxScroll = innerDoc.documentElement.scrollHeight - innerWindow.innerHeight;
      innerWindow.scrollTo(0, maxScroll * appState.scrollPosition);
    }

    let timer: any;
    innerWindow.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const docElem = innerDoc.documentElement;
        const totalHeight = docElem.scrollHeight - innerWindow.innerHeight;
        const currentScroll = innerWindow.scrollY;
        const percent = totalHeight > 0 ? currentScroll / totalHeight : 0;
        onScrollUpdate(percent);
      }, 200);
    });

    adjustIframeHeight();
  };

  const adjustIframeHeight = () => {
    const innerDoc = iframeRef.current?.contentDocument;
    if (iframeRef.current && innerDoc && innerDoc.body) {
      iframeRef.current.style.height = `${innerDoc.documentElement.scrollHeight + 40}px`;
    }
  };

  // Nav sibling chapters
  const getSiblingNode = (offset: number): string | null => {
    const files = chmReader.getFileList();
    if (!currentPath) return null;

    const docs = files.filter((f) => f.path.match(/\.(html|htm)$/i));
    const currIndex = docs.findIndex((d) => d.path.toLowerCase() === currentPath.toLowerCase());
    if (currIndex === -1) return null;

    const targetIndex = currIndex + offset;
    if (targetIndex >= 0 && targetIndex < docs.length) {
      return docs[targetIndex].path;
    }
    return null;
  };

  const handlePrevClick = () => {
    const prevPath = getSiblingNode(-1);
    if (prevPath) onChapterNavigate(prevPath);
  };

  const handleNextClick = () => {
    const nextPath = getSiblingNode(1);
    if (nextPath) onChapterNavigate(nextPath);
  };

  // Typo update dispatcher
  const updateTypoState = (updates: Partial<typeof appState>) => {
    appState.updateState(updates);
    if (updates.theme !== undefined) setTheme(updates.theme as ThemeType);
    if (updates.fontFamily !== undefined) setFontFamily(updates.fontFamily as FontFamilyType);
    if (updates.fontSize !== undefined) setFontSize(updates.fontSize);
    if (updates.lineHeight !== undefined) setLineHeight(updates.lineHeight);
    if (updates.letterSpacing !== undefined) setLetterSpacing(updates.letterSpacing);
    if (updates.paragraphSpacing !== undefined) setParagraphSpacing(updates.paragraphSpacing);
    if (updates.containerWidth !== undefined) setContainerWidth(updates.containerWidth as ContainerWidthType);
    if (updates.legacyStyleOverride !== undefined) setLegacyOverride(updates.legacyStyleOverride);
  };

  return (
    <div className="reading-area">
      <div className="reading-viewport">
        <div className="reading-scroller" id="reading-scroller" style={{ maxWidth: containerWidth }}>
          {/* Top Sticky Nav */}
          <div className="chapter-nav-bar" id="nav-top">
            <button className="btn-nav" onClick={handlePrevClick}>
              ← Previous Chapter
            </button>
            <button className="btn-nav" onClick={handleNextClick}>
              Next Chapter →
            </button>
          </div>

          {/* Iframe Sandbox */}
          <iframe
            ref={iframeRef}
            className="iframe-sandbox"
            id="chapter-iframe"
            sandbox="allow-same-origin allow-scripts"
            title="Chapter Content"
          ></iframe>

          {/* Bottom Sticky Nav */}
          <div className="chapter-nav-bar" id="nav-bottom">
            <button className="btn-nav" onClick={handlePrevClick}>
              ← Previous Chapter
            </button>
            <button className="btn-nav" onClick={handleNextClick}>
              Next Chapter →
            </button>
          </div>
        </div>
      </div>

      {/* Typography Controls Panel Popover */}
      {showTypoPanel && (
        <div className="typography-panel visible" id="typography-panel">
          <div className="panel-row">
            <label>Theme</label>
            <div className="theme-button-group">
              {['light', 'sepia', 'dark', 'oled'].map((t) => (
                <button
                  key={t}
                  className={`theme-btn ${theme === t ? 'active' : ''}`}
                  onClick={() => {
                    updateTypoState({ theme: t as ThemeType });
                    document.body.className = `theme-${t}`;
                  }}
                  style={{
                    background: t === 'light' ? '#fff' : t === 'sepia' ? '#fbf0db' : t === 'dark' ? '#1e1e1e' : '#000',
                    color: t === 'light' ? '#000' : t === 'sepia' ? '#4a3525' : '#fff',
                  }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-row">
            <label>Font Family</label>
            <div className="control-btn-group">
              <button
                className={`control-btn ${fontFamily === 'sans-serif' ? 'active' : ''}`}
                onClick={() => updateTypoState({ fontFamily: 'sans-serif' })}
              >
                Sans-Serif
              </button>
              <button
                className={`control-btn ${fontFamily === 'serif' ? 'active' : ''}`}
                onClick={() => updateTypoState({ fontFamily: 'serif' })}
              >
                Serif
              </button>
              <button
                className={`control-btn ${fontFamily === 'kaiti' ? 'active' : ''}`}
                onClick={() => updateTypoState({ fontFamily: 'kaiti' })}
              >
                KaiTi
              </button>
            </div>
          </div>

          <div className="panel-row">
            <label>Font Size</label>
            <div className="control-btn-group" style={{ alignItems: 'center' }}>
              <button
                className="control-btn"
                onClick={() => {
                  if (fontSize > 10) updateTypoState({ fontSize: fontSize - 1 });
                }}
              >
                A-
              </button>
              <span style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{fontSize}px</span>
              <button
                className="control-btn"
                onClick={() => {
                  if (fontSize < 48) updateTypoState({ fontSize: fontSize + 1 });
                }}
              >
                A+
              </button>
            </div>
          </div>

          <div className="panel-row">
            <label>Container Width</label>
            <div className="control-btn-group">
              {['600px', '800px', '1000px', '100%'].map((w) => (
                <button
                  key={w}
                  className={`control-btn ${containerWidth === w ? 'active' : ''}`}
                  onClick={() => updateTypoState({ containerWidth: w as any })}
                >
                  {w === '100%' ? 'Fluid' : w}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-row">
            <label>Spacing Controls</label>
            <div className="control-btn-group" style={{ fontSize: '0.8rem', textAlign: 'center' }}>
              <button
                className="control-btn"
                onClick={() => {
                  const lineHeights = [1.2, 1.4, 1.6, 1.8, 2.0];
                  const nextIdx = (lineHeights.indexOf(lineHeight) + 1) % lineHeights.length;
                  updateTypoState({ lineHeight: lineHeights[nextIdx] });
                }}
              >
                Line: {lineHeight}
              </button>
              <button
                className="control-btn"
                onClick={() => {
                  const spacings = [0, 0.05, 0.1, 0.15, 0.2];
                  const nextIdx = (spacings.indexOf(letterSpacing) + 1) % spacings.length;
                  updateTypoState({ letterSpacing: spacings[nextIdx] });
                }}
              >
                Letter: {letterSpacing}
              </button>
              <button
                className="control-btn"
                onClick={() => {
                  const paras = [0.8, 1.2, 1.6, 2.0];
                  const nextIdx = (paras.indexOf(paragraphSpacing) + 1) % paras.length;
                  updateTypoState({ paragraphSpacing: paras[nextIdx] });
                }}
              >
                Para: {paragraphSpacing}
              </button>
            </div>
          </div>

          <div className="panel-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={legacyOverride}
                onChange={(e) => updateTypoState({ legacyStyleOverride: (e.target as HTMLInputElement).checked })}
              />
              Override Legacy Styling
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
