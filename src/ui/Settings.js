/*
 * ui/Settings.js — reading settings popover (theme / typography / modes).
 */

'use strict';

import { useEffect } from 'preact/hooks';
import { html } from './html.js';
import { THEMES, FONTS, WIDTHS } from '../services/settings.js';

const SegRow = ({ options, current, onPick, label }) => html`
  <div class="seg-row" role="radiogroup" aria-label=${label}>
    ${options.map((opt) => html`
      <button class="seg-btn" type="button" role="radio"
              aria-checked=${opt.id === current}
              onClick=${() => onPick(opt.id)}>${opt.label}</button>`)}
  </div>`;

const Slider = ({ label, value, format, onInput, ...range }) => html`
  <label>${label} <span class="set-val">${format(value)}</span>
    <input type="range" value=${value} onInput=${(e) => onInput(Number(e.target.value))} ...${range} />
  </label>`;

const Check = ({ checked, onChange, title, hint }) => html`
  <label class="check-row">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span>${title}<br /><small>${hint}</small></span>
  </label>`;

export const SettingsPanel = ({ store, onClose }) => {
  const s = store.settings.value;
  const set = (patch) => store.updateSettings(patch);

  /* click-outside / Escape to close */
  useEffect(() => {
    const away = () => onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  return html`
    <div class="settings-panel" role="dialog" aria-label="Reading settings"
         onClick=${(e) => e.stopPropagation()}>
      <div class="set-group">
        <div class="set-title">Theme</div>
        <${SegRow} options=${THEMES} current=${s.theme} label="Color theme"
                   onPick=${(theme) => set({ theme })} />
      </div>
      <div class="set-group">
        <div class="set-title">Font family</div>
        <${SegRow} options=${FONTS} current=${s.font} label="Font family"
                   onPick=${(font) => set({ font })} />
      </div>
      <div class="set-group">
        <div class="set-title">Content width</div>
        <${SegRow} options=${WIDTHS} current=${s.width} label="Content width"
                   onPick=${(width) => set({ width })} />
      </div>
      <div class="set-group sliders">
        <${Slider} label="Font size" min="12" max="34" step="1"
                   value=${s.fontSize} format=${(v) => `${v}px`}
                   onInput=${(fontSize) => set({ fontSize })} />
        <${Slider} label="Line height" min="1.3" max="2.6" step="0.05"
                   value=${s.lineHeight} format=${(v) => v.toFixed(2)}
                   onInput=${(lineHeight) => set({ lineHeight })} />
        <${Slider} label="Letter spacing" min="0" max="0.12" step="0.005"
                   value=${s.letterSpacing} format=${(v) => `${v.toFixed(3)}em`}
                   onInput=${(letterSpacing) => set({ letterSpacing })} />
        <${Slider} label="Paragraph spacing" min="0.2" max="2.2" step="0.05"
                   value=${s.paraSpacing} format=${(v) => `${v.toFixed(2)}em`}
                   onInput=${(paraSpacing) => set({ paraSpacing })} />
      </div>
      <div class="set-group">
        <${Check} checked=${s.overrideStyles}
                  onChange=${(overrideStyles) => set({ overrideStyles })}
                  title="Override legacy page styles"
                  hint="Strip hardcoded colors & fonts from vintage HTML" />
        <${Check} checked=${s.scrollMode === 'infinite'}
                  onChange=${(on) => set({ scrollMode: on ? 'infinite' : 'paged' })}
                  title="Continuous scroll"
                  hint="Load next chapters automatically while scrolling" />
      </div>
      <div class="set-group set-hints">
        <div class="set-title">Keyboard</div>
        <small>← / → or J / K — chapters · Space / Shift+Space — page ·
               B — sidebar · F — focus mode · Ctrl +/− — font size</small>
      </div>
    </div>`;
};
