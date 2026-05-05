/**
 * Shared recursive walk over a `FileSystemDirectoryHandle`. Used by:
 *   - the directory adapter (to feed lines into the ingest pipeline), and
 *   - the UI's `useDirectoryTrees` hook (to render the folder structure).
 *
 * The walk is depth-first, alphabetical, and skips entries whose name doesn't
 * pass the file matcher. `relativePath` is forward-slash separated and never
 * includes a leading slash; the directory root itself is the empty string.
 */

const DEFAULT_FILE_EXT_RE = /\.(log|jsonl|ndjson|txt|out|err)$/i;

const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

export const matchFile = (name: string, glob?: string): boolean =>
  glob ? globToRegex(glob).test(name) : DEFAULT_FILE_EXT_RE.test(name);

export interface WalkedFile {
  /** Forward-slash relative path from the walk root (no leading slash). */
  readonly path: string;
  readonly handle: FileSystemFileHandle;
}

export interface WalkedFolder {
  readonly path: string;
  readonly name: string;
}

export interface WalkedEntry {
  readonly file?: WalkedFile;
  readonly folder?: WalkedFolder;
}

interface WalkOptions {
  readonly glob?: string;
  /** Aborts mid-walk; the async iterator stops after the next entry. */
  readonly signal?: AbortSignal;
}

/**
 * Yields every matching file and every visited folder in stable order. Folders
 * are emitted before their contents so consumers can build a tree top-down.
 */
export async function* walkDirectory(
  root: FileSystemDirectoryHandle,
  options: WalkOptions = {},
): AsyncGenerator<WalkedEntry, void, void> {
  yield* walk(root, '', options);
}

async function* walk(
  handle: FileSystemDirectoryHandle,
  prefix: string,
  options: WalkOptions,
): AsyncGenerator<WalkedEntry, void, void> {
  // Collect-then-sort so the output is deterministic across browsers.
  const entries: FileSystemHandle[] = [];
  for await (const e of handle.values()) entries.push(e);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (options.signal?.aborted) return;
    const path = prefix + entry.name;
    if (entry.kind === 'directory') {
      yield { folder: { path, name: entry.name } };
      yield* walk(entry as FileSystemDirectoryHandle, path + '/', options);
    } else if (entry.kind === 'file' && matchFile(entry.name, options.glob)) {
      yield { file: { path, handle: entry as FileSystemFileHandle } };
    }
  }
}
