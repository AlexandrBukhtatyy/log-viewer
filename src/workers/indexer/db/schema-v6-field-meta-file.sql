-- v6 — add a per-file dimension to the field-schema cache.
--
-- Until v5 `field_meta` was keyed by (source_id, key), so every dynamic
-- field key a parser emitted was attributed to the whole source. For a
-- directory source that bundles several files (e.g. app.log + mixed.log
-- + stack-traces.log in one folder), opening a single file tab showed
-- the UNION of every sibling file's keys in the column / group-by
-- pickers — even when the active file's format has no fields at all.
--
-- v6 widens the primary key to (source_id, file_path, key) so the cache
-- can be scoped to the active file(s). `file_path` mirrors
-- `entry.file_path` semantics: the relative path inside a directory
-- source, or '' for single-file sources.
--
-- SQLite can't change a primary key in place, so we drop and recreate
-- the table. The cache is derived data — the indexer repopulates it on
-- first start under v6 by replaying the persisted `entry` table (which
-- already carries source_id / file_path / fields_json), so no source
-- files need re-parsing.

DROP TABLE IF EXISTS field_meta;

CREATE TABLE field_meta (
  source_id        TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL DEFAULT '',       -- relative path in a dir source, '' for single-file
  key              TEXT NOT NULL,                 -- 'trace_id' / 'remote_addr' / …
  type             TEXT NOT NULL,                 -- 'string'|'number'|'boolean'|'mixed'
  occurrences      INTEGER NOT NULL DEFAULT 0,    -- rows in (source, file) where key was present
  total_seen       INTEGER NOT NULL DEFAULT 0,    -- denominator for presence_rate
  last_seen_at     INTEGER,                       -- Date.now() of the most recent batch
  top_values_json  TEXT,                          -- JSON array of {value, count}, capped at top-K
  PRIMARY KEY (source_id, file_path, key)
);

CREATE INDEX IF NOT EXISTS idx_field_meta_source ON field_meta(source_id);
CREATE INDEX IF NOT EXISTS idx_field_meta_source_file
  ON field_meta(source_id, file_path);
