# chmv

A **client-side CHM reader** for the web. Drop in a `.chm` file — legacy
CJK web novel or modern technical documentation — and read it with modern
typography, themes and progress tracking. Everything (LZX decompression,
directory parsing, encoding detection, rendering, persistence) runs
locally in your browser: **no uploads, no external API calls**.

## Features

- **CHM engine in pure JS** — ITSF/ITSP container parser and an LZX
  decompressor ported from CHMLib/cabextract, running in a Web Worker.
  Archives are read as `File` slices on demand, so 100 MB+ books with
  thousands of chapters stay cheap on memory.
- **Legacy novel templates** — archives with no `.hhc` at all (2000s
  搜书吧-style novels) still work: chapters stored as `document.write()`
  scripts are statically extracted (never executed), the `pages[]`
  navigation array becomes a synthetic TOC with volume grouping, and
  iframe/frameset shell pages are recursively inlined. Archives with no
  recognizable structure get a directory-grouped fallback TOC.
- **CJK-first encodings** — automatic detection (meta charset → BOM →
  UTF-8 validation → CHM locale id) with a one-click override for GBK,
  GB18030, Big5, Shift-JIS, EUC-JP/KR and more. Switching re-decodes the
  current chapter and sidebar instantly, without re-parsing the file.
- **Reader UX** — content width presets (600/800/1000/full), font size
  (`Ctrl +`/`−`), line height, letter & paragraph spacing, CJK font
  stacks (sans/serif/kai/mono), four themes (Clean Light, Sepia, Warm
  Dark, OLED Black) and a *legacy style override* that strips vintage
  inline styling so themes apply uniformly.
- **Navigation** — collapsible TOC tree parsed from `.hhc`, searchable
  keyword index from `.hhk`, sidebar filter, resizable splitter,
  distraction-free mode, prev/next chapter controls at top and bottom,
  optional continuous scroll, and keyboard shortcuts
  (`←/→`, `J/K`, `Space`, `B`, `F`, `Esc`).
- **State & history** — reading position (chapter + scroll) is persisted
  per file hash in IndexedDB; reopening a book resumes exactly where you
  left off. The home shelf lists recent files with completion percentage.
- **Sandboxed rendering** — chapters are parsed inertly (scripts never
  execute), sanitized, and rendered inside a Shadow DOM boundary. Internal
  links are intercepted and routed through app state; images/CSS resolve
  to refcounted `blob:` URLs that are revoked when chapters unmount.
- **PWA** — installable, fully offline after first load, and registered
  as an OS-level handler for `.chm` files.

## Architecture

Flat components connected at a single composition root
(`src/main.js`) via dependency injection:

```
src/
├── engine/            # pure parsing layer — no DOM, runs anywhere
│   ├── lzx.js         #   LZX (sliding-window Huffman) decompressor
│   ├── chm.js         #   ITSF/ITSP container + block cache
│   ├── hhc.js         #   .hhc/.hhk tag-soup sitemap parser
│   ├── book.js        #   book assembly: encoding, nav, fallback TOC
│   ├── noveljs.js     #   script-driven novel support (document.write)
│   ├── encodings.js   #   charset aliases + detection heuristics
│   └── paths.js       #   internal path resolution (ms-its:, mk:@MSITStore:)
├── services/          # I/O adapters
│   ├── chm.worker.js  #   engine hosted in a worker (Comlink)
│   ├── engine.js      #   typed facade over the worker proxy
│   ├── library.js     #   IndexedDB progress/recents (idb)
│   └── settings.js    #   reactive settings signal → CSS custom properties
├── reader/
│   ├── store.js       #   app state (Preact signals) + actions, DI'd services
│   └── renderer.js    #   sanitizing Shadow-DOM chapter renderer + blob lifecycle
└── ui/                # declarative Preact + htm components
    ├── App.js  Home.js  Reader.js  Sidebar.js  Settings.js  icons.js
```

The store receives `{ createEngine, library, hashFile }` and the reader
view connects its imperative capabilities (`renderChapter`,
`getScrollState`, `reset`) back into the store — so every seam is
swappable, which is exactly how the integration tests run the full
open/navigate/resume flow in Node with fakes.

Libraries (~16 kB gzipped total added): [preact](https://preactjs.com) +
[htm](https://github.com/developit/htm) (no-build declarative UI),
[@preact/signals](https://preactjs.com/guide/v10/signals/) (state),
[comlink](https://github.com/GoogleChromeLabs/comlink) (worker RPC),
[idb](https://github.com/jakearchibald/idb) (IndexedDB),
[vite](https://vite.dev) + vite-plugin-pwa (build/offline).

## Development

```sh
npm install
npm run dev        # dev server
npm run build      # production build (dist/)
npm run preview    # serve the production build
npm test           # unit + engine extraction tests (Node)
node test/store-test.mjs   # store integration flow with fakes
```

`test/extract-test.mjs` extracts every entry of a fixture CHM and can
byte-compare against a directory produced by CHMLib's `extract_chmLib`
for decompressor verification.

## License notes

The LZX decoder (`src/engine/lzx.js`) is a port of lzx.c from
cabextract/CHMLib (Stuart Caie, Jed Wing; LGPL). `test/fixtures/putty.chm`
is the PuTTY manual, MIT-licensed (see `putty.chm.LICENCE`).
