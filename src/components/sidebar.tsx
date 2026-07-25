import { h, Fragment } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { SitemapNode, filterSitemap } from '../utils/sitemapParser';
import { appState } from '../utils/appState';

interface SidebarProps {
  toc: SitemapNode[];
  index: SitemapNode[];
  currentPath: string | null;
  onNodeSelect: (node: SitemapNode) => void;
}

export function Sidebar({ toc, index, currentPath, onNodeSelect }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'toc' | 'index'>('toc');
  const [query, setQuery] = useState('');
  const [width, setSidebarWidth] = useState(appState.sidebarWidth);
  const splitterRef = useRef<HTMLDivElement>(null);

  const normalizeLocal = (path: string) => {
    return path.replace(/\\/g, '/').toLowerCase();
  };

  const activeLocal = currentPath ? normalizeLocal(currentPath) : null;

  // Track if node contains current path to auto-expand parents
  const treeContainsActive = (node: SitemapNode): boolean => {
    if (!activeLocal) return false;
    if (node.local && normalizeLocal(node.local) === activeLocal) {
      return true;
    }
    if (node.children) {
      return node.children.some(child => treeContainsActive(child));
    }
    return false;
  };

  // Draggable splitter resizing
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.id === 'sidebar-splitter' || target.classList.contains('splitter')) {
        e.preventDefault();
        target.classList.add('dragging');

        const onMouseMove = (moveEvent: MouseEvent) => {
          let newWidth = moveEvent.clientX;
          if (newWidth < 180) newWidth = 180;
          if (newWidth > 600) newWidth = 600;
          setSidebarWidth(newWidth);
          appState.sidebarWidth = newWidth;
        };

        const onMouseUp = () => {
          target.classList.remove('dragging');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          appState.saveSettings();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    };

    const splitter = splitterRef.current;
    splitter?.addEventListener('mousedown', handleMouseDown);
    return () => splitter?.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const filteredToc = filterSitemap(toc, query);
  const filteredIndex = filterSitemap(index, query);

  const activeList = activeTab === 'toc' ? filteredToc : filteredIndex;

  if (!appState.sidebarVisible) {
    return null;
  }

  return (
    <div className="sidebar-panel" style={{ width: `${width}px` }}>
      {/* Tabs */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'toc' ? 'active' : ''}`}
          onClick={() => setActiveTab('toc')}
        >
          Contents
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'index' ? 'active' : ''}`}
          onClick={() => setActiveTab('index')}
        >
          Index
        </button>
      </div>

      {/* Search Filter */}
      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Search titles..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Nested Tree List */}
      <div className="sidebar-content">
        <ul className="tree-list">
          {activeList.map((node, idx) => (
            <TreeNode
              key={idx}
              node={node}
              activeLocal={activeLocal}
              query={query}
              normalizeLocal={normalizeLocal}
              treeContainsActive={treeContainsActive}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </ul>
      </div>

      {/* Resizable Draggable Splitter */}
      <div className="splitter" ref={splitterRef} id="sidebar-splitter" />
    </div>
  );
}

// Sub-component for individual expandable/highlightable tree nodes
interface TreeNodeProps {
  node: SitemapNode;
  activeLocal: string | null;
  query: string;
  normalizeLocal: (path: string) => string;
  treeContainsActive: (node: SitemapNode) => boolean;
  onNodeSelect: (node: SitemapNode) => void;
}

function TreeNode({
  node,
  activeLocal,
  query,
  normalizeLocal,
  treeContainsActive,
  onNodeSelect,
}: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;

  // Default expanded if search query is active or if it contains the currently active path
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (query || treeContainsActive(node)) {
      setExpanded(true);
    }
  }, [query, activeLocal]);

  const isActive = node.local && activeLocal === normalizeLocal(node.local);

  const handleNodeClick = () => {
    onNodeSelect(node);
  };

  const handleToggleClick = (e: MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <li style={{ listStyle: 'none' }}>
      <div className={`tree-node-item ${isActive ? 'active' : ''}`} onClick={handleNodeClick}>
        <span className="tree-toggle" onClick={handleToggleClick}>
          {hasChildren && (
            <svg viewBox="0 0 24 24" style={{ transform: expanded ? 'rotate(90deg)' : '' }}>
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
          )}
        </span>
        <span className="tree-node-text">{node.name}</span>
      </div>

      {hasChildren && (
        <ul className={`tree-node-children ${expanded ? 'expanded' : ''}`}>
          {node.children!.map((child, idx) => (
            <TreeNode
              key={idx}
              node={child}
              activeLocal={activeLocal}
              query={query}
              normalizeLocal={normalizeLocal}
              treeContainsActive={treeContainsActive}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
