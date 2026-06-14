import { useEffect, useState } from 'react';
import { walkDirectory } from '../core/sources/walk-directory.ts';
import type { SourceId, SourceRecord } from '../core/types/index.ts';
import type {
  LvFileNode,
  LvFolderNode,
  LvNode,
} from '../ui/contracts/lv-types.ts';

/**
 * Compound id schema for tree nodes inside a directory source:
 *   `<sourceId>::<relative-path>`        — file inside the directory
 *   `<sourceId>::<relative-path>/`       — sub-folder (trailing slash)
 *   `<sourceId>`                         — the directory source itself (legacy)
 *
 * The container parses `selectedIds` by splitting on the `::` separator —
 * see LvAppContainer §filter useMemo.
 */
const SEP = '::';
const idForFile = (sourceId: SourceId, relPath: string) =>
  `${sourceId}${SEP}${relPath}`;
const idForFolder = (sourceId: SourceId, relPath: string) =>
  `${sourceId}${SEP}${relPath}/`;

const basename = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
};

const dirname = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

const buildTreeFromWalk = async (
  source: Extract<SourceRecord['source'], { kind: 'directory' }>,
  sourceId: SourceId,
  signal: AbortSignal,
): Promise<LvFolderNode> => {
  // Root folder representing the source itself.
  const root: LvFolderNode = {
    id: sourceId,
    type: 'folder',
    name: source.name,
    open: true,
    children: [],
  };
  // path-prefix → folder node lookup. '' is the root.
  const folders = new Map<string, LvFolderNode>();
  folders.set('', root);

  for await (const entry of walkDirectory(source.handle, {
    glob: source.glob,
    signal,
  })) {
    if (signal.aborted) break;
    if (entry.folder) {
      const parent = folders.get(dirname(entry.folder.path)) ?? root;
      const node: LvFolderNode = {
        id: idForFolder(sourceId, entry.folder.path),
        type: 'folder',
        name: entry.folder.name,
        open: false,
        children: [],
      };
      parent.children.push(node);
      folders.set(entry.folder.path, node);
    } else if (entry.file) {
      const parent = folders.get(dirname(entry.file.path)) ?? root;
      const node: LvFileNode = {
        id: idForFile(sourceId, entry.file.path),
        type: 'file',
        name: basename(entry.file.path),
        kind: 'app',
      };
      (parent.children as LvNode[]).push(node);
    }
  }
  return root;
};

export interface UseDirectoryTrees {
  /** sourceId → root LvFolderNode (with `id === sourceId`). */
  readonly trees: Readonly<Record<string, LvFolderNode>>;
}

/**
 * Walks every persisted directory source's handle and returns its file tree
 * as `LvFolderNode`s for the sidebar. Walks are async and fire-and-forget;
 * each tree pops into `trees` once its walk completes. Invalidates a tree
 * when the source disappears or the source's handle reference changes.
 *
 * Permission-required and errored sources are skipped — UI shows the
 * source-level chip without children, and the user can grant access via
 * the inline button.
 */
export const useDirectoryTrees = (
  sources: ReadonlyArray<SourceRecord>,
): UseDirectoryTrees => {
  const [trees, setTrees] = useState<Record<string, LvFolderNode>>({});

  // Live directory sources — recomputed each render but cheap (small N).
  const liveDirSources = sources.filter(
    (r) =>
      r.source.kind === 'directory' &&
      r.status.kind !== 'permission-required' &&
      r.status.kind !== 'error',
  );

  // Derived-state pruning: drop cached trees whose source is gone. We compare
  // signatures (sorted live source-ids) and only run the prune when the set
  // changes — avoids a setState-in-effect for what is fundamentally a
  // dependency on `sources`.
  const liveSig = liveDirSources
    .map((r) => r.source.id)
    .sort()
    .join('|');
  const [prevLiveSig, setPrevLiveSig] = useState('');
  if (liveSig !== prevLiveSig) {
    setPrevLiveSig(liveSig);
    setTrees((prev) => {
      let drop = false;
      for (const id of Object.keys(prev)) {
        if (!liveDirSources.some((r) => r.source.id === id)) {
          drop = true;
          break;
        }
      }
      if (!drop) return prev;
      const next: Record<string, LvFolderNode> = {};
      for (const r of liveDirSources) {
        if (prev[r.source.id]) next[r.source.id] = prev[r.source.id]!;
      }
      return next;
    });
  }

  useEffect(() => {
    const abort = new AbortController();
    // Spawn walks for sources that don't have a tree yet. setState in the
    // .then() is fine — it's an async callback, not a synchronous effect
    // body.
    for (const r of liveDirSources) {
      const sourceId = r.source.id;
      if (trees[sourceId]) continue;
      const dirSource = r.source as Extract<
        SourceRecord['source'],
        { kind: 'directory' }
      >;
      void buildTreeFromWalk(dirSource, sourceId, abort.signal)
        .then((tree) => {
          if (abort.signal.aborted) return;
          setTrees((prev) => ({ ...prev, [sourceId]: tree }));
        })
        .catch((err: unknown) => {
          if (abort.signal.aborted) return;
          console.warn(
            `[useDirectoryTrees] walk failed for ${sourceId}:`,
            err instanceof Error ? err.message : err,
          );
        });
    }
    return () => {
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only walk on the source list
  }, [liveSig]);

  return { trees };
};
