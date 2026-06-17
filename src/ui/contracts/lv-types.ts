// UI-only types. Everything that maps to core (LogLevel/LogEntry/LogFilter/
// FieldFilter/TimeRange/QueryMode/SourceId/EntryId/SourceRecord/SourceStatus)
// is imported as `import type` from '../../core/types/index.ts' — direct
// consumption, no adapter layer (see ADR-0002 §Adapter-слой and the plan
// in docs/plans/replicated-cooking-muffin.md §1.6).

// Tweaks shape lives next to its persistence hook; re-exported here for
// ergonomic UI imports. Same for LvSavedSearch (hooks/use-saved-searches.ts).
// This keeps `hooks/` from importing `ui/`, satisfying the ADR-0002 layer
// boundary in eslint.config.js.
import type { LogFilter } from '../../core/types/index.ts';
import type { LvColumnPref } from '../../hooks/use-ui-prefs.ts';
export type {
  LvTweaks,
  LvTweakTheme,
  LvTweakDensity,
  LvColumnPref,
  LvColumnPreset,
  LvGutterMode,
  LvTableView,
} from '../../hooks/use-ui-prefs.ts';
export type { LvSavedSearch } from '../../hooks/use-saved-searches.ts';

/**
 * Visual classification of a log file in the sidebar tree (drives icon/badge).
 * Distinct from core's parser kinds — this is a presentation concept.
 */
export type LvLogKind =
  | 'app'
  | 'json'
  | 'nginx'
  | 'k8s'
  | 'syslog'
  | 'stacktrace'
  | 'text';

/**
 * "Add source" menu options. Broader than core/sources/ (which currently has
 * 5 adapters: file/directory/text/url/stream); the rest are UI-only labels —
 * either mapped to existing adapters by container or hidden in Phase 1
 * (see plan §1.5).
 */
export type LvSourceKind =
  | 'local-static'
  | 'local-live'
  | 'remote-ssh'
  | 'stream'
  | 'cloud'
  | 'k8s'
  | 'bus'
  | 'snapshot'
  | 'db'
  | 'bookmark';

export interface LvFileNode {
  id: string;
  type: 'file';
  name: string;
  path?: string;
  kind: LvLogKind;
  size?: string | number;
  count?: number;
  service?: string;
  live?: boolean;
  newCount?: number;
  /** True when the persisted handle needs `requestPermission`. UI renders a "Grant access" button. */
  needsPermission?: boolean;
  /** Free-text error from a failed adapter (`SourceStatus.kind === 'error'`). */
  errorMessage?: string;
  /**
   * Compact progress value shown next to the spinner. A percent string when
   * the orchestrator knows the byte total (`"73%"`); otherwise the raw
   * entry counter (`"1,234"`) or `"…"` for transitional states.
   */
  progressLabel?: string;
  /** Human-readable explanation of `progressLabel` — surfaced as the tooltip. */
  progressTitle?: string;
  /** True for catalog top-level file-source roots (LvCatalogRoot file variant). */
  root?: boolean;
  /** Source kind for the outlined per-source glyph at root level. */
  source?: LvSourceKind;
  /** Parser id resolved at ingest time (Phase 2.E). Drives the parser-badge on the source row. */
  parserId?: string;
}

export interface LvFolderNode {
  id: string;
  type: 'folder';
  name: string;
  path?: string;
  root?: boolean;
  source?: LvSourceKind;
  open?: boolean;
  status?: string;
  host?: string;
  service?: string;
  readOnly?: boolean;
  /** Mirrors LvFileNode.progressLabel for directory roots whose source is ingesting. */
  progressLabel?: string;
  /** Mirrors LvFileNode.progressTitle — tooltip for the directory-root progress badge. */
  progressTitle?: string;
  /** True while the source is in loading/indexing/streaming. Used to render a spinner. */
  live?: boolean;
  /** Parser id resolved at ingest time (Phase 2.E). Same semantics as on LvFileNode. */
  parserId?: string;
  children: LvNode[];
}

export type LvNode = LvFileNode | LvFolderNode;
/**
 * Catalog top-level entry — one per ingested source. Renders the outlined
 * per-source icon (LvSourceIcon) and exposes the "remove source" affordance.
 * Folder variant is used by directory sources (with their walked tree as
 * children); file variant is used by single-file sources (file/text/url/…).
 */
export type LvCatalogRoot =
  | (LvFolderNode & { root: true })
  | (LvFileNode & { root: true });

export type LvRail =
  | 'files'
  | 'search'
  | 'bookmarks'
  | 'alerts'
  | 'ai'
  | 'parsers'
  | 'fields';

/**
 * Group-by key (ADR-0017). Free-form `FieldKey` — built-in `@`-attribute
 * (`@level`, `@source.kind`, …) or a dynamic JSON key (`trace_id`,
 * `service`). The picker enumerates available keys from
 * `coordinator.getFieldSchema`; the SQL translator (`fieldKeyToSql`)
 * decides what column or `JSON_EXTRACT` to emit.
 *
 * Pre-Phase-6 enum values (`'trace_id'`/`'service'`/…) keep working
 * without translation — they're already valid `FieldKey`s.
 */
export type LvGroupBy = string;

/**
 * One user-added column in the table (ADR-0017). The fixed
 * LN/TIMESTAMP/LEVEL/MESSAGE columns are always present and never
 * appear here; this list is what the column-picker controls.
 *
 * `key` is a `FieldKey` (built-in `@`-attribute or dynamic JSON key).
 * `label` overrides the default header text — defaults to `key`.
 * `widthPx` is the rendered width; `null` means "auto-size" (used
 * for trailing 1fr columns).
 */
export interface LvColumn {
  readonly key: string;
  readonly label?: string;
  readonly widthPx: number;
}

export interface LvTab {
  /** Unique tab id; for file tabs equals the SourceId so re-opening the same source is detected. `'__all__'` is reserved for the multi-select aggregate tab. */
  id: string;
  name: string;
  path?: string;
  kind?: LvLogKind;
  /**
   * VS Code-style preview vs pinned. Sidebar single-click opens a preview
   * tab (italic) and reuses the same slot on the next single-click.
   * Double-click on the tab itself flips this to `true`. `__all__`
   * ignores this field.
   */
  isPinned?: boolean;
  /**
   * Per-tab override for the user-added columns (between fixed FILE and
   * MESSAGE). When absent, the viewer falls back to the global
   * `tweaks.columns` (used for the `'__all__'` aggregate tab and any
   * legacy tab opened before per-tab columns landed).
   *
   * Initialised on `openTab` from `SourceRecord.parserDefaultColumns`
   * so newly opened file tabs immediately reflect the format-specific
   * column set declared by the parser. Mutations from the column
   * picker write back here for non-`__all__` tabs.
   */
  columns?: ReadonlyArray<LvColumnPref>;
  /**
   * Per-tab single-column sort. Driven by clicks on the table header
   * in `LvViewer`. When absent, the viewer falls back to
   * `orderByForFilter`'s auto-infer (physical for single-source
   * single-file, time everywhere else).
   */
  sortBy?: { readonly key: string; readonly dir: 'asc' | 'desc' };
  /**
   * Per-tab override for the core filter (query / levels / services /
   * fieldFilters / timeRange). When absent, the viewer falls back to the
   * global `coreFilter` (used for the `'__all__'` aggregate tab and any
   * legacy tab opened before per-tab filters landed).
   *
   * Stored WITHOUT `sources`/`filePaths` — the tab's scope is derived from
   * its `id`/selection (see `tabSelection` in `LvAppContainer`), so those
   * fields are always nulled before persisting.
   */
  filter?: LogFilter;
  /**
   * Per-tab override for group-by. When absent, falls back to the global
   * `groupBy`. `'__all__'` ignores this and reads/writes the global value.
   */
  groupBy?: ReadonlyArray<LvGroupBy>;
}
