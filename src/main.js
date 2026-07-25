/*
 * main.js — composition root.
 *
 * All dependencies are constructed here and injected downward:
 *   engine factory (worker) ─┐
 *   library (IndexedDB)      ├─> store ─> <App/>
 *   hashFile                 ┘
 */

'use strict';

import { render } from 'preact';
import { html } from './ui/html.js';
import { App } from './ui/App.js';
import { createStore } from './reader/store.js';
import { createEngine } from './services/engine.js';
import { library, hashFile } from './services/library.js';

const store = createStore({ createEngine, library, hashFile });

/* PWA: handle .chm files launched via the OS file handler */
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (!handle) return;
    try {
      store.openFile(await handle.getFile(), handle);
    } catch { /* ignore */ }
  });
}

render(html`<${App} store=${store} />`, document.getElementById('app'));
