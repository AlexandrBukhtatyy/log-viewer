# Sequence diagrams: log pipeline (ingest + read)

## Context

После миграции на offset-pointer индекс ([ADR-0016](../adr/0016-offset-pointer-index-lazy-body.md)) рантайм-пайплайн стал нелинейным: парсинг идёт в одном worker-pool'е, хранение pointer'ов — в indexer-worker'е, а тело строк подгружается **лениво** в coordinator-worker'е через blob-reader. ADR показывает компонентную картину (flowchart), но не показывает, **в каком порядке** что вызывается и какие сообщения летают через границы worker'ов.

Разработчику, читающему код впервые, сейчас приходится вручную трассировать flow через 8+ файлов. Цель этой работы — задокументировать два главных runtime-сценария sequence-диаграммами, чтобы можно было быстро ответить «что происходит когда…».

Целевые два сценария:
1. **Ingest** — от клика «+ Add source» до записи pointer-row в SQLite и обновления `entry_count` в сайдбаре.
2. **Read** — от scroll-события в virtual list до отображения строки `127.0.0.1 - GET / 200` после lazy-resolve.

Дополнительно мини-диаграмма для **Filter change**, потому что она триггерит тот же read-pipeline и часто непонятно, почему UI re-fetch'ит данные «сам собой».

## Recommended approach

Создаём один документ `docs/architecture/log-pipeline-sequence.md`. Не интегрируем в ADR-0016: ADR — про **решение**, sequence — про **исполнение**. Если поведение поменяется, ADR меняется редко, а sequence-диаграмма — синхронно с кодом.

В файл идут три Mermaid `sequenceDiagram`-блока, каждый с короткой пояснительной запиской под ним. Записка ссылается на конкретные файлы и функции, чтобы можно было прыгнуть в код одним кликом.

### Структура файла

```
# Log pipeline — sequence diagrams

## 1. Ingest: from "Add source" click to indexed pointers
   <Mermaid sequenceDiagram>
   ### Step-by-step (with code links)

## 2. Read: from scroll event to displayed lines
   <Mermaid sequenceDiagram>
   ### Step-by-step

## 3. Filter change (mini)
   <Mermaid sequenceDiagram>
   ### Step-by-step

## How this matches the code (verification)
   - Bullet list mapping arrows → files:line
```

### Участники (lifelines), которые повторно используются между диаграммами

- **User** — кнопка/клавиатура.
- **UI (React)** — `LvAppContainer`, `LvSidebar`, `LvViewer`, `useLogWindow`, hooks.
- **store** — Zustand store в main thread (`createLogClient` в [log-client.ts](../../src/worker-client/log-client.ts)).
- **Coord** — coordinator-worker ([coordinator.ts](../../src/workers/coordinator/coordinator.ts)).
- **Parsers** — parser-worker pool через `ParserPool.withWorker` ([parser-api.ts](../../src/workers/parser/parser-api.ts)).
- **Indexer** — indexer-worker ([indexer-api.ts](../../src/workers/indexer/indexer-api.ts)).
- **Storage** — FS handle / OPFS spool, обёрнуты `SourceBlobReader` ([source-blob-reader.ts](../../src/workers/coordinator/storage/source-blob-reader.ts)).

### Ground-truth flow для §1 «Ingest» (что должна показать диаграмма)

Прослежено по коду:

1. User → `LvAddSourceModal.submit()` → `onSubmit(data)`.
2. `LvApp` закрывает модал; `LvAppContainer.onSubmitAddSource(data)` ([LvAppContainer.tsx:374-393](../../src/app/containers/LvAppContainer.tsx#L374-L393)) → `sourceCtrl.addDirectory(data)`.
3. `useSourceController.addDirectory` → `store.getState().addDirectory(opts)` → `log-client.ts addDirectory` ([log-client.ts:241-267](../../src/worker-client/log-client.ts#L241-L267)). Если handle уже передан — пикер не открывается; иначе под user-gesture открывается `showDirectoryPicker`. Затем `api().addSource({kind:'directory',…})` через Comlink.
4. `coordinator.addSource` ([coordinator.ts:372-399](../../src/workers/coordinator/coordinator.ts#L372-L399)):
   - `await indexer.opening`.
   - `newSourceId()`.
   - `indexer.upsertSource(source)` — запись в `source` таблицу.
   - Для directory — `handleStore.put({...})` в IDB.
   - `startIngest(source)` — fire-and-forget.
5. `coordinator.startIngest` ([coordinator.ts:272-308](../../src/workers/coordinator/coordinator.ts#L272-L308)):
   - `factory(source)` создаёт adapter.
   - `sources.set(id, {source, status:'idle', aborter})`.
   - `emitStatus()` синхронно прогоняет `statusListeners` → callback в main thread → `store.setState({sources:records})` → Zustand notify → `useSourceStatus()` → ребиндит сайдбар. Source появляется как chip с status idle.
   - `ingestSource({adapter, parserPool, indexer, signal, onStatus, onChange})`.
6. `ingestSource` ([ingest-orchestrator.ts:35-120](../../src/workers/coordinator/ingest/ingest-orchestrator.ts)):
   - `onStatus({kind:'loading'})` → emit → UI status «loading…».
   - `adapter.open(signal)` → `ReadableStream<LogLineFrame>`.
     - **directory-adapter** ([directory-adapter.ts](../../src/core/sources/directory-adapter.ts)): `walkDirectory(handle, glob, signal)` → для каждого `entry.file`: `file.stream().pipeThrough(createByteLineSplitter(path))` → каждый кадр `{path, line, byteStart, byteEnd}`.
   - `lineStream.pipeThrough(createChunker({maxLines:1000, maxMs:100}))` → `LineBatch{path, lines: ParseLineFrame[]}`.
   - Цикл: `reader.read()` → batch.
     - На первом непустом — `parserPool.withWorker(p => p.detectParser(sample))`.
     - `parserPool.withWorker(p => p.parse(lines, ctx))` где ctx = `{sourceId, startSeq, parserId, filePath}`.
       - В parser-worker ([parser-api.ts:25-77](../../src/workers/parser/parser-api.ts)): `primary.parseLine(line)` → `ParsedRecord` без `filePath`/`byteStart`/`byteEnd`. `enrich(record, frame.byteStart, frame.byteEnd)` стампит pointer + `fields.file_path`.
     - `indexer.insertBatch(entries)` ([indexer-api.ts insertBatch](../../src/workers/indexer/indexer-api.ts)):
       - В транзакции: `INSERT_ENTRY_SQL` per entry → `entry(id, source_id, seq, ts, level, file_path, byte_start, byte_end, fields_json)`.
       - `bumpSourceCountStmt(n, now, sid)` per source.
       - `aggregateMinuteBuckets(entries)` группирует по `(source, file, floor(ts/60000))`, потом `upsertMinuteStmt` per bucket → `entry_minute`.
     - `entriesIndexed += n`; `onStatus({kind:'indexing', entriesIndexed})` → emit.
     - `onChange()` → `emitChange` ([coordinator.ts:323-343](../../src/workers/coordinator/coordinator.ts#L323-L343)): `version++`, `indexer.count(activeFilter)`, push `ChangesNotice{version, filteredCount}` подписчикам → main store `setState({version, filteredCount})` + `void store.getState().refresh()` ([log-client.ts:148-156](../../src/worker-client/log-client.ts#L148-L156)) → новый scroll fetch.
   - Конец потока: `onStatus({kind:'done', entryCount: entriesIndexed})`.

### Ground-truth flow для §2 «Read» (что должна показать диаграмма)

1. User scroll → `LvViewer` virtual scroll вычисляет visible range → `useLogWindow.setVisibleRange(from, to)` ([use-log-window.ts:31-34](../../src/hooks/use-log-window.ts)).
2. `setVisibleRange` ([log-client.ts:228-233](../../src/worker-client/log-client.ts)) → set `windowFrom/To` → `void refresh()`.
3. `refresh` ([log-client.ts:176-203](../../src/worker-client/log-client.ts)):
   - increments `refreshToken`, `set({isLoading:true})`.
   - `await api().setFilter(filter)`.
   - `Promise.all([api().getCount(), api().getRange(from-OVERSCAN, to+OVERSCAN)])`.
   - Stale-token check, потом `set({totalCount, filteredCount, entries: new Map(from+i → entry), isLoading:false})`.
4. `coordinator.getRange(from, to)` ([coordinator.ts:430-444](../../src/workers/coordinator/coordinator.ts#L430-L444)):
   - `indexer.search(activeFilter, from, to)` → SQL через `buildClause` ([query.ts](../../src/core/filter/query.ts)) → `SELECT entry.id, source_id, seq, ts, level, file_path, byte_start, byte_end, fields_json FROM entry WHERE … LIMIT ? OFFSET ?`. `rowToEntry` маппит в `LogEntry` shell с `raw=''`, `message=''` и заполненными pointer-полями.
   - `resolvePointersToEntries(pointers, lookupSource, parserPool)` ([lazy-resolver.ts](../../src/workers/coordinator/read/lazy-resolver.ts)):
     - Группирует по `sourceId`.
     - `lookupSource(sid)` → `LogSource` из in-memory `sources` Map. `readerForSource(source)` → `FsHandleReader`/`FileSourceReader`/`OpfsSingleSpoolReader`/`OpfsChunkedSpoolReader`.
     - Для каждой row параллельно (`Promise.all(srows.map(...))`): `reader.read(filePath, byteStart, byteEnd)` → `Blob.slice(start, end).text()` → string.
     - Все non-failed frames batch'ом → `parserPool.withWorker(p.parse(goodFrames, ctx))` чтобы реконструировать `message`.
     - Map enriched LogEntry в исходный порядок rows.
5. Возвращается `LogEntry[]` в main thread → store.setState → React rerender → `LvViewer` рисует строки.

### Ground-truth flow для §3 «Filter change»

Простой:
1. User меняет filter в UI (level/query/timeRange).
2. `useLogFilter.setFilter(next)` → `store.getState().setFilter(next)`.
3. `setFilter` ([log-client.ts:217-222](../../src/worker-client/log-client.ts)) → `set({filter, entries: new Map()})` (отбрасывает кэш) → `refresh()`.
4. Дальше шаги 3+ как в §2 «Read» — поэтому диаграмма очень короткая, только хвост.

### Critical files

**Create:**
- `docs/architecture/log-pipeline-sequence.md` — три Mermaid sequence-диаграммы плюс текстовая запись пошагово с file:line ссылками. Файл self-contained, не дублирует ADR-0016 (там компонентный flowchart, тут — runtime-вызовы).

**Optional:**
- Линк на новый файл в [docs/adr/0016-offset-pointer-index-lazy-body.md](../adr/0016-offset-pointer-index-lazy-body.md) под секцию `Links` (одна строка). Это связь «решение → как оно живёт в рантайме».
- Не трогаю CLAUDE.md / README.md — диаграмма обнаружится через ADR-link.

### Verification

Перед коммитом:
1. **Перечитать каждую стрелку диаграммы** против указанных в записке файлов:line — это и есть «соответствует ли реализации». Конкретно проверить:
   - Имена методов в сообщениях (`api().addSource` vs `coordinator.addSource` vs `indexerApi.insertBatch` — последний идёт через Comlink-обёртку, в диаграмме надо отразить границу main↔worker).
   - Порядок: `upsertSource` строго перед `startIngest`, `aggregateMinuteBuckets` строго после INSERT batch внутри той же транзакции.
   - Что `onChange` → `subscribeChanges` callback → `refresh()` — это **обратная сторона** одной и той же RPC-связи (push, не call).
2. **Mermaid render check**:
   - Открыть файл в VSCode preview (или GitHub.dev) — диаграмма рендерится, нет syntax-ошибок.
   - Запустить `pnpm dev` и пройти один полный сценарий из диаграммы (Add source → scroll), убедиться что нет шагов, которых в коде нет, и нет шагов в коде, которые не отражены.
3. **Tests**: тестов на этот файл нет (это документ). `pnpm test --run`, `pnpm lint`, `npx tsc -b` всё равно гоняем — изменения не должны затронуть код.
4. **Ревью самого Mermaid**: для каждой sequenceDiagram задействовать participants (alias'ы) консистентно между диаграммами — `User`, `UI`, `Store`, `Coord`, `Parsers`, `Indexer`, `Storage` — чтобы реdader мог переключаться между диаграммами без переустановки контекста.
