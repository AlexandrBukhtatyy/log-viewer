export type LvLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LvLogKind =
  | 'app'
  | 'json'
  | 'nginx'
  | 'k8s'
  | 'syslog'
  | 'stacktrace'
  | 'text';

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

export interface LvLogEntry {
  id: string;
  fileId: string;
  file: string;
  path: string;
  line: number;
  ts: string;
  level: LvLogLevel;
  service: string;
  msg: string;
  kind: LvLogKind;
  fields: Record<string, unknown>;
  raw: string;
  stack?: string[];
}

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
  children: LvNode[];
}

export type LvNode = LvFileNode | LvFolderNode;

export type LvCatalogRoot = LvFolderNode & { root: true };

export interface LvSavedSearch {
  id: string;
  name: string;
  query: string;
  levels: LvLogLevel[];
}

export type LvFieldFilterOp = '=' | '!=' | '>' | '<' | '~';

export interface LvFieldFilter {
  key: string;
  op: LvFieldFilterOp;
  value: string;
}

export interface LvFilters {
  levels: Set<LvLogLevel>;
  services: Set<string>;
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  timeRange: [number, number] | null;
  fieldFilters: LvFieldFilter[];
}

export type LvTweakTheme = 'dark' | 'light';
export type LvTweakDensity = 'compact' | 'comfortable';

export interface LvTweaks {
  theme: LvTweakTheme;
  density: LvTweakDensity;
  wrap: boolean;
  showDate: boolean;
  accent: string;
  timelineOn: boolean;
}

export type LvRail = 'files' | 'search' | 'bookmarks' | 'alerts' | 'ai';

export type LvGroupBy =
  | 'trace_id'
  | 'req_id'
  | 'user_id'
  | 'service'
  | 'level'
  | 'kind'
  | 'file';

export interface LvGroupPathSegment {
  field: string;
  key: string;
}

export interface LvGroup {
  field: string;
  key: string;
  depth: number;
  entries: LvLogEntry[];
  children?: LvGroup[];
  minTs: number;
  maxTs: number;
  levels: Partial<Record<LvLogLevel, number>>;
  path: LvGroupPathSegment[];
}

export interface LvTab {
  id: string;
  name: string;
  path?: string;
  kind?: LvLogKind;
}
