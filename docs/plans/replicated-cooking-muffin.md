# Dynamic field schema + `@`-namespace — implementation plan

Companion to [ADR-0017](../adr/0017-dynamic-field-schema.md). The ADR fixes the *what* and *why*; this document fixes the *order* and *touch points* so the work can be picked up phase-by-phase without re-deriving them.

## Context

После [ADR-0016](../adr/0016-offset-pointer-index-lazy-body.md) `entry.fields_json` уже содержит парсенные ключи произвольной формы (pino: `traceId`/`reqId`/…; nginx: `remote_addr`/`status`/…; syslog: `host`/…). UI этим **не пользуется**: колонки таблицы зашиты в CSS-grid, group-by enum-string из 7 значений, filter-bar отдельные кнопки для `levels`/`services`/`filePaths`.

Цель — сделать UI генерируемым из реальных данных:
- какие поля встречаются в выбранных источниках → picker'ы (column / group-by / filter on field).
- built-in атрибуты (timestamp/level/file/source) и dynamic-поля живут в одном namespace через `@`-prefix.
- единый SQL-translator (`fieldKeyToSql`) — никаких разрозненных «одно поле — один shorthand».

## Phases

### Phase 1 — Schema v4: `field_meta` table

**Modify:**
- [src/workers/indexer/db/schema.sql](../../src/workers/indexer/db/schema.sql) или новый [schema-v4-field-meta.sql](../../src/workers/indexer/db/) — миграция.
- [src/workers/indexer/db/migrations.ts](../../src/workers/indexer/db/migrations.ts) — register v4.

```sql
CREATE TABLE field_meta (
  source_id    TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  type         TEXT NOT NULL,                    -- 'string'|'number'|'boolean'|'mixed'
  occurrences  INTEGER NOT NULL DEFAULT 0,
  total_seen   INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  top_values_json TEXT,                          -- top-K {value, count}
  PRIMARY KEY (source_id, key)
);
CREATE INDEX idx_field_meta_source ON field_meta(source_id);
```

Backfill стратегия — **none**. v4 миграция просто создаёт пустую таблицу. Существующие entries (от v3) не имеют counter'ов в meta — picker для них покажет «no fields yet», пока не пройдёт хотя бы один новый ingest. Re-ingest не форсируем; по практике пользователь либо добавит новый source, либо триггернёт ручной refresh когда захочет видеть поля.

### Phase 2 — Indexer: UPSERT `field_meta` в `insertBatch`

**Modify:**
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — внутри transaction batch'а:
  1. Проход по `entries` собирает `Map<sourceId, Map<key, KeyAccum>>`, где `KeyAccum = { occurrences, types: Set, topVals: Map<value, count> }`. `total_seen` равен `entries.length`-per-source.
  2. UPSERT в `field_meta` per (source, key): `INSERT … ON CONFLICT DO UPDATE SET occurrences = occurrences + ?, total_seen = total_seen + ?, type = …merge…, top_values_json = …merge top-20…`.
  3. `type` merge: если existing != new → `'mixed'`, иначе сохранить.
  4. `top_values_json` merge: cap 20, увеличиваем counters существующих, новые добавляем по convergence.

Фактический UPSERT statement добавлять в `State.upsertFieldMetaStmt` (prepared) и вызывать в той же транзакции что и `INSERT_ENTRY_SQL` + `upsertMinuteStmt`.

**Tests:**
- Расширить `migrations.test.ts` (или новый) — `insertBatch` обновляет `field_meta`, `type='mixed'` при разных типах, top values с правильными counters.

### Phase 3 — SQL field-key translator

**Modify:**
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — новый `fieldKeyToSql(key: FieldKey): { sql: string; needsSourceJoin: boolean; bindParams?: SqlValue[] }`. Для key:
  - `@ts` → `entry.ts`
  - `@level` → `entry.level`
  - `@seq` → `entry.seq`
  - `@file` → `entry.file_path`
  - `@byte_start` / `@byte_end` → `entry.byte_start` / `entry.byte_end`
  - `@source.id` → `entry.source_id`
  - `@source.name` → `source.name` (+ needsSourceJoin)
  - `@source.kind` → `source.kind` (+ needsSourceJoin)
  - всё остальное → `JSON_EXTRACT(entry.fields_json, '$.<key>')`
- `buildClause` рефакторится: `levels[]` / `services[]` / `filePaths[]` сворачиваются в проходы через `fieldFilters`-like loop, но всё на уровне translator'а. Shorthand-поля **остаются** на API-поверхности `LogFilter` (backward compat) — сахар, не отдельный SQL-путь.
- `joinSql` начинает использоваться: если в filter есть `@source.*`, добавляется `JOIN source ON source.id = entry.source_id`.
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — `groupCounts` / `histogram` принимают `FieldKey` вместо `string`, проходят через `fieldKeyToSql`.

**Tests:**
- [src/core/filter/query.test.ts](../../src/core/filter/query.test.ts) — кейсы для каждого `@`-built-in (включая JOIN), для произвольного fields_json key, для `levels` shorthand.

### Phase 4 — RPC: `getFieldSchema`

**Modify:**
- [src/core/rpc/indexer.contract.ts](../../src/core/rpc/indexer.contract.ts) — `fieldMeta(sourceIds: SourceId[]): FieldDescriptor[]`. `FieldDescriptor`:
  ```ts
  interface FieldDescriptor {
    key: FieldKey;                         // '@ts', 'trace_id', …
    label: string;                         // human label
    type: 'string'|'number'|'boolean'|'enum'|'time'|'level'|'mixed';
    origin: 'builtin' | 'dynamic';
    occurrences?: number;                  // dynamic only
    presenceRate?: number;                 // dynamic only
    topValues?: ReadonlyArray<{ value: string; count: number }>;
  }
  ```
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — `fieldMeta` SQL: `SELECT key, type, occurrences, total_seen, top_values_json FROM field_meta WHERE source_id IN (…)`. Aggregates across the requested set (sums of occurrences / total_seen, types unioned). Built-in поля append'ятся в коде (они константны).
- [src/core/rpc/coordinator.contract.ts](../../src/core/rpc/coordinator.contract.ts) + [src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts) — `getFieldSchema(filter)` proxy.

### Phase 5 — UI: column picker + dynamic CSS-grid

**Modify:**
- [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts):
  - Add `LvColumn { key: FieldKey; label?: string; widthPx: number }`.
  - `LvTweaks.columns: ReadonlyArray<LvColumn>` (default: `LN/TIMESTAMP/LEVEL/MESSAGE` fixed + nothing else).
  - `LvGroupBy = string` (free-form), retire enum.
- [src/hooks/use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts) — persist `columns` + `columnWidths`.
- [src/ui/components/stream/LvViewer.tsx](../../src/ui/components/stream/LvViewer.tsx) + [lv.css:1107](../../src/ui/styles/lv.css#L1107) — header + row рисуются по `columns`. `grid-template-columns` строится inline-style:
  `[fixed cols] [user cols join(' ')] [MESSAGE 1fr] [action]`.
- New `LvColumnPicker.tsx` (popover): получает `getFieldSchema`, рисует две группы (`Source / Built-in` + `Fields`), checkboxes per field, drag-handle для переупорядочивания. Sort dynamic part by `presenceRate DESC`. Auto-suggest: показывать поля с `presenceRate ≥ 0.5` сверху списка.

### Phase 6 — Group-by picker (replace enum)

**Modify:**
- [src/ui/components/filter/LvGroupBySelect.tsx](../../src/ui/components/filter/LvGroupBySelect.tsx) — переписан под `FieldKey` строки. UI идентичен column picker'у (тот же `LvFieldPicker.tsx` shared component).
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — `lvGroupByToCoreField` упрощается (теперь `FieldKey` идёт прямо в `coordinator.getGroupCounts`).

### Phase 7 — Filter-on-any-field

**Modify:**
- [src/ui/components/filter/LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx) — кнопка `+ field filter` открывает `LvFieldPicker` → выбор field → `LvFieldFilterBuilder` (op: `=`/`!=`/`~`/`>`/`<`, value-input с автодополнением из `topValues`).
- Existing chips (level/service/timeRange) остаются как было — sugar, не дублируются.

### Phase 8 — Verification

1. `npx tsc -b`, `pnpm lint`, `pnpm test --run` — все зелёные. Новые тесты: indexer field_meta UPSERT, fieldKeyToSql translator, query.test для @-prefix cases.
2. `pnpm build` — bundle размер делta < +5 KiB gz (UI picker компоненты).
3. **Browser smoke**:
   - Открыть pino-source (`.tmp/demo_logs/pino.jsonl`) — `getFieldSchema` возвращает `traceId`, `reqId`, `level` (или нет — pino кладёт level в built-in `entry.level`). Auto-suggest вставляет topN в column picker.
   - `+ Add column` → traceId → таблица показывает trace IDs.
   - `Group by → @source.kind` → группы `directory`, `file`, etc.
   - `Group by → traceId` → группы по trace.
   - `+ field filter → status > 499` (на nginx) → фильтрует только error-rows.
   - Reload → колонки/group-by/filter persist'ятся (через `useUiPrefs`).
   - 0 console errors.

## Out of scope (separate work)

- **History fields**: показывать «исчезнувшие» поля (были в логах, но отсутствуют в недавних batch'ах). `field_meta` хранит cumulative; UI решит когда «забывать».
- **Per-source column profiles**: разные column-наборы для разных источников. Сейчас persist глобальный — пользователь сам toggle'ит при смене source set.
- **Schema export/import**: backup column/group/filter prefs между устройствами. Через [useUiPrefs](../../src/hooks/use-ui-prefs.ts) JSON-blob если понадобится.
- **Type-aware operators**: `>`/`<` для string-полей сейчас silent-cast; UI должен дисабл'ить недопустимые операторы по `type`. Cosmetic, после Phase 7.
- **`@message` в filter**: post-filter substring/regex остаётся как сейчас (lazy-resolver path), не трогаем.
