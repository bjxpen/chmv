/**
 * RecentFiles - Recently opened files list
 */

import { h, each, when } from './vdom';
import type { VNodeChild } from './vdom';
import type { RecentFile } from '../types';
import { ICONS } from './icons';
import { formatSize, formatRelativeTime } from '../utils/helpers';

interface RecentFilesProps {
  files: RecentFile[];
  onOpenFile: (file: File) => void;
}

export function RecentFiles({ files }: RecentFilesProps): VNodeChild {
  return when(files.length > 0, h('div', { class: 'recent-files' }, [
    h('h3', { class: 'section-title' }, ['Recent Files']),
    h('div', { class: 'recent-list' }, 
      each(files.slice(0, 10), (file) => RecentFileItem({ file }))
    )
  ]) as VNodeChild);
}

interface RecentFileItemProps {
  file: RecentFile;
}

function RecentFileItem({ file }: RecentFileItemProps): VNodeChild {
  return h('div', { class: 'recent-item' }, [
    h('span', { innerHTML: ICONS.file }),
    h('div', { class: 'recent-info' }, [
      h('span', { class: 'recent-name' }, [file.name]),
      h('span', { class: 'recent-meta' }, [
        formatSize(file.size),
        ' • ',
        formatRelativeTime(file.lastAccessed)
      ])
    ]),
    h('div', { class: 'recent-progress' }, [
      h('div', { 
        class: 'progress-bar',
        style: { width: `${file.completion}%` }
      })
    ])
  ]);
}
