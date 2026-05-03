import type { LogEntry } from '../types/index.ts';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * 32-bit FNV-1a over a string, returned as 8-char lowercase hex.
 *
 * Not cryptographic — used as a content fingerprint for bookmarks where
 * collisions only mean "two entries share a bookmark icon," not "data leak."
 */
export const fnv1aHex = (s: string): string => {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * Stable identifier for a log entry that survives a re-ingest of the same
 * source: `<sourceId>:<fnv1a(raw)>`. Used as the bookmark key so toggling a
 * bookmark on a row keeps the bookmark after the source is closed and
 * re-opened (the new ingest assigns a fresh `EntryId` but the raw line is
 * unchanged).
 *
 * Caveat: two entries with identical `raw` from the same source share a
 * fingerprint. The bookmark UI will mark both — acceptable trade-off; a
 * stronger key would need `seq`, which itself shifts when lines get inserted.
 */
export const entryFingerprint = (entry: LogEntry): string =>
  `${entry.sourceId}:${fnv1aHex(entry.raw)}`;
