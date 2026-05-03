import type { LogEntry } from '../types/log-entry.ts';
import type { LogParser, ParseCtx } from '../types/log-parser.ts';

interface RegisteredParser {
  readonly parser: LogParser;
  readonly priority: number;
}

export class ParserRegistry {
  private readonly entries: RegisteredParser[] = [];

  register(parser: LogParser, priority = 0): void {
    this.entries.push({ parser, priority });
    this.entries.sort((a, b) => b.priority - a.priority);
  }

  list(): ReadonlyArray<LogParser> {
    return this.entries.map((e) => e.parser);
  }

  /** Pick a single parser per source by sniffing the first non-empty line of a sample. */
  pick(sample: ReadonlyArray<string>): LogParser {
    const probe = sample.find((line) => line.trim().length > 0) ?? '';
    for (const { parser } of this.entries) {
      if (parser.canParse(probe)) {
        return parser;
      }
    }
    throw new Error(
      'ParserRegistry.pick: no parser registered (plain-text fallback missing?)',
    );
  }

  pickById(id: string): LogParser | null {
    const found = this.entries.find((e) => e.parser.id === id);
    return found?.parser ?? null;
  }

  /** Try every registered parser (highest priority first); used as fallback when the
   *  per-source primary declines a particular line. */
  parseAny(line: string, ctx: ParseCtx): LogEntry | null {
    for (const { parser } of this.entries) {
      if (!parser.canParse(line)) continue;
      const { entry } = parser.parseLine(line, ctx);
      if (entry !== null) return entry;
    }
    return null;
  }
}
