-- v1 — initial schema. FTS5 (entry_fts virtual table + triggers) добавляется в миграции v2
-- по плану §4 (Этап 4 — FTS), здесь только базовые таблицы и indexes.

CREATE TABLE IF NOT EXISTS source (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  meta_json    TEXT,
  indexed_at   INTEGER,
  entry_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entry (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  ts           INTEGER,
  level        TEXT NOT NULL,
  message      TEXT NOT NULL,
  raw          TEXT NOT NULL,
  fields_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_entry_source_seq ON entry(source_id, seq);
CREATE INDEX IF NOT EXISTS idx_entry_ts         ON entry(ts);
CREATE INDEX IF NOT EXISTS idx_entry_level      ON entry(level);
