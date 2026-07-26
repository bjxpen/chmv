/*
 * services/settings.js — typography / theme preferences as a reactive
 * signal, persisted to localStorage and mirrored into CSS custom
 * properties declaratively (one effect, no imperative call sites).
 */

'use strict';

import { signal, effect } from '@preact/signals';

const KEY = 'chmv:settings';

export const THEMES = [
  { id: 'light', label: 'Clean Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Warm Dark' },
  { id: 'oled', label: 'OLED Black' },
];

export const FONTS = [
  { id: 'sans', label: '黑体 / Sans', stack: `-apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif` },
  { id: 'serif', label: '宋体 / Serif', stack: `Georgia, "Times New Roman", "Songti SC", SimSun, "Noto Serif CJK SC", "Source Han Serif SC", serif` },
  { id: 'kai', label: '楷体 / Kai', stack: `"Kaiti SC", KaiTi, "AR PL UKai CN", "TW-Kai", cursive, serif` },
  { id: 'mono', label: 'Monospace', stack: `ui-monospace, SFMono-Regular, Consolas, "Sarasa Mono SC", monospace` },
];

export const WIDTHS = [
  { id: '600', label: '600px', css: '600px' },
  { id: '800', label: '800px', css: '800px' },
  { id: '1000', label: '1000px', css: '1000px' },
  { id: 'full', label: 'Full', css: '100%' },
];

export const DEFAULT_SETTINGS = {
  theme: 'light',
  font: 'sans',
  width: '800',
  fontSize: 19,          /* px */
  lineHeight: 1.9,
  letterSpacing: 0.02,   /* em */
  paraSpacing: 0.9,      /* em */
  overrideStyles: false,
  runJs: false,
  scrollMode: 'paged',   /* 'paged' | 'infinite' */
  sidebarWidth: 300,
  sidebarHidden: false,
};

const load = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

/** The single source of truth. Update via `updateSettings(patch)`. */
export const settings = signal(load());

export const updateSettings = (patch) => {
  settings.value = { ...settings.value, ...patch };
};

export const clampFontSize = (px) => Math.min(34, Math.max(12, px));

/* persist + project to CSS custom properties whenever settings change */
if (typeof document !== 'undefined') {
  effect(() => {
    const s = settings.value;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }

    const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
    const width = WIDTHS.find((w) => w.id === s.width) ?? WIDTHS[1];
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    for (const [prop, value] of Object.entries({
      '--reader-font': font.stack,
      '--reader-font-size': `${s.fontSize}px`,
      '--reader-line-height': String(s.lineHeight),
      '--reader-letter-spacing': `${s.letterSpacing}em`,
      '--reader-para-spacing': `${s.paraSpacing}em`,
      '--reader-measure': width.css,
      '--sidebar-width': `${s.sidebarWidth}px`,
    })) root.style.setProperty(prop, value);
  });
}