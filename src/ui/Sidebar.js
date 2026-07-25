/*
 * ui/Sidebar.js — TOC tree + keyword index tabs, declarative.
 *
 * Collapsed branches are not rendered at all, so trees with thousands
 * of nodes stay cheap; the filter works on the data, not the DOM.
 */

'use strict';

import { useMemo, useState, useEffect, useRef } from 'preact/hooks';
import { html } from './html.js';

/* ---------------- tree helpers (pure) ---------------- */

/** ids of every node whose subtree matches `needle`, plus hit ids */
const filterTree = (nodes, needle) => {
  const visible = new Set();
  const hits = new Set();
  const visit = (node) => {
    const childAny = node.children.reduce((acc, c) => visit(c) || acc, false);
    const hit = needle && node.name.toLowerCase().includes(needle);
    if (hit) hits.add(node.id);
    if (hit || childAny) visible.add(node.id);
    return hit || childAny;
  };
  nodes.forEach(visit);
  return { visible, hits };
};

/** path of ancestor ids leading to the node with `local` */
const findPathTo = (nodes, local, trail = []) => {
  if (!local) return null;
  for (const node of nodes) {
    if (node.local && node.local.toLowerCase() === local.toLowerCase()) return [...trail, node.id];
    const found = findPathTo(node.children, local, [...trail, node.id]);
    if (found) return found;
  }
  return null;
};

/* ---------------- components ---------------- */

const TreeNode = ({ node, depth, ctx }) => {
  const { expanded, toggle, onSelect, activeLocal, filter } = ctx;
  if (filter.needle && !filter.visible.has(node.id)) return null;

  const hasKids = node.children.length > 0;
  const isOpen = expanded.has(node.id) || (filter.needle && filter.visible.has(node.id));
  const isActive = node.local && activeLocal && node.local.toLowerCase() === activeLocal.toLowerCase();
  const isHit = filter.hits.has(node.id);

  return html`
    <div class="tree-item">
      <div class="tree-row ${isActive ? 'active' : ''} ${isHit ? 'filter-hit' : ''}"
           style="padding-inline-start:${depth * 14}px"
           ref=${isActive ? ctx.activeRef : null}>
        <span class="tree-caret ${hasKids ? '' : 'leaf'}"
              onClick=${() => hasKids && toggle(node.id)}>
          ${hasKids ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span class="tree-label ${node.local ? 'navigable' : ''}" tabindex="0" title=${node.name}
              onClick=${() => (node.local ? onSelect(node.local) : toggle(node.id))}
              onKeyDown=${(e) => e.key === 'Enter' && (node.local ? onSelect(node.local) : toggle(node.id))}>
          ${node.name}
        </span>
      </div>
      ${hasKids && isOpen && html`
        <div class="tree-children">
          ${node.children.map((c) => html`<${TreeNode} key=${c.id} node=${c} depth=${depth + 1} ctx=${ctx} />`)}
        </div>`}
    </div>`;
};

const TocPanel = ({ tree, activeLocal, filterText, onSelect }) => {
  const [expanded, setExpanded] = useState(() => new Set(tree.map((n) => n.id)));
  const activeRef = useRef(null);

  /* re-seed expansion when a new book's tree arrives */
  useEffect(() => { setExpanded(new Set(tree.map((n) => n.id))); }, [tree]);

  /* auto-expand ancestors of (and scroll to) the active chapter */
  useEffect(() => {
    const trail = findPathTo(tree, activeLocal);
    if (trail) {
      setExpanded((prev) => new Set([...prev, ...trail]));
      /* scroll after the expansion renders */
      requestAnimationFrame(() =>
        activeRef.current?.scrollIntoView({ block: 'nearest' }));
    }
  }, [activeLocal, tree]);

  const needle = filterText.trim().toLowerCase();
  const filter = useMemo(
    () => (needle ? { needle, ...filterTree(tree, needle) } : { needle: '', visible: new Set(), hits: new Set() }),
    [tree, needle],
  );

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (!tree.length) return html`<div class="tree-empty">No table of contents in this file.</div>`;
  const ctx = { expanded, toggle, onSelect, activeLocal, filter, activeRef };
  return html`${tree.map((n) => html`<${TreeNode} key=${n.id} node=${n} depth=${0} ctx=${ctx} />`)}`;
};

const IndexPanel = ({ items, filterText, onSelect }) => {
  const [limit, setLimit] = useState(400);
  const needle = filterText.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? items.filter((it) => it.name.toLowerCase().includes(needle)) : items),
    [items, needle],
  );
  useEffect(() => setLimit(400), [needle, items]);

  if (!filtered.length) {
    return html`<div class="tree-empty">
      ${items.length ? 'No matching keywords.' : 'No keyword index in this file.'}
    </div>`;
  }
  return html`
    ${filtered.slice(0, limit).map((item) => html`
      <div class="index-entry" title=${item.name}
           onClick=${() => item.targets.length === 1 && onSelect(item.targets[0])}>
        ${item.name}
        ${item.targets.length > 1 && html`
          <div class="index-targets">
            ${item.targets.map((t) => html`
              <div class="index-target" onClick=${(e) => { e.stopPropagation(); onSelect(t); }}>
                ${t.split('/').pop()}
              </div>`)}
          </div>`}
      </div>`)}
    ${filtered.length > limit && html`
      <div class="tree-empty">
        <button class="btn" onClick=${() => setLimit(limit + 800)}>
          Show more (${filtered.length - limit} left)
        </button>
      </div>`}`;
};

export const Sidebar = ({ store }) => {
  const [tab, setTab] = useState('toc');
  const [filterText, setFilterText] = useState('');
  const [needle, setNeedle] = useState('');
  const { tocTree, indexList } = store.toc.value;

  /* debounce the filter so big trees don't re-render on every keystroke */
  useEffect(() => {
    const t = setTimeout(() => setNeedle(filterText), 120);
    return () => clearTimeout(t);
  }, [filterText]);

  const onSelect = (local) => {
    store.navigateTo(local);
    if (window.matchMedia('(max-width: 720px)').matches) {
      store.updateSettings({ sidebarHidden: true });
    }
  };

  return html`
    <aside id="sidebar" class="sidebar" aria-label="Navigation sidebar">
      <div class="sidebar-tabs" role="tablist">
        <button class="tab ${tab === 'toc' ? 'active' : ''}" role="tab"
                aria-selected=${tab === 'toc'} onClick=${() => setTab('toc')}>Contents</button>
        <button class="tab ${tab === 'index' ? 'active' : ''}" role="tab"
                aria-selected=${tab === 'index'} onClick=${() => setTab('index')}>Index</button>
      </div>
      <div class="sidebar-search">
        <input class="input" type="search" placeholder="Filter…" autocomplete="off"
               aria-label="Filter navigation entries"
               value=${filterText} onInput=${(e) => setFilterText(e.target.value)} />
      </div>
      <div class="sidebar-panel" role="tabpanel">
        ${tab === 'toc'
          ? html`<${TocPanel} tree=${tocTree} activeLocal=${store.activeTocPath.value}
                              filterText=${needle} onSelect=${onSelect} />`
          : html`<${IndexPanel} items=${indexList} filterText=${needle} onSelect=${onSelect} />`}
      </div>
    </aside>`;
};
