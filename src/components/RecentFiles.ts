/**
 * Recent Files Component
 * Displays recently opened files with progress
 */

import { h, VNodeChild } from './Component';
import type { RecentFile } from '../types';
import { ICONS } from './icons';
import { deleteRecentFile } from '../services/storage';

interface RecentFilesProps {
  files: RecentFile[];
  onOpenFile: (file: File) => void;
}

export function RecentFiles(props: RecentFilesProps): VNodeChild {
  const { files } = props;
  
  if (files.length === 0) {
    return null;
  }
  
  return h('div', { class: 'recent-files' }, [
    h('h3', { class: 'recent-files-title' }, 'Recent Files'),
    
    ...files.slice(0, 10).map(file => 
      h('div', {
        class: 'recent-file-item',
        key: file.hash,
        ondblclick: () => props.onOpenFile(file as unknown as File)
      }, [
        h('span', { class: 'recent-file-icon', innerHTML: ICONS.file }),
        
        h('div', { class: 'recent-file-info' }, [
          h('div', { class: 'recent-file-name' }, file.name),
          h('div', { class: 'recent-file-meta' }, [
            formatSize(file.size),
            ' • ',
            formatDate(file.lastAccessed),
            file.completion > 0 ? ` • ${file.completion}% read` : ''
          ])
        ]),
        
        h('button', {
          class: 'btn btn-icon',
          'aria-label': 'Remove from recent',
          onclick: async (e: Event) => {
            e.stopPropagation();
            await deleteRecentFile(file.hash);
          }
        }, [
          h('span', { innerHTML: ICONS.x })
        ])
      ])
    )
  ]);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}
