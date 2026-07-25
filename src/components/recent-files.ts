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
    h('h3', { class: 'recent-files-title' }, ['Recent Files']),
    h('div', { class: 'recent-list' }, 
      each(files.slice(0, 10), (file) => RecentFileItem({ file }))
    )
  ]) as VNodeChild);
}

interface RecentFileItemProps {
  file: RecentFile;
}

function RecentFileItem({ file }: RecentFileItemProps): VNodeChild {
  return h('div', { class: 'recent-file-item' }, [
    h('span', { class: 'recent-file-icon', innerHTML: ICONS.file }),
    h('div', { class: 'recent-file-info' }, [
      h('span', { class: 'recent-file-name' }, [file.name]),
      h('span', { class: 'recent-file-meta' }, [
        formatSize(file.size),
        ' • ',
        formatRelativeTime(file.lastAccessed)
      ])
    ])
  ]);
}
