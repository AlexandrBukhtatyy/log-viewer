-- v5 — record physical line number and per-file entry ordinal alongside
-- the existing offset-pointer columns. Drives the gutter in the table
-- view ("first column shows the line in the source file") and the
-- "Open at line" affordance.
--
-- Both columns are 1-based when populated by the orchestrator. Rows
-- ingested under v3/v4 don't have these values — they were never
-- recorded by the pipeline — so the migration keeps them at 0 and the
-- UI renders 0 as "—". Sources can be re-ingested to backfill.
--
-- Non-destructive: ALTER TABLE adds the columns in place, no row data
-- is touched. Indexes are unchanged — neither column is on the hot
-- query path (we filter by source_id/seq/ts).

ALTER TABLE entry ADD COLUMN line_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entry ADD COLUMN file_seq    INTEGER NOT NULL DEFAULT 0;
