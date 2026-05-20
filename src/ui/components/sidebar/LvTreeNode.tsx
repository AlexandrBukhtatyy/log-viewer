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
  /**
   * Open the file as a pinned tab. Fires on row click; the checkbox
   * column on the right edge handles selection independently. Folders
   * ignore this callback (they only expand/collapse).
   */
  onOpenFile: (sourceId: string) => void;
  /**
   * Toggle a folder's open state. Receives the current effective `open`
   * value (after applying the `openFolders[id] ?? !!node.open` fallback)
   * so the parent flips it without re-deriving — important for newly-
   * arrived folders that aren't in `openFolders` yet.
   */
  onToggleFolder: (id: string, currentOpen: boolean) => void;
  onRemoveRoot?: (id: string) => void;
  /** Click handler for the "Grant access" button on permission-required files. */
  onGrantPermission?: (id: string) => void;
  /** Click handler for the in-flight "Cancel" button. */
  onCancelSource?: (id: string) => void;
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
  onOpenFile,
  onToggleFolder,
  onRemoveRoot,
  onGrantPermission,
  onCancelSource,
}: LvTreeNodeProps) => {
  const isFolder = node.type === 'folder';
  // Fall back to the node's own `open` flag when the user hasn't
  // toggled this folder yet. Directory roots default to `open: true`;
  // without the fallback the first click would have no visible effect
  // because the state map starts empty.
  const open = isFolder
    ? (openFolders[node.id] ?? !!(node as { open?: boolean }).open)
    : false;
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
        className={`lv-tree-row${selected ? ' is-selected' : ''}${node.root ? ' is-root' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          if (isFolder) {
            onToggleFolder(node.id, open);
          } else {
            onOpenFile(node.id);
          }
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
              className={`lv-folder-ico${
                node.root
                  ? ` lv-src lv-src-${node.source ?? 'local-static'}`
                  : ''
              }`}
              aria-hidden="true"
            >
              {node.root ? (
                // Catalog top-level — outlined source-specific glyph.
                <LvSourceIcon source={node.source} />
              ) : (
                // Everything inside — solid generic folder, regardless of
                // whether it's an external source root (`sourceKind`) or an
                // internal sub-folder. The user reads "outlined = top of
                // the tree", "filled = inside the tree".
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
            {node.live && (
              <span
                className="lv-spinner"
                title={node.progressTitle ?? 'Ingesting…'}
                aria-label={node.progressTitle ?? 'Ingesting'}
              />
            )}
            {node.progressLabel && (
              <span
                className="lv-tree-progress"
                title={node.progressTitle ?? node.progressLabel}
              >
                {node.progressLabel}
              </span>
            )}
            {node.root && <LvRootBadge node={node} />}
            {node.root && node.parserId && (
              <span
                className="lv-tree-parser-badge"
                title={`Parser: ${node.parserId}`}
              >
                {node.parserId}
              </span>
            )}
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
            {node.root ? (
              // File-source catalog root — outlined source-specific glyph,
              // matching folder roots. Single-file sources (file/text/url/…)
              // sit at the top of the tree and read as "the source itself".
              <span
                className={`lv-folder-ico lv-src lv-src-${node.source ?? 'local-static'}`}
                aria-hidden="true"
              >
                <LvSourceIcon source={node.source} />
              </span>
            ) : (
              <LvFileIcon kind={node.kind} />
            )}
            <span className="lv-tree-label">{node.name}</span>
            {node.live && (
              <span
                className="lv-spinner"
                title={node.progressTitle ?? 'Ingesting…'}
                aria-label={node.progressTitle ?? 'Ingesting'}
              />
            )}
            {node.progressLabel && (
              <span
                className="lv-tree-progress"
                title={node.progressTitle ?? node.progressLabel}
              >
                {node.progressLabel}
              </span>
            )}
            {!node.progressLabel && node.newCount ? (
              <span className="lv-file-new" title={`${node.newCount} new`}>
                +{node.newCount}
              </span>
            ) : null}
            {node.live && onCancelSource && (
              <button
                type="button"
                className="lv-cancel-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelSource(node.id);
                }}
                title="Cancel ingest (already-indexed entries are kept)"
                aria-label="Cancel ingest"
              >
                ✕
              </button>
            )}
            {node.needsPermission && onGrantPermission && (
              <button
                type="button"
                className="lv-grant-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onGrantPermission(node.id);
                }}
                title="Re-grant read access for this folder"
              >
                Grant access
              </button>
            )}
            {node.errorMessage && (
              <span className="lv-tree-error" title={node.errorMessage}>
                ⚠
              </span>
            )}
            {node.root && <LvRootBadge node={node} />}
            {node.root && node.parserId && (
              <span
                className="lv-tree-parser-badge"
                title={`Parser: ${node.parserId}`}
              >
                {node.parserId}
              </span>
            )}
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
            {node.root && onRemoveRoot && (
              <button
                className="lv-root-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRoot(node.id);
                }}
                title="Remove source from workspace"
                aria-label="Remove source"
              >
                ✕
              </button>
            )}
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
            onOpenFile={onOpenFile}
            onToggleFolder={onToggleFolder}
            onRemoveRoot={onRemoveRoot}
            onGrantPermission={onGrantPermission}
            onCancelSource={onCancelSource}
          />
        ))}
    </>
  );
};
