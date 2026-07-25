/**
 * DropZone - File upload area
 */

import { h } from './vdom';
import type { VNodeChild } from './vdom';
import { ICONS } from './icons';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
}

export function DropZone({ onFileSelect }: DropZoneProps): VNodeChild {
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.name.endsWith('.chm')) {
      onFileSelect(file);
    }
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onFileSelect(file);
  };

  return h('div', { 
    class: 'drop-zone',
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: handleDrop
  }, [
    h('div', { class: 'drop-zone-icon', innerHTML: ICONS.uploadCloud }),
    h('h2', { class: 'drop-zone-title' }, ['Drop CHM file here']),
    h('p', { class: 'drop-zone-subtitle' }, ['or']),
    h('label', { class: 'btn btn-primary' }, [
      h('input', {
        type: 'file',
        accept: '.chm',
        style: 'display: none',
        onChange: handleFileInput
      }),
      'Browse Files'
    ])
  ]);
}
