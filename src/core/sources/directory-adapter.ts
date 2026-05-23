import type { DirectoryLogSource, LogSource } from '../types/log-source.ts';
import { createByteLineSplitter } from './byte-line-splitter.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';
import { walkDirectory } from './walk-directory.ts';

const isDirectorySource = (s: LogSource): s is DirectoryLogSource =>
  s.kind === 'directory';

interface FileTask {
  readonly path: string;
  readonly handle: FileSystemFileHandle;
  /** Resume point inside the file. 0 until the task gets preempted. */
  byteOffset: number;
  /** Last `lineNumber` emitted for this file. Splitter continues from here on resume. */
  lineOffset: number;
  done: boolean;
}

const pickNext = (
  plan: ReadonlyArray<FileTask>,
  hotPaths: ReadonlySet<string>,
): FileTask | null => {
  if (hotPaths.size > 0) {
    for (const t of plan) if (!t.done && hotPaths.has(t.path)) return t;
  }
  for (const t of plan) if (!t.done) return t;
  return null;
};

/**
 * Recursively reads every text-like file under the source root and emits
 * `LogLineFrame` per line tagged with its forward-slash relative path.
 *
 * Walk order is alphabetical, depth-first by default, but the adapter
 * supports focus-driven reordering: `setHotPaths(paths)` jumps the named
 * files to the front of the read plan and preempts the currently-reading
 * file (if any) when it's not in the hot set. Preempted files keep their
 * `byteOffset` and resume cleanly later — CRLF/LF terminators that span
 * the preemption boundary are detected via a one-byte peek.
 *
 * Bad files are logged and skipped so one corrupt entry doesn't kill the
 * whole ingest.
 */
export const createDirectoryAdapter: LogSourceAdapterFactory = (source) => {
  if (!isDirectorySource(source)) {
    throw new Error(
      `createDirectoryAdapter: expected source.kind='directory', got '${source.kind}'`,
    );
  }
  let aborter: AbortController | null = null;
  // External state — survives the lifetime of the adapter, accessible from
  // both setHotPaths (called by coordinator at any time) and the read loop
  // inside `open()`.
  let hotPaths: ReadonlySet<string> = new Set();
  let plan: FileTask[] = [];
  let currentTask: FileTask | null = null;
  let currentPreempt: AbortController | null = null;

  const maybePreempt = (): void => {
    if (!currentTask) return;
    if (hotPaths.has(currentTask.path)) return;
    const anyHotPending = plan.some(
      (t) => !t.done && hotPaths.has(t.path),
    );
    if (anyHotPending) currentPreempt?.abort();
  };

  const readTask = async (
    task: FileTask,
    signal: AbortSignal,
    controller: ReadableStreamDefaultController<LogLineFrame>,
  ): Promise<void> => {
    try {
      const file = await task.handle.getFile();
      let resumeFrom = task.byteOffset;
      // Orphan-LF skip. After a CRLF terminator the splitter records
      // `byteEnd` as the position of `\r`, so `byteOffset = byteEnd + 1`
      // lands on the `\n` half — slicing from there would feed the next
      // splitter a phantom empty line. We DO NOT want to skip when the
      // previous terminator was a plain LF AND the next line happens to
      // start with another `\n` (a genuine empty line) — those two cases
      // look identical if we peek `byteOffset` itself. So peek the byte
      // BEFORE `byteOffset`: `\r` means we're on the LF half of CRLF (skip),
      // anything else means `byteOffset` is already at a real line start.
      if (resumeFrom > 0 && resumeFrom < file.size) {
        const peek = await file.slice(resumeFrom - 1, resumeFrom).arrayBuffer();
        if (peek.byteLength > 0) {
          const prev = new Uint8Array(peek)[0];
          if (prev === 0x0d) resumeFrom += 1;
        }
      }
      if (resumeFrom >= file.size) {
        task.done = true;
        return;
      }
      const reader = file
        .slice(resumeFrom)
        .stream()
        .pipeThrough(
          createByteLineSplitter(task.path, resumeFrom, task.lineOffset),
        )
        .getReader();
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) {
            task.done = true;
            break;
          }
          if (value !== undefined) {
            controller.enqueue(value);
            task.byteOffset = value.byteEnd + 1;
            task.lineOffset = value.lineNumber;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (err) {
      console.warn(
        `[directory-adapter] skipping '${task.path}':`,
        err instanceof Error ? err.message : err,
      );
      task.done = true;
    }
  };

  return {
    source,
    open: async (signal) => {
      aborter = new AbortController();
      const onParentAbort = () => aborter?.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const localSignal = aborter.signal;
      const dir = source.handle;
      const glob = source.glob;

      // Reset plan/state in case this adapter is reused (close + open).
      plan = [];
      currentTask = null;
      currentPreempt = null;

      return new ReadableStream<LogLineFrame>({
        async start(controller) {
          try {
            // Phase 1 — collect the read plan. Walking the directory is just
            // FS metadata, no file content read; cheap. The plan is mutable
            // through the lifetime of the stream so `setHotPaths` can reorder
            // by re-running the picker, not by mutating array order.
            for await (const entry of walkDirectory(dir, {
              glob,
              signal: localSignal,
            })) {
              if (localSignal.aborted) break;
              if (!entry.file) continue;
              plan.push({
                path: entry.file.path,
                handle: entry.file.handle,
                byteOffset: 0,
                lineOffset: 0,
                done: false,
              });
            }

            // Phase 2 — drain the plan, picking hot-tasks first whenever
            // hotPaths is non-empty. Preemption flips currentTask back to
            // not-done with an updated byteOffset, and the loop picks the
            // hot candidate on the next iteration.
            while (!localSignal.aborted) {
              const next = pickNext(plan, hotPaths);
              if (!next) break;
              currentTask = next;
              const preempt = new AbortController();
              currentPreempt = preempt;
              const onLocalAbort = () => preempt.abort();
              if (localSignal.aborted) preempt.abort();
              else localSignal.addEventListener('abort', onLocalAbort, { once: true });
              try {
                await readTask(next, preempt.signal, controller);
              } finally {
                localSignal.removeEventListener('abort', onLocalAbort);
                currentPreempt = null;
                currentTask = null;
              }
            }
            if (!localSignal.aborted) controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
    },
    setHotPaths: (paths) => {
      hotPaths = new Set(paths);
      maybePreempt();
    },
  } satisfies LogSourceAdapter;
};
