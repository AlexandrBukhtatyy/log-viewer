# Offset-pointer + minute-bucket index, lazy body read

## Context

Сегодня индексация — это **перенос** содержимого: парсер читает строку, дублирует её в `entry.raw` и `entry.message`, FTS5-триггер копирует ещё раз во `entry_fts` ([schema.sql:13-22](../../src/workers/indexer/db/schema.sql#L13-L22), [schema-v2-fts.sql:5-32](../../src/workers/indexer/db/schema-v2-fts.sql#L5-L32)). На `large.jsonl` 6.5 МБ это ~6.5 МБ в OPFS-SQLite + соразмерный FTS-сегмент. Для directory-источников файлы **уже** лежат локально в FS — копия в БД избыточна.

Цель: **directory не копируется** — мы запоминаем «по логической записи: какой файл, какие байты, какой timestamp/level и какие динамические поля». Тело подгружается лениво при показе. Для **non-file** источников (stream/url/text/pasted/snapshot) контент скидывается в OPFS-spool-файл, и тот же offset-механизм работает поверх него. UI на этом параллельный — `useDirectoryTrees` уже показывает дерево из `FileSystemDirectoryHandle` независимо от ingest-а.

Решения, согласованные с пользователем:
1. **Гибрид**: per-entry pointer + per-file/per-minute aggregate.
2. **Без FTS5** — substring/regex на post-filter уровне (визуально-ограниченный набор после SQL-фильтра).
3. **Динамические поля** — `fields_json + JSON_EXTRACT` (как сейчас).
4. **OPFS трогаем только для non-directory** sources. Для directory читаем из исходных handle'ов.
5. **Гранулярность offset'а** — по логической записи (multi-line stack-trace = одна запись, один byte-range).
6. **Streaming sources** (stream): каждый network packet → **отдельный файл** в OPFS, не append в общий. Это убирает contention writer↔reader, ускоряет запись, упрощает LRU-eviction. Для one-shot источников (text/pasted/snapshot, url-as-fetch) — один spool-файл.

## Recommended approach

### 1. Schema v3 — pointers + buckets, без body

Новая миграция `db/schema-v3-offsets.sql`:

```sql
-- entry: pointer-only, body живёт в исходном файле / opfs-spool
DROP TABLE entry_fts;
DROP TRIGGER IF EXISTS entry_ai_fts;
DROP TRIGGER IF EXISTS entry_ad_fts;
DROP TRIGGER IF EXISTS entry_au_fts;

CREATE TABLE entry_v3 (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  ts          INTEGER,
  level       TEXT NOT NULL,
  file_path   TEXT NOT NULL,         -- '' для одно-файловых spool'ов
  byte_start  INTEGER NOT NULL,
  byte_end    INTEGER NOT NULL,
  fields_json TEXT
);
CREATE INDEX idx_entry_v3_source_seq ON entry_v3(source_id, seq);
CREATE INDEX idx_entry_v3_ts         ON entry_v3(ts);
CREATE INDEX idx_entry_v3_level      ON entry_v3(level);

-- Aggregate per file × minute (для timeline / first-paint / group-by)
CREATE TABLE entry_minute (
  source_id      TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  minute_bucket  INTEGER NOT NULL,   -- floor(ts_ms / 60000)
  byte_start     INTEGER NOT NULL,   -- min(byte_start) среди записей бакета
  byte_end       INTEGER NOT NULL,   -- max(byte_end)
  entry_count    INTEGER NOT NULL,
  level_dist_json TEXT NOT NULL,     -- {"info":42,"warn":3,"error":1}
  PRIMARY KEY (source_id, file_path, minute_bucket)
);
CREATE INDEX idx_entry_minute_ts ON entry_minute(minute_bucket);
```

Хирургический DROP старой `entry` с переносом source-таблицы — миграция v3 переименовывает старую `entry` в `entry_legacy` (или просто DROP; индекс пересобирается из исходников при первом обращении). FTS5 убирается полностью.

### 2. Source storage abstraction

Новый источник чтения — `SourceBlobReader`, выдаёт `Blob` для (source, file_path):

```ts
// src/workers/coordinator/storage/source-blob-reader.ts
interface SourceBlobReader {
  /**
   * file_path semantics:
   *   - directory:        relative path внутри source-handle ('app/api.log')
   *   - opfs-single:      '' (единственный spool-файл)
   *   - opfs-chunked:     chunk seq как строка ('0', '1', '2', …)
   */
  read(sourceId: SourceId, filePath: string, byteStart: number, byteEnd: number): Promise<string>;
}
```

Имплементации:
- **`FsHandleReader`** — directory/file: `getFileHandle(filePath)` → `getFile()` → `Blob.slice(start, end).text()`. Кэширует file handles per `(sourceId, filePath)`.
- **`OpfsSingleSpoolReader`** — text/pasted/snapshot/url: читает `lv-spool/<sourceId>.bin`, slice'ит.
- **`OpfsChunkedSpoolReader`** — stream: читает `lv-spool/<sourceId>/<chunkSeq>.bin`, slice'ит. `byteStart/byteEnd` — offset'ы **внутри chunk-файла** (не глобальные).

Storage-kind резолвится по `source.kind`:
- `directory`, `file` → `FsHandleReader`
- `text`, `pasted`, `snapshot`, `url` → `OpfsSingleSpoolReader`
- `stream` → `OpfsChunkedSpoolReader`

### 3. Adapter contract: byte-aware frames

`LogLineFrame` ([source-adapter.ts:13-16](../../src/core/sources/source-adapter.ts#L13-L16)) расширяется:

```ts
export interface LogLineFrame {
  readonly path: string;              // '' для одно-файловых spool'ов (вместо null)
  readonly line: string;              // текст строки — для парсинга
  readonly byteStart: number;
  readonly byteEnd: number;           // exclusive
}
```

`directory-adapter` пишет per-line offsets через **byte-aware line splitter** ([core/sources/byte-line-splitter.ts](../../src/core/sources/byte-line-splitter.ts) — новый helper). Читаем `Uint8Array`-чанки из `FileHandle.stream()`, пробегаем по `\n`, держим running counter, на каждой строке выдаём `{ byteStart, byteEnd, line: decoder.decode(slice) }`. **Не используем** `TextDecoderStream → string-split`, потому что после декода byte-range теряется (UTF-8 vs char count).

`file-adapter` — то же самое (handle для одного файла).

`text/pasted/snapshot/url` — пишут весь content одним blob'ом через `OpfsSingleSpoolWriter` (см. §4), затем splitter пробегает по spool-файлу и эмитит frames с offset'ами **внутри spool**.

`stream-adapter` — для каждого пришедшего packet'а: создаёт **новый chunk-файл** `lv-spool/<sourceId>/<chunkSeq>.bin` через `OpfsChunkedSpoolWriter`, splitter работает на chunk'е и эмитит frames с `path: '<chunkSeq>'` и offset'ами **внутри chunk'а** (не глобальными). Если packet содержит частичную строку — её хвост накапливается в writer'е и приклеивается к следующему chunk'у; индексируется только в составе следующего chunk'а.

### 4. OPFS spool — два режима

```ts
// src/workers/coordinator/storage/opfs-spool.ts

// Режим 1: один файл на источник. Для text/pasted/snapshot/url —
// данные приходят один раз (или batched), нет contention.
class OpfsSingleSpoolWriter {
  static async open(sourceId: SourceId): Promise<OpfsSingleSpoolWriter>;
  async write(bytes: Uint8Array): Promise<{ byteStart: number; byteEnd: number }>;
  async close(): Promise<void>;
  // path всегда '' для emitted frames
}

// Режим 2: chunk-per-packet. Для stream — каждый push становится отдельным
// файлом, чтобы writer (новый chunk) не блокировал reader (предыдущие).
class OpfsChunkedSpoolWriter {
  static async open(sourceId: SourceId): Promise<OpfsChunkedSpoolWriter>;
  /** Пишет chunk; возвращает идентификатор для индекса (path = '<chunkSeq>'). */
  async pushChunk(bytes: Uint8Array): Promise<{ chunkSeq: number; byteSize: number }>;
  /** Накапливает хвост недописанной строки между chunk'ами. */
  flushPendingTail(): Uint8Array | null;
  async close(): Promise<void>;
}
```

**Single-spool layout**: `lv-spool/<sourceId>.bin`. На `removeSource` — `removeEntry` файла.

**Chunked-spool layout**: директория `lv-spool/<sourceId>/`, внутри `0.bin`, `1.bin`, … . На `removeSource` — рекурсивный `removeEntry(<sourceId>, { recursive: true })`. Расширяется [coordinator.ts:401-416](../../src/workers/coordinator/coordinator.ts#L401-L416).

Почему chunk-per-file для stream:
- Запись в `<chunkSeq>.bin` не пересекается с уже завершёнными chunk'ами, которые в этот момент читает reader.
- `FileSystemSyncAccessHandle` для appen-only paradigm требует blocked-handle — chunked обходит это создавая каждый раз новый handle.
- LRU-eviction ретеншена: «оставить N последних chunks» = `removeEntry` старых файлов одной операцией.
- Recovery: если процесс упал на середине chunk'а — потеряли только этот chunk.

Trade-off: больше мелких файлов в OPFS. Mitigation: chunk-size управляется адаптером (рекомендуем coalesce: писать chunk либо когда накопилось ≥64 КБ, либо прошло ≥500 мс с последнего push'а — что наступит раньше).

### 5. Parser output: без `raw`

`ParseRequestCtx` ([parser.contract.ts](../../src/core/rpc/parser.contract.ts)) уже принимает контекст. Меняется output `parseLine` ([json-lines-parser.ts:103](../../src/core/parsers/json-lines-parser.ts#L103), [plain-text-parser.ts](../../src/core/parsers/plain-text-parser.ts)):

```ts
interface ParsedRecord {
  ts?: number;
  level: LogLevel;
  fields: Record<string, unknown>;    // динамические поля (включая trace_id, req_id, service, file_path)
  // ❌ raw      — не возвращаем
  // ❌ message  — не возвращаем (восстанавливается на read-path тем же парсером)
}
```

Парсер видит `line` целиком, парсит, отдаёт metadata. `raw` нигде между парсером и indexer'ом не курсирует.

Multi-line stack-trace — обрабатывается **внутри adapter'а или splitter'а**: при детектировании continuation-строк (whitespace-prefixed, отсутствует ts-префикс) splitter не закрывает текущий frame, а аккумулирует line + расширяет `byteEnd`. На выходе один `LogLineFrame` с многострочным `line` и единым byte-range. Простой эвристический detector в byte-line-splitter (configurable; для JSONL не активен — там каждая строка самодостаточна).

### 6. Indexer write path

[insertBatch](../../src/workers/indexer/indexer-api.ts#L238-L279) принимает новую форму:

```ts
interface IndexedEntry {
  id: string;
  sourceId: SourceId;
  seq: number;
  ts?: number;
  level: LogLevel;
  filePath: string;
  byteStart: number;
  byteEnd: number;
  fields: Record<string, unknown>;
}
```

INSERT_ENTRY_SQL ([indexer-api.ts:165-168](../../src/workers/indexer/indexer-api.ts#L165-L168)) переписывается под `entry_v3`. После каждого batch — `upsertMinuteBuckets(entries)`: группирует записи по `(source_id, file_path, floor(ts/60000))`, эмитит UPSERT в `entry_minute` (`INSERT … ON CONFLICT DO UPDATE SET entry_count = entry_count + ?, level_dist_json = json_patch(level_dist_json, ?)…`). Aggregates вычисляются orchestrator'ом до прихода в indexer (он уже batch'ит) — так дешевле, чем триггер на каждый INSERT.

### 7. Indexer read path: lazy body resolve

`search(filter, limit, offset)` ([indexer-api.ts:281-290](../../src/workers/indexer/indexer-api.ts#L281-L290)):

1. SQL отбирает row'ы по `entry_v3` (используя fields_json/level/ts/source_id/file_path-фильтры). Без FTS-clause.
2. Возвращает массив **PointerRow** (без `raw`/`message`).
3. **Coordinator read-layer** ([src/workers/coordinator/read/lazy-resolver.ts](../../src/workers/coordinator/read/lazy-resolver.ts) — новый):
   - группирует pointers по `(sourceId, filePath)`;
   - идёт в `SourceBlobReader.read()` для каждой группы (один `getFile()` на файл, batched `slice` per pointer);
   - прогоняет каждую строку через `parserPool.parseSync(line)` для вычисления `message` field;
   - возвращает заполненный `LogEntry` с `raw` (substring) + `message` + `fields`.
4. Substring/regex `query` ([log-filter.ts](../../src/core/types/log-filter.ts) `query` field) теперь применяется **на post-resolve** уровне — после получения `raw` строк; SQL-уровень уже сократил набор по полям/времени/файлам. Если `query` без других фильтров → читаем bucket-bucket по `entry_minute` и сканируем тело bucket'а в файле (по `entry_minute.byte_start..byte_end`), не загружая весь файл. Это ограничивает worst case `O(matched_buckets)` вместо `O(file)`.

Кэш handle'ов (FS file handles + OPFS file handles) живёт в coordinator-worker'е, key = `${sourceId}|${filePath}`, weak reference.

### 8. UI / sidebar / timeline

UI продолжает работать с `LogEntry` той же формы (`raw`, `message`, `fields` присутствуют). Изменений в [LvViewer](../../src/ui/components/stream/LvViewer.tsx) и пр. **не требуется** — read-path возвращает ту же shape.

[useHistogram](../../src/hooks/use-histogram.ts) и `getGroupCounts` могут переключиться на `entry_minute` для ускорения timeline (опционально, после первичной миграции). На этапе 1 timeline продолжает считать по `entry_v3` — корректно, но медленнее. `entry_minute` сразу пишется ради будущего ускорения.

### 9. Out of scope для этого плана

- **Watch/live tail** на growing-файлы (nginx/syslog appendage) — отдельный план: detection of file growth, incremental ingest от `lastIndexedSize`, инвалидация при truncate.
- **Использование `entry_minute` в histogram/group-counts** — опциональная оптимизация после того как pointer-pipeline стабилизируется.
- **Retiring `message` field из ParsedRecord для plain-text** — он реconstruct'ится тривиально, но если профайл покажет что parse-on-read дорог, вернёмся.
- **Поиск `find deadlock everywhere`** без полей — будет работать, но прочитает все matched bucket'ы. Если станет узким местом → отдельный inverted index в OPFS.

### Critical files

**Modify:**
- [src/workers/indexer/db/schema.sql](../../src/workers/indexer/db/schema.sql) — drop FTS5 deps; новая `entry_v3` + `entry_minute` либо в новой миграции `schema-v3-offsets.sql`.
- [src/workers/indexer/db/migrations.ts](../../src/workers/indexer/db/migrations.ts) — добавить v3.
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts:165) — `INSERT_ENTRY_SQL`, `ENTRY_COLS_*`, `rowToEntry`, `parseFields`, `search` SQL, новые `upsertMinuteBuckets`.
- [src/core/sources/source-adapter.ts](../../src/core/sources/source-adapter.ts) — `LogLineFrame` с `byteStart`/`byteEnd`.
- [src/core/sources/directory-adapter.ts](../../src/core/sources/directory-adapter.ts) — byte-aware reader через новый splitter.
- [src/core/sources/file-adapter.ts](../../src/core/sources/file-adapter.ts) — то же.
- [src/core/sources/text-adapter.ts](../../src/core/sources/text-adapter.ts), [url-adapter.ts](../../src/core/sources/url-adapter.ts), [stream-adapter.ts](../../src/core/sources/stream-adapter.ts), [snapshot-adapter.ts](../../src/core/sources/snapshot-adapter.ts) — ingest через `OpfsSpoolWriter`.
- [src/core/parsers/json-lines-parser.ts](../../src/core/parsers/json-lines-parser.ts), [plain-text-parser.ts](../../src/core/parsers/plain-text-parser.ts), [registry.ts](../../src/core/parsers/registry.ts) — output `ParsedRecord` без `raw`.
- [src/workers/coordinator/ingest/ingest-orchestrator.ts](../../src/workers/coordinator/ingest/ingest-orchestrator.ts) — собирает `IndexedEntry` (pointer + parsed fields), считает minute-buckets, шлёт в indexer два батча.
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — убрать FTS-clause; `query`-field уходит на post-filter.
- [src/core/filter/query.test.ts](../../src/core/filter/query.test.ts) — обновить, проверить отсутствие FTS-JOIN'а.

**Create:**
- `src/workers/indexer/db/schema-v3-offsets.sql` — миграция.
- `src/core/sources/byte-line-splitter.ts` — byte-aware splitter (с опциональной multi-line склейкой).
- `src/workers/coordinator/storage/source-blob-reader.ts` — interface + `FsHandleReader` + `OpfsSingleSpoolReader` + `OpfsChunkedSpoolReader`.
- `src/workers/coordinator/storage/opfs-spool.ts` — `OpfsSingleSpoolWriter` + `OpfsChunkedSpoolWriter`.
- `src/workers/coordinator/read/lazy-resolver.ts` — pointer-rows → `LogEntry` с подгруженным `raw`/`message` через `SourceBlobReader` + parser.
- `src/workers/coordinator/storage/handle-cache.ts` — weak-ref cache for file/blob handles (с разными ключами для chunk-spool: `${sourceId}|${chunkSeq}`).

**Delete:**
- [src/workers/indexer/db/schema-v2-fts.sql](../../src/workers/indexer/db/schema-v2-fts.sql) — после miграции v3 не нужен (миграция остаётся в истории, но новая БД создаётся сразу из v3).

### Verification

1. `npx tsc -b`, `pnpm lint`, `pnpm test --run` — все зелёные. Adapter-тесты обновляются под новый frame-shape. Parser-тесты — `raw` больше не в output. Query-тест — без FTS clause. Новый тест на byte-line-splitter (UTF-8 multi-byte, multi-line stack-trace). Новый тест на `lazy-resolver` (smoke на mock-blob-reader).
2. `pnpm build` — bundle размер не растёт критично; FTS5-зависимый код уходит, но добавляется blob-resolver.
3. **Browser smoke**:
   - **directory**: открыть `.tmp/demo_logs/` (есть в gen-fixtures) → дерево в сайдбаре сразу. Через ~сек ingest закончен, в SQLite-OPFS только `entry_v3` + `entry_minute` (проверить через DevTools → Application → Storage). Размер БД ≪ размера исходных файлов.
   - **DB размер**: до миграции `large.jsonl` 6.5 МБ → SQLite ~10 МБ. После — SQLite ~3-4 МБ.
   - **Чтение**: scroll по `app.log`, строки отображаются (`raw`/`message` подгружаются). Нет ленивых-spinner'ов на каждую row (read batched).
   - **Filter**: `level:error` → ошибки фильтруются (SQL). `query: deadlock` → substring находит на post-filter уровне.
   - **text/pasted/snapshot**: `Add source` → text → создаётся `lv-spool/<sourceId>.bin` (видно в Application → Origin Private File System → `lv-spool/`). Source отображается, чтение работает.
   - **stream**: подключиться к WebSocket-моку → push'нуть несколько packet'ов → в `lv-spool/<sourceId>/` появляются `0.bin`, `1.bin`, … . Каждый chunk = отдельный файл. Чтение visible window работает на готовых chunk'ах не блокируя приём новых.
   - **Reload**: persisted handle для directory нужно re-grant; spool остаётся (handle в OPFS не требует разрешения). После reload sources восстанавливаются, чтение работает.
   - **Remove source**: directory → удаляется только index запись. text/pasted/snapshot → `removeEntry('lv-spool/<sourceId>.bin')`. stream → `removeEntry('lv-spool/<sourceId>', { recursive: true })`.
   - 0 console errors.
4. Performance baseline (Playwright + `performance.now`): на `large.jsonl`:
   - Ingest время — должно стать **быстрее** (нет FTS-индексации).
   - Чтение visible window 100 строк — `< 50ms` (handle cache + один-два slice'а).
   - SQL filter `level:error` — `< 30ms`.
