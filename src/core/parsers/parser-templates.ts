import type { CustomParserDef } from './custom-parser-def.ts';

/**
 * Pre-bundled parser library (Phase 2.C.templates). Definitions live as
 * JSON in `docs/parsers/*.json` so they can be reviewed/edited as text
 * and shipped with the app. `import.meta.glob('/docs/...')` resolves
 * paths from Vite's project root — keeps the JSON next to the rest of
 * the documentation tree instead of bunkered inside `src/`.
 *
 * `version`, `createdAt`, `updatedAt` are timestamps the user gets when
 * they import the template into their workspace; we re-stamp on import
 * so the panel's "Updated at" makes sense even for freshly imported
 * entries.
 */

interface RawTemplate {
  readonly default: CustomParserDef;
}

const modules = import.meta.glob<RawTemplate>('/docs/parsers/*.json', {
  eager: true,
});

export const PARSER_TEMPLATES: ReadonlyArray<CustomParserDef> = Object.entries(modules)
  .map(([path, mod]) => {
    const def = (mod as unknown as CustomParserDef & { default?: CustomParserDef })
      .default ?? (mod as unknown as CustomParserDef);
    if (!def || typeof def !== 'object' || typeof def.id !== 'string') {
      console.warn(`[parser-templates] ignoring malformed template at ${path}`);
      return null;
    }
    return def;
  })
  .filter((d): d is CustomParserDef => d !== null)
  .sort((a, b) => a.label.localeCompare(b.label));
