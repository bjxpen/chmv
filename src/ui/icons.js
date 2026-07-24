/*
 * ui/icons.js — inline SVG icon components.
 */

'use strict';

import { html } from './html.js';

const svg = (path, size = 20) => () => html`
  <svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true">
    <path fill="currentColor" d=${path} />
  </svg>`;

export const HomeIcon = svg('M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6a1 1 0 0 0-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z');
export const SidebarIcon = svg('M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z');
export const FocusIcon = svg('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z');
export const UnfocusIcon = svg('M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z');
export const GearIcon = svg('M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-.97l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.32-.07.65-.07.98s.03.66.07.97l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.34.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.05.24.25.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65a7.3 7.3 0 0 0 1.69-.98l2.49 1c.23.09.5 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65z');
export const UploadIcon = svg('M19 13v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5h2v5h10v-5h2zM11 4.83 8.41 7.41 7 6l5-5 5 5-1.41 1.41L13 4.83V15h-2V4.83z', 42);
