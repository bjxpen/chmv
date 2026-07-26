/*
 * chapter-css.js — base stylesheet injected into the chapter shadow root.
 *
 * Typography and theme come from the host page via CSS custom properties
 * (--reader-*) that pierce the shadow boundary; everything else here is
 * structural reading-surface styling plus the optional legacy override
 * block that neutralizes hardcoded vintage styling.
 */

'use strict';

const LEGACY_OVERRIDES = `
  /* Neutralize hardcoded legacy styling so themes apply uniformly. */
  .chapters section.doc, .chapters section.doc * {
    background: transparent !important;
    color: inherit !important;
    font-family: inherit !important;
    line-height: inherit !important;
    letter-spacing: inherit !important;
  }
  .chapters section.doc font { font-size: inherit !important; }
  .chapters section.doc table { border-color: color-mix(in srgb, currentColor 25%, transparent) !important; }
`;

export const baseChapterCss = (overrideStyles) => `
  :host { display: block; }
  .chapters {
    color: var(--reader-fg, #333);
    font-family: var(--reader-font, sans-serif);
    font-size: var(--reader-font-size, 18px);
    line-height: var(--reader-line-height, 1.8);
    letter-spacing: var(--reader-letter-spacing, 0.02em);
    overflow-wrap: break-word;
    word-break: normal;
    line-break: loose;
    text-align: justify;
    text-justify: inter-ideograph;
  }
  section.doc { padding: 0 0 1em; }
  section.doc:focus { outline: none; }
  section.doc p, section.doc div {
    margin-block-start: var(--reader-para-spacing, 0.9em);
    margin-block-end: var(--reader-para-spacing, 0.9em);
  }
  section.doc h1, section.doc h2, section.doc h3, section.doc h4 {
    line-height: 1.4;
    margin: 1.2em 0 0.6em;
  }
  section.doc img { max-width: 100%; height: auto; }
  section.doc table { max-width: 100%; border-collapse: collapse; }
  section.doc td, section.doc th { padding: 2px 8px; }
  section.doc pre, section.doc code, section.doc tt {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    line-break: auto;
  }
  section.doc pre {
    overflow-x: auto;
    background: color-mix(in srgb, currentColor 7%, transparent);
    padding: 0.7em 1em;
    border-radius: 6px;
  }
  section.doc a { color: var(--reader-link, #2467c6); }
  section.doc hr { border: none; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
  .chapter-divider {
    display: flex; align-items: center; gap: 1em;
    margin: 2.2em 0; color: var(--reader-fg-muted, #999);
    font-size: 0.8em; user-select: none;
  }
  .chapter-divider::before, .chapter-divider::after {
    content: ''; flex: 1;
    border-top: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  }
  /* Sub-frame wrapper: sandboxed iframe for runJs mode. The shim
   * reports its content height via postMessage; the parent sets the
   * wrapper height accordingly. min-height ensures a reasonable default
   * before the first resize message arrives. */
  .subframe {
    width: 100%;
    min-height: 40vh;
  }
  .subframe iframe {
    width: 100%;
    height: 100%;
    min-height: 40vh;
    border: none;
  }
  ${overrideStyles ? LEGACY_OVERRIDES : ''}
`;
