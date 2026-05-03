-- v2 — FTS5 full-text index over entry.message + entry.raw.
-- External-content mode: entry_fts indexes the entry table without duplicating
-- text storage. Triggers keep them in sync on insert/delete/update.

CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
  message,
  raw,
  content='entry',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Backfill from any rows that already exist when this migration runs.
INSERT INTO entry_fts(rowid, message, raw)
  SELECT rowid, message, raw FROM entry;

CREATE TRIGGER IF NOT EXISTS entry_ai_fts AFTER INSERT ON entry BEGIN
  INSERT INTO entry_fts(rowid, message, raw)
    VALUES (new.rowid, new.message, new.raw);
END;

CREATE TRIGGER IF NOT EXISTS entry_ad_fts AFTER DELETE ON entry BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, message, raw)
    VALUES ('delete', old.rowid, old.message, old.raw);
END;

CREATE TRIGGER IF NOT EXISTS entry_au_fts AFTER UPDATE ON entry BEGIN
  INSERT INTO entry_fts(entry_fts, rowid, message, raw)
    VALUES ('delete', old.rowid, old.message, old.raw);
  INSERT INTO entry_fts(rowid, message, raw)
    VALUES (new.rowid, new.message, new.raw);
END;
