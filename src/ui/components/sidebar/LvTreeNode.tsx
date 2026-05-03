import type { LvNode } from '../../contracts/lv-types.ts';
import { LvChevron } from './LvChevron.tsx';
import { LvFileIcon } from './LvFileIcon.tsx';
import { LvRootBadge } from './LvRootBadge.tsx';
import { LvSourceIcon } from './LvSourceIcon.tsx';

export interface LvTreeNodeProps {
  readonly node: LvNode;
  readonly depth: number;
  readonly selectedIds: ReadonlySet<string>;
  readonly openFolders: Readonly<Record<string, boolean>>;
  toggleSelect: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onRemoveRoot?: (id: string) => void;
}

const collectFileIds = (node: LvNode, out: string[]): void => {
  if (node.type === 'file') out.push(node.id);
  else node.children.forEach((c) => collectFileIds(c, out));
};

export const LvTreeNode = ({
  node,
  depth,
  selectedIds,
  openFolders,
  toggleSelect,
  onToggleFolder,
  onRemoveRoot,
}: LvTreeNodeProps) => {
  const isFolder = node.type === 'folder';
  const open = isFolder ? !!openFolders[node.id] : false;
  const selected = !isFolder && selectedIds.has(node.id);

  let folderState: 'all' | 'some' | 'none' = 'none';
  if (isFolder) {
    const descendants: string[] = [];
    collectFileIds(node, descendants);
    const total = descendants.length;
    const picked = descendants.filter((id) => selectedIds.has(id)).length;
    folderState = picked === 0 ? 'none' : picked === total ? 'all' : 'some';
  }

  return (
    <>
      <div
        className={`lv-tree-row${selected ? ' is-selected' : ''}${node.type === 'folder' && node.root ? ' is-root' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          if (isFolder) onToggleFolder(node.id);
          else toggleSelect(node.id);
        }}
      >
        <span className="lv-tree-chevron">
          {isFolder ? (
            <LvChevron open={open} />
          ) : (
            <span style={{ width: 10, display: 'inline-block' }} />
          )}
        </span>

        {node.type === 'folder' ? (
          <>
            <span
              className={`lv-folder-ico${node.root ? ` lv-src lv-src-${node.source ?? 'local-static'}` : ''}`}
              aria-hidden="true"
            >
              {node.root ? (
                <LvSourceIcon source={node.source} />
              ) : (
                <svg viewBox="0 0 14 12" width="14" height="12">
                  <path
                    d="M1 2.2 A1 1 0 0 1 2 1.2 H5.2 L6.8 2.6 H12 A1 1 0 0 1 13 3.6 V10 A1 1 0 0 1 12 11 H2 A1 1 0 0 1 1 10 Z"
                    fill="currentColor"
                    opacity={open ? 0.9 : 0.65}
                  />
                </svg>
              )}
            </span>
            <span className="lv-tree-label">{node.name}</span>
            {node.root && <LvRootBadge node={node} />}
            {folderState !== 'none' && (
              <span className={`lv-tree-pick lv-tree-pick-${folderState}`} aria-label="selected">
                {folderState === 'all' ? '●' : '◐'}
              </span>
            )}
            {node.root && onRemoveRoot && (
              <button
                className="lv-root-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRoot(node.id);
                }}
                title="Remove folder from workspace"
                aria-label="Remove folder"
              >
                ✕
              </button>
            )}
          </>
        ) : (
          <>
            <LvFileIcon kind={node.kind} />
            <span className="lv-tree-label">{node.name}</span>
            {node.live && <span className="lv-file-pulse" title="Live" />}
            {node.newCount ? (
              <span className="lv-file-new" title={`${node.newCount} new`}>
                +{node.newCount}
              </span>
            ) : null}
            <span className="lv-tree-meta">{node.count}</span>
            <span
              className={`lv-tree-check${selected ? ' is-on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSelect(node.id);
              }}
              aria-label={selected ? 'Deselect' : 'Select'}
              role="checkbox"
              aria-checked={selected}
            >
              {selected ? (
                <svg viewBox="0 0 10 10" width="10" height="10">
                  <path
                    d="M2 5 L4.3 7.3 L8 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
          </>
        )}
      </div>
      {node.type === 'folder' &&
        open &&
        node.children.map((c) => (
          <LvTreeNode
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedIds={selectedIds}
            openFolders={openFolders}
            toggleSelect={toggleSelect}
            onToggleFolder={onToggleFolder}
            onRemoveRoot={onRemoveRoot}
          />
        ))}
    </>
  );
};
