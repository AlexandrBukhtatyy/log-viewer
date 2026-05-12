import type { LogEntry, LogLevel } from '../types/log-entry.ts';
import { normalizeLevel } from './lib/level.ts';
import { parseTimestamp } from './lib/time.ts';
import { defineMultilineParser } from './lib/multiline.ts';

/**
 * Plain-text application log: `[timestamp] LEVEL message`. This is
 * the de-facto «human-readable» format most apps drop into stderr
 * by default. Trailing continuation lines (Python/Java stacktraces)
 * accumulate into the same entry — that's the whole reason this
 * parser uses `defineMultilineParser` instead of `defineRegexParser`.
 *
 * Example block:
 *   [2026-05-06T14:00:18.856Z] ERROR Traceback (most recent call last):
 *     File "/app/handlers.py", line 181, in handle_request
 *       result = process(payload)
 *   ConnectionError: upstream timeout
 *
 * Continuation rules (covers ~95% of stacktraces in the wild):
 *   - Python: lines starting with `  File "..."` or pure indent (`    ...`)
 *   - JVM:    lines starting with `\tat ...` or `\t...`
 *   - JVM:    `Caused by:` / `... N more` (no leading whitespace, but
 *             keyword-anchored)
 *   - Plain:  any line with leading whitespace (indented continuation)
 */

const OPEN_LINE_RE =
  /^\[([^\]]+)\]\s+([A-Za-z]+)\s+(.*)$/;

// Continuation pattern — matched on each subsequent line. Anything
// matching this gets appended to the open record's `stack` array.
const CONTINUATION_RE =
  /^(?:\s+|Caused by:|\.\.\.|java\.|com\.|org\.|io\.)/;

const isStackFrame = (line: string): boolean =>
  line.startsWith(' ') ||
  line.startsWith('\t') ||
  line.startsWith('Caused by:') ||
  line.startsWith('...') ||
  // Bare exception class at end of Python tracebacks (e.g.
  // `ConnectionError: upstream timeout`) — a line that follows a
  // continuation and looks like `Type: message`.
  /^[A-Z][\w.]*(Error|Exception):/.test(line);

export const appTextParser = defineMultilineParser({
  id: 'app-text',
  isOpen: (line) => OPEN_LINE_RE.test(line),
  continuationPattern: CONTINUATION_RE,
  parseBlock: (lines, rawBlock, ctx) => {
    const openLine = lines[0]!;
    const m = OPEN_LINE_RE.exec(openLine);
    if (m === null) {
      return { entry: null, confidence: 0 };
    }
    const [, tsRaw, levelRaw, message] = m;
    const timestamp = parseTimestamp(tsRaw);
    const level: LogLevel = normalizeLevel(levelRaw);

    const fields: Record<string, unknown> = {};
    if (lines.length > 1) {
      const stack = lines.slice(1).filter(isStackFrame);
      if (stack.length > 0) {
        fields.stack = stack;
        // Best-effort exception extraction from the last "Type: msg"
        // line — both Python (`ConnectionError: foo`) and JVM
        // (`java.lang.RuntimeException: foo`) put it there.
        const last = stack[stack.length - 1];
        const exMatch = /^([\w.]+(?:Error|Exception)):\s*(.*)$/.exec(last ?? '');
        if (exMatch) {
          fields.exception_type = exMatch[1];
          fields.exception_message = exMatch[2];
        }
      }
    }

    const entry: Omit<LogEntry, 'filePath' | 'byteStart' | 'byteEnd'> = {
      id: ctx.nextId(),
      sourceId: ctx.sourceId,
      seq: ctx.nextSeq(),
      timestamp,
      level,
      message: (message ?? '').trim(),
      raw: rawBlock,
      fields,
    };
    return { entry, confidence: 0.85 };
  },
  defaultColumns: ['level'],
});
