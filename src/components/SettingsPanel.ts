/**
 * Settings Panel Component
 * Typography, theme, and reading settings
 */

import { h, VNodeChild } from './Component';
import type { AppState, ThemeId, FontFamily, ContainerWidth } from '../types';
import { THEMES } from '../types';
import { store, actions } from '../stores/appStore';
import { ICONS } from './icons';

interface SettingsPanelProps {
  state: AppState;
  onClose: () => void;
}

export function SettingsPanel(props: SettingsPanelProps): VNodeChild {
  const { state, onClose } = props;
  const { reader } = state;
  const { typography, themeId, legacyStylesStripped } = reader;
  
  return h('div', { class: 'settings-panel open' }, [
    // Header
    h('div', { class: 'settings-header' }, [
      h('h2', { class: 'settings-title' }, 'Settings'),
      h('button', {
        class: 'btn btn-icon',
        onclick: onClose,
        'aria-label': 'Close settings'
      }, [
        h('span', { innerHTML: ICONS.x })
      ])
    ]),
    
    // Content
    h('div', { class: 'settings-content' }, [
      // Theme section
      h('div', { class: 'settings-section' }, [
        h('h3', { class: 'settings-section-title' }, 'Theme'),
        h('div', { class: 'theme-grid' },
          Object.values(THEMES).map(theme =>
            h('div', {
              class: `theme-option ${themeId === theme.id ? 'active' : ''}`,
              onclick: () => store.dispatch(actions.setTheme(theme.id as ThemeId)),
              role: 'button'
            }, [
              h('div', {
                class: 'theme-preview',
                style: `background: ${theme.background}; border: 1px solid ${theme.border};`
              }),
              h('span', { class: 'theme-name' }, theme.name)
            ])
          )
        )
      ]),
      
      // Typography section
      h('div', { class: 'settings-section' }, [
        h('h3', { class: 'settings-section-title' }, 'Typography'),
        
        // Font size
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Font Size'),
          h('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
            h('button', {
              class: 'btn btn-icon',
              onclick: () => store.dispatch(actions.setFontSize(typography.fontSize - 1)),
              disabled: typography.fontSize <= 10 ? true : undefined
            }, '-'),
            h('span', { style: 'min-width: 40px; text-align: center;' }, `${typography.fontSize}px`),
            h('button', {
              class: 'btn btn-icon',
              onclick: () => store.dispatch(actions.setFontSize(typography.fontSize + 1)),
              disabled: typography.fontSize >= 32 ? true : undefined
            }, '+')
          ])
        ]),
        
        // Line height
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Line Height'),
          h('input', {
            type: 'range',
            class: 'settings-slider',
            min: '1',
            max: '3',
            step: '0.1',
            value: typography.lineHeight,
            oninput: (e: Event) => {
              const value = parseFloat((e.target as HTMLInputElement).value);
              store.dispatch(actions.setLineHeight(value));
            }
          }),
          h('span', { style: 'min-width: 40px;' }, typography.lineHeight.toFixed(1))
        ]),
        
        // Letter spacing
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Letter Spacing'),
          h('input', {
            type: 'range',
            class: 'settings-slider',
            min: '-0.1',
            max: '0.5',
            step: '0.05',
            value: typography.letterSpacing,
            oninput: (e: Event) => {
              const value = parseFloat((e.target as HTMLInputElement).value);
              store.dispatch(actions.setLetterSpacing(value));
            }
          }),
          h('span', { style: 'min-width: 40px;' }, `${typography.letterSpacing}em`)
        ]),
        
        // Paragraph spacing
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Paragraph Spacing'),
          h('input', {
            type: 'range',
            class: 'settings-slider',
            min: '0.5',
            max: '3',
            step: '0.1',
            value: typography.paragraphSpacing,
            oninput: (e: Event) => {
              const value = parseFloat((e.target as HTMLInputElement).value);
              store.dispatch(actions.setParagraphSpacing(value));
            }
          }),
          h('span', { style: 'min-width: 40px;' }, `${typography.paragraphSpacing.toFixed(1)}em`)
        ]),
        
        // Font family
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Font Family'),
          h('select', {
            class: 'settings-select',
            value: typography.fontFamily,
            onchange: (e: Event) => {
              const value = (e.target as HTMLSelectElement).value as FontFamily;
              store.dispatch(actions.setFontFamily(value));
            }
          }, [
            h('option', { value: 'sans-serif', selected: typography.fontFamily === 'sans-serif' ? true : undefined }, 'Sans-serif'),
            h('option', { value: 'serif', selected: typography.fontFamily === 'serif' ? true : undefined }, 'Serif'),
            h('option', { value: 'kai-ti', selected: typography.fontFamily === 'kai-ti' ? true : undefined }, 'CJK Calligraphic')
          ])
        ]),
        
        // Container width
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Container Width'),
          h('select', {
            class: 'settings-select',
            value: String(typography.containerWidth),
            onchange: (e: Event) => {
              const value = (e.target as HTMLSelectElement).value;
              store.dispatch(actions.setContainerWidth(value === 'fluid' ? 'fluid' : parseInt(value) as ContainerWidth));
            }
          }, [
            h('option', { value: '600', selected: typography.containerWidth === 600 ? true : undefined }, '600px'),
            h('option', { value: '800', selected: typography.containerWidth === 800 ? true : undefined }, '800px'),
            h('option', { value: '1000', selected: typography.containerWidth === 1000 ? true : undefined }, '1000px'),
            h('option', { value: 'fluid', selected: typography.containerWidth === 'fluid' ? true : undefined }, 'Fluid')
          ])
        ])
      ]),
      
      // Content section
      h('div', { class: 'settings-section' }, [
        h('h3', { class: 'settings-section-title' }, 'Content'),
        
        // Strip legacy styles
        h('div', { class: 'settings-row' }, [
          h('span', { class: 'settings-label' }, 'Strip Legacy Styles'),
          h('button', {
            class: legacyStylesStripped ? 'btn btn-primary' : 'btn btn-secondary',
            onclick: () => store.dispatch(actions.setLegacyStylesStripped(!legacyStylesStripped))
          }, legacyStylesStripped ? 'On' : 'Off')
        ])
      ]),
      
      // Keyboard shortcuts
      h('div', { class: 'settings-section' }, [
        h('h3', { class: 'settings-section-title' }, 'Keyboard Shortcuts'),
        ...renderShortcuts()
      ])
    ])
  ]);
}

function renderShortcuts(): VNodeChild[] {
  const shortcuts = [
    { key: 'J / ←', action: 'Previous chapter' },
    { key: 'K / →', action: 'Next chapter' },
    { key: 'B', action: 'Toggle sidebar' },
    { key: 'Ctrl + +', action: 'Increase font size' },
    { key: 'Ctrl + -', action: 'Decrease font size' },
    { key: '/', action: 'Focus search' },
    { key: 'Esc', action: 'Clear search / Close dialogs' }
  ];
  
  return shortcuts.map(shortcut =>
    h('div', { class: 'shortcut-row' }, [
      h('span', { class: 'shortcut-key' }, shortcut.key),
      h('span', {}, shortcut.action)
    ])
  );
}
