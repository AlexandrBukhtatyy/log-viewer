import type { LogEntry } from '../../core/types/index.ts';
import { VF_KEY_PREFIX, type LvVirtualField } from '../../hooks/use-ui-prefs.ts';

export { VF_KEY_PREFIX } from '../../hooks/use-ui-prefs.ts';

export const isVirtualFieldKey = (key: string): boolean =>
  key.startsWith(VF_KEY_PREFIX);

export interface CompiledVirtualField {
  readonly key: string;
  readonly label?: string;
  readonly regex: RegExp;
  readonly group: string;
  readonly target: 'raw' | 'message';
}

/**
 * Compile a list of virtual-field definitions into a lookup map keyed
 * by `vf:`-prefixed cell key. Regex compilation happens once per
 * definition; entries with invalid patterns are skipped so a broken
 * regex doesn't break the whole table.
 *
 * The caller (LvAppContainer) memoises by `activeTab.virtualFields`
 * identity so the map is reused across rows.
 */
export const compileVirtualFields = (
  defs: ReadonlyArray<LvVirtualField>,
): ReadonlyMap<string, CompiledVirtualField> => {
  const map = new Map<string, CompiledVirtualField>();
  for (const def of defs) {
    try {
      const regex = new RegExp(def.pattern);
      map.set(def.key, {
        key: def.key,
        label: def.label,
        regex,
        group: def.group,
        target: def.target ?? 'raw',
      });
    } catch {
      // Invalid pattern — skip. The builder UI surfaces this on save.
    }
  }
  return map;
};

/**
 * Resolve a `vf:`-prefixed cell value for one entry. Returns `null`
 * when the key is unknown, the regex doesn't match, or the named
 * group is missing from the match.
 */
export const resolveVirtualField = (
  entry: LogEntry,
  key: string,
  compiled: ReadonlyMap<string, CompiledVirtualField>,
): string | null => {
  const cf = compiled.get(key);
  if (!cf) return null;
  const target = cf.target === 'message' ? entry.message : entry.raw;
  const m = target.match(cf.regex);
  if (!m) return null;
  const groups = m.groups as Record<string, string> | undefined;
  return groups?.[cf.group] ?? null;
};
