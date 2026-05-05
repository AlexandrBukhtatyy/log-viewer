// UI-only types. Everything that maps to core (LogLevel/LogEntry/LogFilter/
// FieldFilter/TimeRange/QueryMode/SourceId/EntryId/SourceRecord/SourceStatus)
// is imported as `import type` from '../../core/types/index.ts' — direct
// consumption, no adapter layer (see ADR-0002 §Adapter-слой and the plan
// in docs/plans/replicated-cooking-muffin.md §1.6).

// Tweaks shape lives next to its persistence hook; re-exported here for
// ergonomic UI imports. Same for LvSavedSearch (hooks/use-saved-searches.ts).
// This keeps `hooks/` from importing `ui/`, satisfying the ADR-0002 layer
// boundary in eslint.config.js.
export type {
  LvTweaks,
  LvTweakTheme,
  LvTweakDensity,
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
   * Optional human label rendered next to the spinner while the source is
   * loading/indexing/streaming. Examples: `"loading…"`, `"indexing 1234"`,
   * `"streaming 42"`. `undefined` when the source is idle/done.
   */
  progressLabel?: string;
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
  /** True while the source is in loading/indexing/streaming. Used to render a spinner. */
  live?: boolean;
  /**
   * Set when the folder represents the root of an external log source
   * (a directory the user opened, not an internal sub-folder). Used by
   * LvTreeNode to render a source-specific icon (`LvSourceIcon`) instead
   * of the generic folder glyph, so the tree visually distinguishes
   * "this is where a source begins" from "this is just a sub-folder".
   * Distinct from `root`, which marks the catalog top-level grouping.
   */
  sourceKind?: LvSourceKind;
  children: LvNode[];
}

export type LvNode = LvFileNode | LvFolderNode;
export type LvCatalogRoot = LvFolderNode & { root: true };

export type LvRail = 'files' | 'search' | 'bookmarks' | 'alerts' | 'ai';

export type LvGroupBy =
  | 'trace_id'
  | 'req_id'
  | 'user_id'
  | 'service'
  | 'level'
  | 'kind'
  | 'file';

export interface LvTab {
  id: string;
  name: string;
  path?: string;
  kind?: LvLogKind;
}
