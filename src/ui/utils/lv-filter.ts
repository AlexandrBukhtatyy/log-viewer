import type {
  LvFilters,
  LvGroup,
  LvGroupBy,
  LvGroupPathSegment,
  LvLogEntry,
} from '../contracts/lv-types.ts';

export function lvApplyFilters(entries: ReadonlyArray<LvLogEntry>, f: LvFilters): LvLogEntry[] {
  const { levels, services, query, useRegex, caseSensitive, wholeWord, timeRange, fieldFilters } = f;
  let re: RegExp | null = null;
  if (query) {
    try {
      let pattern = useRegex ? query : query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
      re = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch {
      re = null;
    }
  }
  return entries.filter((e) => {
    if (!levels.has(e.level)) return false;
    if (services.size && !services.has(e.service)) return false;
    if (timeRange) {
      const t = new Date(e.ts).getTime();
      if (t < timeRange[0] || t > timeRange[1]) return false;
    }
    for (const ff of fieldFilters) {
      const v = e.fields[ff.key];
      if (v == null) return false;
      if (ff.op === '=' && String(v) !== ff.value) return false;
      if (ff.op === '!=' && String(v) === ff.value) return false;
      if (ff.op === '>' && !(Number(v) > Number(ff.value))) return false;
      if (ff.op === '<' && !(Number(v) < Number(ff.value))) return false;
      if (ff.op === '~' && !String(v).toLowerCase().includes(ff.value.toLowerCase())) return false;
    }
    if (re && !re.test(e.raw) && !re.test(e.msg)) return false;
    return true;
  });
}

function buildLevel(
  entries: ReadonlyArray<LvLogEntry>,
  fields: ReadonlyArray<LvGroupBy | string>,
  depth: number,
  ancestryPath: LvGroupPathSegment[],
): LvGroup[] {
  const field = fields[depth]!;
  const map = new Map<string, LvGroup>();
  for (const e of entries) {
    let raw: unknown;
    if (field === 'file') raw = e.file;
    else if (field === 'service') raw = e.service;
    else raw = e.fields[field];
    let key: string;
    if (raw == null || raw === '') key = '(no value)';
    else key = String(raw);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        field,
        depth,
        entries: [],
        minTs: Infinity,
        maxTs: -Infinity,
        levels: {},
        path: [...ancestryPath, { field, key }],
      };
      map.set(key, g);
    }
    g.entries.push(e);
    const t = new Date(e.ts).getTime();
    if (t < g.minTs) g.minTs = t;
    if (t > g.maxTs) g.maxTs = t;
    g.levels[e.level] = (g.levels[e.level] ?? 0) + 1;
  }
  const list = Array.from(map.values()).sort((a, b) => {
    const ea = a.levels.error ? 1 : 0;
    const eb = b.levels.error ? 1 : 0;
    if (ea !== eb) return eb - ea;
    return a.minTs - b.minTs;
  });
  const hasMore = depth + 1 < fields.length;
  if (hasMore) {
    for (const g of list) {
      g.children = buildLevel(g.entries, fields, depth + 1, g.path);
    }
  }
  return list;
}

export function lvBuildGroups(
  entries: ReadonlyArray<LvLogEntry>,
  groupBy: ReadonlyArray<LvGroupBy | string>,
): LvGroup[] | null {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return null;
  return buildLevel(entries, groupBy, 0, []);
}

export function lvGroupId(group: LvGroup): string {
  return group.path.map((p) => `${p.field}:${p.key}`).join('|');
}
