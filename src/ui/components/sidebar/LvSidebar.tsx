import { useMemo, useState } from 'react';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvNode,
  LvSourceKind,
} from '../../contracts/lv-types.ts';
import { LvSearchInput } from '../common/LvSearchInput.tsx';
import { LvTreeNode } from './LvTreeNode.tsx';

export interface LvSidebarProps {
  readonly catalog: ReadonlyArray<LvCatalogRoot>;
  readonly filesById: Readonly<Record<string, LvFileNode>>;
  /**
   * False until the coordinator delivers its first sources snapshot.
   * Drives the "Loading sources…" skeleton so the user doesn't think
   * a freshly-reloaded page has lost their persisted sources.
   */
  readonly sourcesHydrated: boolean;
  readonly selectedIds: ReadonlySet<string>;
  setSelectedIds: (next: (prev: Set<string>) => Set<string>) => void;
  onAddRoot: (sourceType: LvSourceKind) => void;
  onRemoveRoot: (rootId: string) => void;
  onDropFolders?: (names: string[]) => void;
  onGrantPermission?: (id: string) => void;
  onCancelSource?: (id: string) => void;
}

export const LvSidebar = ({
  catalog,
  filesById,
  sourcesHydrated,
  selectedIds,
  setSelectedIds,
  onAddRoot,
  onRemoveRoot,
  onDropFolders,
  onGrantPermission,
  onCancelSource,
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
      .filter((x): x is LvNode => x !== null && (x.type === 'folder' || x.type === 'file'))
      .filter((x): x is LvCatalogRoot => !!(x as LvCatalogRoot).root)
      .map((x) => x as LvCatalogRoot);
  }, [filter, filterCase, filterWord, filterRegex, catalog]);

  const effectiveOpen: Record<string, boolean> = filter.trim()
    ? Object.fromEntries(Object.keys(openFolders).map((k) => [k, true]))
    : openFolders;

  return (
    <aside className="lv-sidebar">
      <div className="lv-sb-cta">
        <button
          type="button"
          className="lv-add-src-btn"
          onClick={() => onAddRoot('local-static')}
          title="Add log source"
        >
          <span className="lv-add-src-plus" aria-hidden="true">＋</span>
          <span>Add source</span>
        </button>
      </div>
      <LvSearchInput
        className="lv-search--block"
        value={filter}
        onChange={setFilter}
        placeholder="Filter files…"
        caseSensitive={filterCase}
        onCaseSensitiveChange={setFilterCase}
        wholeWord={filterWord}
        onWholeWordChange={setFilterWord}
        regex={filterRegex}
        onRegexChange={setFilterRegex}
      />

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
        {!sourcesHydrated && filteredRoots.length === 0 ? (
          <div className="lv-tree-loading" role="status" aria-busy="true">
            <span className="lv-skel lv-skel-tree" />
            <span className="lv-skel lv-skel-tree" />
            <span className="lv-skel lv-skel-tree" />
          </div>
        ) : filteredRoots.length === 0 ? (
          <div className="lv-tree-empty">
            {filter ? `No files match “${filter}”.` : 'No sources yet.'}
          </div>
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
              onGrantPermission={onGrantPermission}
              onCancelSource={onCancelSource}
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
