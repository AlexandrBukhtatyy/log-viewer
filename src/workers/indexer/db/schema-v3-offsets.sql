-- v3 — offset-pointer + minute-bucket index (ADR-0016).
--
-- Replaces the v1+v2 model where every entry's `raw` and `message` were
-- materialized into the SQLite database (and FTS5-indexed on top). After v3
-- the database holds only pointers back to the original byte source — the
-- real bytes live either in the user's FileSystemFileHandle (directory/file
-- sources) or in an OPFS spool file (text/pasted/snapshot/url/stream).
--
-- This migration is destructive: existing `entry` rows are dropped because
-- their schema cannot represent the new pointer columns and re-deriving
-- pointers from `raw` is not generally possible (the original byte position
-- in the source file isn't recorded). On first start with v3 the coordinator
-- re-ingests every persisted source from scratch.
--
-- Activation: NOT YET wired into `migrations.ts`. Phase 6 of the plan
-- (`docs/plans/replicated-cooking-muffin.md`) flips the switch together
-- with the indexer-api SELECT/INSERT rewrite. The SQL is committed early
-- so reviewers can validate the schema separately from the code change.

DROP TRIGGER IF EXISTS entry_ai_fts;
DROP TRIGGER IF EXISTS entry_ad_fts;
DROP TRIGGER IF EXISTS entry_au_fts;
DROP TABLE IF EXISTS entry_fts;

DROP INDEX IF EXISTS idx_entry_source_seq;
DROP INDEX IF EXISTS idx_entry_ts;
DROP INDEX IF EXISTS idx_entry_level;
DROP TABLE IF EXISTS entry;

-- Pointer-only entry. Body is in the source's storage, not in SQLite.
-- file_path semantics:
--   - directory:    relative path inside the source-handle ('app/api.log')
--   - file:         '' (handle is the file itself)
--   - opfs-single:  '' (lv-spool/<sourceId>.bin)
--   - opfs-chunked: chunk-seq stringified ('0','1',…) -> lv-spool/<sourceId>/<seq>.bin
-- byte_end is exclusive; trailing \n / \r\n is NOT included in the range.
CREATE TABLE entry (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  ts          INTEGER,
  level       TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  byte_start  INTEGER NOT NULL,
  byte_end    INTEGER NOT NULL,
  fields_json TEXT
);
CREATE INDEX idx_entry_source_seq  ON entry(source_id, seq);
CREATE INDEX idx_entry_ts          ON entry(ts);
CREATE INDEX idx_entry_level       ON entry(level);
CREATE INDEX idx_entry_source_file ON entry(source_id, file_path);

-- Per-(source × file × minute) aggregate. Drives timeline / first-paint /
-- group-by without scanning entry rows. Updated during ingest as a UPSERT
-- batch from the orchestrator (cheaper than a per-row trigger).
CREATE TABLE entry_minute (
  source_id        TEXT    NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  file_path        TEXT    NOT NULL,
  minute_bucket    INTEGER NOT NULL,            -- floor(ts_ms / 60000)
  byte_start       INTEGER NOT NULL,            -- min(byte_start) in the bucket
  byte_end         INTEGER NOT NULL,            -- max(byte_end)   in the bucket
  entry_count      INTEGER NOT NULL,
  level_dist_json  TEXT    NOT NULL,            -- {"info":42,"warn":3,"error":1}
  PRIMARY KEY (source_id, file_path, minute_bucket)
);
CREATE INDEX idx_entry_minute_ts ON entry_minute(minute_bucket);
