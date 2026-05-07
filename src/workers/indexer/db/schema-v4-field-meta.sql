-- v4 — per-source field schema cache (ADR-0017).
--
-- Records every dynamic field key the parser ever emitted into
-- `entry.fields_json` for a source, along with its inferred type and a
-- bounded sample of top values. Drives the column picker / group-by /
-- filter-on-field UI without scanning the full `entry` table on each
-- picker open.
--
-- Built-in attributes (`@ts`, `@level`, `@source.kind`, …) are NOT stored
-- here — they are constant and synthesised by `getFieldSchema` in code.
-- Only the dynamic, parser-derived keys live in this table.

CREATE TABLE IF NOT EXISTS field_meta (
  source_id        TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,                 -- 'trace_id' / 'remote_addr' / …
  type             TEXT NOT NULL,                 -- 'string'|'number'|'boolean'|'mixed'
  occurrences      INTEGER NOT NULL DEFAULT 0,    -- rows in source where key was present
  total_seen       INTEGER NOT NULL DEFAULT 0,    -- denominator for presence_rate
  last_seen_at     INTEGER,                       -- Date.now() of the most recent batch
  top_values_json  TEXT,                          -- JSON array of {value, count}, capped at top-K
  PRIMARY KEY (source_id, key)
);

CREATE INDEX IF NOT EXISTS idx_field_meta_source ON field_meta(source_id);
