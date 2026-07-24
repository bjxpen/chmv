# CHM Reader

A privacy-focused, 100% client-side Web CHM Reader for legacy CJK web novels and modern technical documentation.

## Features

- **Zero Server Uploads**: All file parsing, decompression, and rendering happens locally in your browser
- **CJK Support**: Automatic encoding detection with manual override for GBK, GB18030, Big5, and Shift-JIS
- **Legacy Format Support**: Handles old CHM containers with fragmented HTML, non-standard directory structures, and vintage HTML styling
- **Modern Theme Engine**: Clean Light, Sepia, Warm Dark, and Pure OLED Black themes
- **Typography Controls**: Adjustable font size, line height, letter spacing, and paragraph spacing
- **CJK-Optimized Fonts**: Support for system sans-serif, serif, and calligraphic (KaiTi) fonts
- **Table of Contents**: Nested tree view with real-time search filtering
- **Keyword Index**: Alphabetical listing from .hhk files
- **Progress Tracking**: Automatic bookmarking of reading position using IndexedDB
- **Keyboard Shortcuts**: Navigate with J/K/Arrow keys, toggle sidebar with B
- **PWA Support**: Install as a desktop app for offline usage

## Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

1. Open the application in your browser
2. Drag and drop a CHM file onto the drop zone, or click to select
3. Use the sidebar to navigate chapters
4. Adjust theme and typography in settings
5. Change encoding if text displays incorrectly

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| J / ← | Previous chapter |
| K / → | Next chapter |
| B | Toggle sidebar |
| Ctrl + + | Increase font size |
| Ctrl + - | Decrease font size |
| / | Focus search |
| Esc | Clear search / Close dialogs |

## Architecture

```
src/
├── components/     # UI components with declarative rendering
├── services/       # CHM parsing, encoding, storage, assets
├── stores/         # Application state management
├── styles/         # CSS with theme variables
└── types/          # TypeScript type definitions
```

### Key Services

- **LZX Decompression**: Client-side LZX-compressed CHM archive support
- **CHM Parser**: ITSS/PMGL directory format parsing
- **Encoding Service**: CJK encoding detection and conversion
- **Storage Service**: IndexedDB-based state persistence
- **Asset Service**: Blob URL management for embedded media

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- No IE11 support

## License

MIT
