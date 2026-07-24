/**
 * DropZone Component
 * File drag-and-drop area and file picker
 */

import { h, VNodeChild } from './Component';
import { ICONS } from './icons';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
}

export function DropZone(props: DropZoneProps): VNodeChild {
  let isDragging = false;
  
  return h('div', {
    class: 'drop-zone',
    style: 'margin-bottom: 24px;',
    ondragover: (e: DragEvent) => {
      e.preventDefault();
      isDragging = true;
    },
    ondragleave: (e: DragEvent) => {
      e.preventDefault();
      isDragging = false;
    },
    ondrop: (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (isCHMFile(file)) {
          props.onFileSelect(file);
        }
      }
      isDragging = false;
    }
  }, [
    h('div', { class: 'drop-zone-icon', innerHTML: ICONS.uploadCloud }),
    
    h('h2', { class: 'drop-zone-title' }, 'Drop a CHM file here'),
    
    h('p', { class: 'drop-zone-subtitle' }, [
      'or click the button below to select a file',
      h('br', {}),
      'Supports legacy CJK encodings and modern CHM formats'
    ]),
    
    h('input', {
      type: 'file',
      accept: '.chm',
      style: 'display: none',
      onchange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file && isCHMFile(file)) {
          props.onFileSelect(file);
        }
        input.value = '';
      }
    }),
    
    h('button', {
      class: 'btn btn-primary',
      onclick: (e: Event) => {
        const input = (e.target as HTMLElement).parentElement?.querySelector('input[type="file"]') as HTMLInputElement;
        input?.click();
      }
    }, [
      h('span', { innerHTML: ICONS.file }),
      'Select CHM File'
    ])
  ]);
}

function isCHMFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.chm') || 
         file.type === 'application/x-chm' ||
         file.type === 'application/mshelp';
}
