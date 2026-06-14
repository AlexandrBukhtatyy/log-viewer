# Ускорение индексации логов

## Context

Индексация работает медленно. По результатам исследования архитектуры — три класса проблем, в порядке убывания важности:

1. **Однопоточное горлышко в `IndexerWorker`.** Парсеры распараллелены до 4 воркеров (см. `recommendedPoolSize` в [parser-pool.ts:196-198](src/workers/coordinator/pool/parser-pool.ts#L196-L198)), но все батчи через Comlink стекаются в **один** `IndexerWorker` ([coordinator/index.ts:31-57](src/workers/coordinator/index.ts#L31-L57)). На быстром парсинге индексер становится узким местом.
2. **Лишняя работа в `insertBatch`** ([indexer-api.ts:364-486](src/workers/indexer/indexer-api.ts#L364-L486)):
   - 1000 раз подряд `bind().step().reset()` — 1000 переходов JS↔WASM на батч вместо одного multi-row INSERT.
   - `SELECT field_meta` внутри транзакции на каждый `source_id` в батче (строки 436-442) — отдельный round-trip перед UPSERT.
   - `JSON.stringify` на каждой записи для `fields_json` (строка 389) — даже если поля уже сериализованы.
3. **Дорогой status-callback на каждом батче.** Каждый `insertBatch` вызывает `onChange` ([coordinator.ts:412-420](src/workers/coordinator/coordinator.ts#L412-L420)) → `count(activeFilter)`. Throttle 200мс есть, но на горячем инжесте это всё равно десятки `COUNT(*)` в секунду, блокирующих очередь индексера.

Дополнительно: ограничения пула воркеров (`Math.min(cores - 1, 4)`) и маленький `cache_size = -8000` (8 МБ кэша SQLite) — простые wins.

**Цель плана:** убрать дешёвые узкие места первым проходом (тривиальные правки), затем сократить работу в `insertBatch` (умеренный рефакторинг). Sharded indexer **не** делаем — отдельная история.

## План изменений

### Этап 1. Тривиальные правки (низкий риск, ~1-2 строки на пункт)

**1.1. Поднять лимит пула воркеров.**
[src/workers/coordinator/pool/parser-pool.ts:196-199](src/workers/coordinator/pool/parser-pool.ts#L196-L199)

```ts
// было: Math.min(Math.max(cores - 1, 1), 4)
// стало:
export const recommendedPoolSize = (): number => {
  const cores =
    (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.min(Math.max(cores - 1, 1), 8);
};
```

Upper bound `8` — чтобы на 32-ядерных машинах не плодить лишние воркеры (каждый держит свой SQLite handle и парсер-state). На типичных 8-12-ядерных лэптопах получим 7-8 параллельных парсеров вместо 4.

**1.2. Увеличить SQLite cache и включить mmap.**
[src/workers/indexer/db/open-db.ts:103-109](src/workers/indexer/db/open-db.ts#L103-L109)

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = MEMORY;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65000;     -- было -8000 (8 МБ → ~64 МБ)
PRAGMA mmap_size = 268435456;   -- 256 МБ memory-mapped I/O
```

Cache 64 МБ покрывает индексы и горячую часть `entry`/`field_meta` для типичных файлов до сотен МБ. `mmap_size` ускоряет чтения при сборке временных результатов и поиске.

**1.3. Снизить частоту status-emit во время инжеста.**
[src/workers/coordinator/coordinator.ts:420](src/workers/coordinator/coordinator.ts#L420)

```ts
const CHANGE_THROTTLE_MS = 500; // было 200
```

Дополнительно: проверить в `dispatchChangeNotice`, что во время активного инжеста (есть source со статусом `indexing`/`streaming`) **не** запускается `count(activeFilter)` для каждого батча — достаточно публиковать `totalCount` из per-source counters (которые уже инкрементируются в `bumpSourceCountStmt`, см. [indexer-api.ts:401-403](src/workers/indexer/indexer-api.ts#L401-L403)). Точный `filteredCount` пересчитывать только когда все источники переходят в `ready`.

Это правка средней сложности — потребует прочитать `dispatchChangeNotice` и места, где UI читает `totalCount`/`filteredCount` ([LvAppContainer.tsx](src/app/containers/LvAppContainer.tsx)), но эффект существенный: убирает основной источник UI-блокировки.

### Этап 2. Умеренный рефакторинг `insertBatch` (один файл, ~30-50 строк)

[src/workers/indexer/indexer-api.ts:364-486](src/workers/indexer/indexer-api.ts#L364-L486)

**2.1. Multi-row INSERT для `entry`.**

Заменить per-row цикл с `insertEntryStmt.bind().step().reset()` на батчевый INSERT партиями по ~256 строк (256 × 11 параметров = 2816 — далеко от лимита `SQLITE_MAX_VARIABLE_NUMBER` = 32766).

```ts
const ROWS_PER_INSERT = 256;
for (let i = 0; i < entries.length; i += ROWS_PER_INSERT) {
  const slice = entries.slice(i, i + ROWS_PER_INSERT);
  const placeholders = slice
    .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .join(', ');
  const sql = `INSERT OR IGNORE INTO entry (${ENTRY_COLS_UNQUALIFIED}) VALUES ${placeholders}`;
  const params: SqlValue[] = [];
  for (const e of slice) {
    params.push(
      e.id,
      e.sourceId,
      e.seq,
      e.timestamp,
      e.level,
      e.filePath,
      e.byteStart,
      e.byteEnd,
      e.lineNumber,
      e.fileSeq,
      typeof e.fields === 'string' ? e.fields : JSON.stringify(e.fields),
    );
  }
  db.exec({ sql, bind: params });
}
```

Заметки:

- Prepared statement `insertEntryStmt` тут не нужен (SQL разный по числу `VALUES`-групп); либо удалить его, либо оставить как fallback для случая `entries.length < ROWS_PER_INSERT`. По коду — удалить и упростить.
- `typeof e.fields === 'string'` — защита от двойной сериализации (см. п. 2.3).

**2.2. Один SELECT для всего `field_meta`-merge.**

Сейчас на N source_id'ов делается N SELECT'ов с `IN (?, ?, ...)`. Заменить на один SELECT со связкой source_id+key:

```ts
const allPairs: Array<[SourceId, string]> = [];
for (const [sid, perKey] of fieldsBySource) {
  for (const key of perKey.keys()) allPairs.push([sid, key]);
}
if (allPairs.length > 0) {
  const conds = allPairs.map(() => '(source_id = ? AND key = ?)').join(' OR ');
  const params: SqlValue[] = [];
  for (const [sid, key] of allPairs) {
    params.push(sid);
    params.push(key);
  }
  const existingRows = runRows(
    db,
    `SELECT source_id, key, type, occurrences, total_seen, top_values_json
       FROM field_meta WHERE ${conds}`,
    params,
  );
  // … merge по (source_id, key) → как раньше
}
```

При больших батчах с большим разнообразием ключей — следить за `SQLITE_MAX_VARIABLE_NUMBER`; если `allPairs.length > 1000`, разбивать по чанкам (1000 пар × 2 = 2000 параметров, безопасно). Альтернатива — temp-таблица или JSON-функции SQLite. Начнём с простого варианта.

**2.3. Убрать повторный `JSON.stringify`.**

Если `e.fields` приходит уже как строка (зависит от парсера), не пересериализовывать. Проверить в `enrich`/возвращаемом типе `LogEntry.fields` ([src/core/parsers/](src/core/parsers/) и [src/workers/parser/parser-api.ts](src/workers/parser/parser-api.ts)) — типично это `Record<string, unknown>`, но JSON-парсер уже имеет исходную строку. Проще: гарантировать в `enrich`, что `fields_json` уже готов (отдавать `fieldsJson: string` рядом с `fields`), и в `insertBatch` использовать его. Это снимает `JSON.stringify` на горячем пути.

Если правка `enrich` распирает scope — минимум сделать `typeof e.fields === 'string' ? e.fields : JSON.stringify(e.fields)` (см. 2.1).

### Критические файлы

| Файл                                                                                       | Что меняем                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [src/workers/coordinator/pool/parser-pool.ts](src/workers/coordinator/pool/parser-pool.ts) | Лимит пула 4 → 8 (одна строка).                                                                                                           |
| [src/workers/indexer/db/open-db.ts](src/workers/indexer/db/open-db.ts)                     | `cache_size`, `mmap_size` (две строки в PRAGMA-блоке).                                                                                    |
| [src/workers/coordinator/coordinator.ts](src/workers/coordinator/coordinator.ts)           | `CHANGE_THROTTLE_MS` 200 → 500; во время инжеста не дёргать `count(activeFilter)` — отдавать approximate `totalCount` из source counters. |
| [src/workers/indexer/indexer-api.ts](src/workers/indexer/indexer-api.ts)                   | Multi-row INSERT для `entry`, единый SELECT для field_meta, опционально — `fields_json` без повторной сериализации.                       |

### Что **не** делаем

- **Sharded indexer.** Несколько IndexerWorker'ов с шардингом по `source_id` снимет главный bottleneck, но это серьёзный рефакторинг (concurrency на OPFS-файле БД, координация транзакций, partitioned schema). Если результата правок выше будет мало — это следующая итерация, отдельным планом и ADR.
- **Замена `byte-line-splitter` / TextDecoder per-line.** Микрооптимизация в profile-измеримой области, но в общем балансе времени затраты на парсинг ≪ затрат на SQLite-вставку. Откладываем до данных профилирования.
- **Изменение схемы / новых индексов.** Текущая схема v5 адекватна. Добавление составного `(source_id, ts)` — только если профиль покажет, что фильтр-запросы тормозят, а не инжест.

## Verification

1. **`pnpm gen:fixtures`** — пересоздать `.tmp/large.jsonl` (~50k строк / 6.5 МБ).
2. **Замер до и после.** В DevTools открыть Performance, запустить инжест `.tmp/large.jsonl` через UI. Снять `wall-clock` от drag-drop до `status: ready`. Цель: сокращение в 1.5-3x от тривиальных правок, ещё +1.5-2x от рефакторинга `insertBatch`.
3. **Multi-file сценарий.** Залить директорию `.tmp/` целиком (`pino.jsonl` + `bunyan.jsonl` + `app.log` + `mixed.log` + `large.jsonl`) — проверить что параллельные парсеры реально используются (DevTools → Performance → Main vs Workers). До правок — 4 воркера активны; после — должно быть `cores - 1`.
4. **Корректность данных.**
   - `pnpm test` — все vitest зелёные (особенно тесты вокруг `insertBatch`, `aggregateMinuteBuckets`, `aggregateFieldMeta`).
   - В UI открыть таблицу, проверить `totalCount` совпадает с числом строк в файле, `field_meta` показывает все ключи (нет потерь от изменённого SELECT-merge).
   - Sanity-check на mixed.log: должны быть и JSON, и plain-text entries, корректные `level`, timeline minute-buckets непустые.
5. **Регрессии:**
   - `pnpm build` — TypeScript clean.
   - `pnpm lint` — ESLint clean.
   - Открыть приложение в двух табах одновременно — убедиться, что SAH-pool conflict retries (из недавнего git diff на `open-db.ts`) не сломались.

## Порядок применения

Делать по этапам, после каждого — прогон verification:

1. Этап 1 целиком (3 правки в 3 файлах).
2. Этап 2.1 (multi-row INSERT) — самостоятельная правка, замерить.
3. Этап 2.2 (единый SELECT для field_meta).
4. Этап 2.3 (без повторной сериализации) — последним, требует трогать `enrich`.

Если на каком-то этапе появляется регрессия в тестах — откатиться к предыдущему commit и разбираться, не сваливая правки в кучу.
