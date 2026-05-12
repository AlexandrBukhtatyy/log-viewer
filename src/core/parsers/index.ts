import { appTextParser } from './app-text-parser.ts';
import { jsonLinesParser } from './json-lines-parser.ts';
import { nginxCombinedParser } from './nginx-combined-parser.ts';
import { plainTextParser } from './plain-text-parser.ts';
import { syslog3164Parser } from './syslog-parser.ts';
import { ParserRegistry } from './registry.ts';

export { appTextParser } from './app-text-parser.ts';
export { jsonLinesParser } from './json-lines-parser.ts';
export { nginxCombinedParser } from './nginx-combined-parser.ts';
export { plainTextParser } from './plain-text-parser.ts';
export { syslog3164Parser } from './syslog-parser.ts';
export { ParserRegistry } from './registry.ts';

/**
 * Priority order is significant — `ParserRegistry.pick` returns the
 * first parser whose `canParse` accepts the first non-empty line of
 * the source sample.
 *
 *  100  json-lines       — anything starting with `{`
 *   80  nginx-combined   — full quoted-request regex; cheap test
 *   70  syslog-3164      — `[<pri>]Mon DD HH:MM:SS host program: …`
 *   60  app-text         — `[timestamp] LEVEL message` (incl. multi-line)
 *    0  plain-text       — catch-all
 *
 * Custom (user-defined) parsers slot in at priority 50 between the
 * built-ins and plain-text once Phase 2.C lands.
 */
export const createDefaultRegistry = (): ParserRegistry => {
  const r = new ParserRegistry();
  r.register(jsonLinesParser, 100);
  r.register(nginxCombinedParser, 80);
  r.register(syslog3164Parser, 70);
  r.register(appTextParser, 60);
  r.register(plainTextParser, 0);
  return r;
};
