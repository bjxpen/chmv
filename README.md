# chmv - Client-Side Web CHM Reader

A privacy-focused, offline-capable CHM file reader built as a Progressive Web Application (PWA).

## Features

### Core Functionality
- **100% Client-Side**: Zero server uploads or external API calls. All parsing and rendering happens locally.
- **CHM Support**: Full support for LZX-compressed CHM archives
- **CJK Encoding Support**: Automatic detection and manual override for GBK, GB18030, Big5, Shift-JIS, and more

### Reader Experience
- **Typography Controls**: Adjustable font size, line height, content width, letter spacing
- **Theme Engine**: Light, Sepia, Dark, and OLED Black themes
- **Legacy Style Override**: Strip hardcoded inline styles from vintage HTML templates
- **CJK Typography**: Optimized line breaking and word wrapping for CJK text

### Navigation
- **Sidebar TOC**: Collapsible nested tree view from .hhc files
- **Index Support**: Keyword index (.hhk) parsing and search
- **Search**: Real-time filtering of chapters and index entries
- **Keyboard Shortcuts**: 
  - `Ctrl+O`: Open file
  - `Ctrl++/-`: Zoom in/out
  - `←/→`: Previous/Next chapter
  - `B`: Toggle sidebar
  - `Space`: Scroll

### Progress Tracking
- **Reading State**: Automatically saves chapter position and scroll offset
- **Recent Files**: Dashboard with completion percentage and timestamps
- **Last Read Restoration**: Resume exactly where you left off

### PWA Features
- **Offline Execution**: Works completely offline after initial load
- **Installable**: Can be installed as a standalone desktop application
- **Service Worker**: Cached assets for instant loading

## Installation

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Production build
npm run build
```

## Usage

1. Open the application in a modern browser
2. Drag and drop a CHM file or click to browse
3. Navigate using the sidebar or keyboard shortcuts
4. Customize reading experience via toolbar controls

## Architecture

```
src/
├── core/           # CHM parsing, LZX decompression, encoding
├── rendering/      # Content renderer with shadow DOM isolation
├── components/     # UI components (sidebar, toolbar)
├── state/          # IndexedDB state management
├── styles/         # CSS stylesheets
└── main.js         # Application entry point
```

## Browser Support

- Chrome/Edge 80+
- Firefox 75+
- Safari 14+

## License

MIT
