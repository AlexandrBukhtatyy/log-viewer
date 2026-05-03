import { jsonLinesParser } from './json-lines-parser.ts';
import { plainTextParser } from './plain-text-parser.ts';
import { ParserRegistry } from './registry.ts';

export { jsonLinesParser } from './json-lines-parser.ts';
export { plainTextParser } from './plain-text-parser.ts';
export { ParserRegistry } from './registry.ts';

export const createDefaultRegistry = (): ParserRegistry => {
  const r = new ParserRegistry();
  r.register(jsonLinesParser, 100);
  r.register(plainTextParser, 0);
  return r;
};
