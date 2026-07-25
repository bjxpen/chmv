/**
 * SettingsPanel - Typography and theme settings
 */

import { h, each } from './vdom';
import type { VNodeChild } from './vdom';
import type { AppState, ThemeId, EncodingType, FontFamily, ContainerWidth } from '../types';
import { THEMES, ENCODING_OPTIONS } from '../types';
import { ICONS } from './icons';
import { store } from '../core/store';
import { reader, typography } from '../core/actions';

interface SettingsPanelProps {
  state: AppState;
}

export function SettingsPanel({ state }: SettingsPanelProps): VNodeChild {
  const { reader: readerState } = state;
  const { themeId, encoding, typography: typo, sidebarVisible } = readerState;

  if (!sidebarVisible) return null;

  return h('div', { class: 'settings-panel' }, [
    h('div', { class: 'settings-header' }, [
      h('h3', {}, ['Settings']),
      h('button', { class: 'icon-btn', innerHTML: ICONS.x, onClick: () => store.dispatch(reader.toggleSidebar(false)) })
    ]),
    h('div', { class: 'settings-content' }, [
      // Encoding
      h('section', { class: 'settings-section' }, [
        h('h4', {}, ['Encoding']),
        h('div', { class: 'setting-row' }, [
          h('select', {
            class: 'setting-select',
            value: encoding,
            onChange: (e: Event) => store.dispatch(reader.setEncoding((e.target as HTMLSelectElement).value as EncodingType))
          }, 
            each(ENCODING_OPTIONS, (opt) => h('option', { value: opt.id }, [opt.nativeLabel]))
          )
        ])
      ]),
      
      // Theme
      h('section', { class: 'settings-section' }, [
        h('h4', {}, ['Theme']),
        h('div', { class: 'theme-grid' }, 
          each(Object.values(THEMES), (theme) => h('button', {
            class: `theme-btn ${theme.id === themeId ? 'active' : ''}`,
            style: { background: theme.background, color: theme.text },
            onClick: () => store.dispatch(reader.setTheme(theme.id as ThemeId))
          }, [theme.name]))
        )
      ]),
      
      // Typography
      h('section', { class: 'settings-section' }, [
        h('h4', {}, ['Typography']),
        h('div', { class: 'setting-row' }, [
          h('label', {}, ['Font Size']),
          h('input', {
            type: 'range',
            min: '10',
            max: '32',
            value: String(typo.fontSize),
            onInput: (e: Event) => store.dispatch(typography.fontSize(Number((e.target as HTMLInputElement).value)))
          }),
          h('span', { class: 'setting-value' }, [`${typo.fontSize}px`])
        ]),
        h('div', { class: 'setting-row' }, [
          h('label', {}, ['Line Height']),
          h('input', {
            type: 'range',
            min: '1',
            max: '3',
            step: '0.1',
            value: String(typo.lineHeight),
            onInput: (e: Event) => store.dispatch(typography.lineHeight(Number((e.target as HTMLInputElement).value)))
          }),
          h('span', { class: 'setting-value' }, [String(typo.lineHeight)])
        ]),
        h('div', { class: 'setting-row' }, [
          h('label', {}, ['Font Family']),
          h('select', {
            value: typo.fontFamily,
            onChange: (e: Event) => store.dispatch(typography.fontFamily((e.target as HTMLSelectElement).value as FontFamily))
          }, [
            h('option', { value: 'serif' }, ['Serif']),
            h('option', { value: 'sans-serif' }, ['Sans-Serif']),
            h('option', { value: 'kai-ti' }, ['KaiTi'])
          ])
        ]),
        h('div', { class: 'setting-row' }, [
          h('label', {}, ['Container Width']),
          h('select', {
            value: String(typo.containerWidth),
            onChange: (e: Event) => store.dispatch(typography.containerWidth((e.target as HTMLSelectElement).value as unknown as ContainerWidth))
          }, [
            h('option', { value: '600' }, ['600px']),
            h('option', { value: '800' }, ['800px']),
            h('option', { value: '1000' }, ['1000px']),
            h('option', { value: 'fluid' }, ['Fluid'])
          ])
        ])
      ])
    ])
  ]);
}
