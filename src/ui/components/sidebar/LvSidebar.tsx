import { useMemo, useState } from 'react';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvNode,
  LvSourceKind,
} from '../../contracts/lv-types.ts';
import { LvAddSourceMenu } from './LvAddSourceMenu.tsx';
import { LvTreeNode } from './LvTreeNode.tsx';

export interface LvSidebarProps {
  readonly catalog: ReadonlyArray<LvCatalogRoot>;
  readonly filesById: Readonly<Record<string, LvFileNode>>;
  readonly selectedIds: ReadonlySet<string>;
  setSelectedIds: (next: (prev: Set<string>) => Set<string>) => void;
  onAddRoot: (sourceType: LvSourceKind) => void;
  onRemoveRoot: (rootId: string) => void;
  onDropFolders?: (names: string[]) => void;
}

export const LvSidebar = ({
  catalog,
  filesById,
  selectedIds,
  setSelectedIds,
  onAddRoot,
  onRemoveRoot,
  onDropFolders,
}: LvSidebarProps) => {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    const walkAll = (nodes: ReadonlyArray<LvNode>): void => {
      nodes.forEach((n) => {
        if (n.type === 'folder') {
          o[n.id] = !!n.open;
          walkAll(n.children);
        }
      });
    };
    walkAll(catalog);
    return o;
  });
  const [filter, setFilter] = useState('');
  const [filterCase, setFilterCase] = useState(false);
  const [filterWord, setFilterWord] = useState(false);
  const [filterRegex, setFilterRegex] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const toggleFolder = (id: string) => setOpenFolders((o) => ({ ...o, [id]: !o[id] }));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(() => new Set(Object.keys(filesById)));
  const clearAll = () => setSelectedIds(() => new Set());

  const filteredRoots = useMemo<LvCatalogRoot[]>(() => {
    if (!filter.trim()) return [...catalog];
    let test: (name: string) => boolean;
    try {
      let pattern = filterRegex ? filter : filter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (filterWord) pattern = `\\b(?:${pattern})\\b`;
      const re = new RegExp(pattern, filterCase ? '' : 'i');
      test = (name) => re.test(name);
    } catch {
      const q = filterCase ? filter : filter.toLowerCase();
      test = (name) => (filterCase ? name : name.toLowerCase()).includes(q);
    }
    const walk = (n: LvNode): LvNode | null => {
      if (n.type === 'file') return test(n.name) ? n : null;
      const kids = n.children.map(walk).filter((x): x is LvNode => x !== null);
      if (kids.length === 0) return null;
      return { ...n, children: kids };
    };
    return catalog
      .map((r) => walk(r))
      .filter((x): x is LvCatalogRoot => x !== null && x.type === 'folder' && !!(x as LvCatalogRoot).root)
      .map((x) => x as LvCatalogRoot);
  }, [filter, filterCase, filterWord, filterRegex, catalog]);

  const effectiveOpen: Record<string, boolean> = filter.trim()
    ? Object.fromEntries(Object.keys(openFolders).map((k) => [k, true]))
    : openFolders;

  return (
    <aside className="lv-sidebar">
      <div className="lv-sb-cta">
        <LvAddSourceMenu onPick={(srcType) => onAddRoot(srcType)} primaryLabel="Add source" />
      </div>
      <div className="lv-sb-search">
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={filter}
          placeholder="Filter files…"
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="lv-search-toggles">
          <button
            type="button"
            className={`lv-search-tog${filterCase ? ' is-on' : ''}`}
            onClick={() => setFilterCase((v) => !v)}
            title="Match Case"
            aria-label="Match Case"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <text x="1" y="12" fontSize="9" fontFamily="sans-serif" fontWeight="700" fill="currentColor">A</text>
              <text x="7" y="12" fontSize="7" fontFamily="sans-serif" fontWeight="700" fill="currentColor">a</text>
            </svg>
          </button>
          <button
            type="button"
            className={`lv-search-tog${filterWord ? ' is-on' : ''}`}
            onClick={() => setFilterWord((v) => !v)}
            title="Match Whole Word"
            aria-label="Match Whole Word"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <text x="1" y="11" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="currentColor">ab</text>
              <path d="M1 13 H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`lv-search-tog${filterRegex ? ' is-on' : ''}`}
            onClick={() => setFilterRegex((v) => !v)}
            title="Use Regular Expression"
            aria-label="Regex"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M9 2 V8 M6.4 3.4 L11.6 6.6 M6.4 6.6 L11.6 3.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                fill="none"
              />
              <rect x="2" y="11" width="3" height="3" rx="0.5" fill="currentColor" />
            </svg>
          </button>
        </div>
        {filter && (
          <button type="button" className="lv-clear" onClick={() => setFilter('')} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      <div className="lv-sb-toolbar">
        <button type="button" className="lv-tlink" onClick={selectAll}>
          Select all
        </button>
        <span className="lv-tdot">·</span>
        <button type="button" className="lv-tlink" onClick={clearAll}>
          Clear
        </button>
        <span className="lv-sb-tb-spacer" />
        <span className="lv-sb-count">
          {selectedIds.size}/{Object.keys(filesById).length}
        </span>
      </div>

      <div
        className={`lv-tree${dropActive ? ' is-drop-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          const items = Array.from(e.dataTransfer.items);
          const files = Array.from(e.dataTransfer.files);
          if (!items.length && !files.length) {
            onDropFolders?.([]);
            return;
          }
          const folderNames = items
            .filter((it) => {
              if (it.kind !== 'file') return false;
              const entry = (it as DataTransferItem & {
                webkitGetAsEntry?: () => { isDirectory?: boolean; name?: string } | null;
              }).webkitGetAsEntry?.();
              return !!entry?.isDirectory;
            })
            .map((it) => {
              const entry = (it as DataTransferItem & {
                webkitGetAsEntry?: () => { name?: string } | null;
              }).webkitGetAsEntry?.();
              return entry?.name ?? '';
            })
            .filter(Boolean);
          const names = folderNames.length ? folderNames : files.map((f) => f.name).slice(0, 1);
          onDropFolders?.(names);
        }}
      >
        {filteredRoots.length === 0 ? (
          <div className="lv-tree-empty">No files match “{filter}”.</div>
        ) : (
          filteredRoots.map((root) => (
            <LvTreeNode
              key={root.id}
              node={root}
              depth={0}
              selectedIds={selectedIds}
              openFolders={effectiveOpen}
              toggleSelect={toggleSelect}
              onToggleFolder={toggleFolder}
              onRemoveRoot={onRemoveRoot}
            />
          ))
        )}
        {dropActive && (
          <div className="lv-tree-drop-hint">Drop folder to add to workspace</div>
        )}
      </div>
    </aside>
  );
};
