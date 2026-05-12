/**
 * Bridge between `ui/components/` (which can only type-import from
 * `core/`) and the parser library. The Parsers panel uses these
 * runtime helpers to pre-validate user input and to render the
 * pre-bundled template library.
 */
export { compileGrok } from '../../core/parsers/lib/grok.ts';
export { PARSER_TEMPLATES } from '../../core/parsers/parser-templates.ts';
export type {
  CustomParserDef,
  CustomParserField,
  CustomParserKind,
} from '../../core/parsers/custom-parser-def.ts';
