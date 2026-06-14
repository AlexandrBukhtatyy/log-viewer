# Приоритизация индексации по фокусу пользователя

## Контекст

Сейчас типовой сценарий «добавил большую директорию → хочу посмотреть один файл» работает плохо: координатор стартует один `ingestSource()` на всю директорию, директорийный адаптер строго алфавитно идёт по файлам, парсер-воркеры выгребают батчи из общей **FIFO**-очереди без приоритетов. Пока интересующий файл не дойдёт до своей очереди — пользователь смотрит на спиннер, хотя его файл может лежать ниже большого `large.jsonl`, который сейчас греет CPU.

Цель: чтобы открытие файла из ещё индексируемого ресурса давало почти мгновенный отклик, а выделение подмножества файлов двигало их в начало очереди индексации.

Решение — **focus-сигнал из UI → координатор → parser-pool (две очереди) + directory-adapter (reorder файлов с прерыванием)**.

Принятые решения по UX/семантике:

- Прерывать текущий файл при смене focus с резюме по `byteOffset` после возврата.
- 1 reserved-слот пула под normal — гарантирует прогресс фоновой индексации даже когда hot-задач много.

### Что уже произошло до этого плана (контекст последних коммитов)

В ветке между первоначальной версией плана и сейчас были вмержены ускорения инжеста, которые **не реализуют приоритизацию, но меняют базовые условия**:

- `recommendedPoolSize()` теперь возвращает `min(max(cores-1, 1), 8)` ([parser-pool.ts:196-199](src/workers/coordinator/pool/parser-pool.ts#L196-L199)). На 8+ ядрах cap = 8 — reserved-slot становится 1 из 8 (~12% пропускной), хороший баланс.
- Динамический change throttle: `CHANGE_THROTTLE_MS_IDLE = 500`, `CHANGE_THROTTLE_MS_INGEST = 1500` ([coordinator.ts:426-441](src/workers/coordinator/coordinator.ts#L426-L441)). Наш план это не трогает — focus-сигнал идёт в обход этого механизма, через отдельный путь к адаптеру/пулу.
- Bulk INSERT (256/stmt) в indexer-api + pre-serialize `fields_json` в parser-worker. Это снимает нагрузку с индексера, но не меняет логику очереди парсер-пула.

То есть симптом «спиннер минутами» сейчас короче по времени, но **порядок** обработки по-прежнему FIFO + алфавит. План остаётся валидным.

## Контракты (новые/изменённые)

### Focus RPC

[src/core/rpc/coordinator.contract.ts](src/core/rpc/coordinator.contract.ts):

```ts
export interface FocusInput {
  /** Источники, на которые сейчас смотрит пользователь (active tab + selected). */
  readonly sources: ReadonlyArray<SourceId>;
  /** Конкретные файлы внутри директорийных источников — относительные пути как в LogLineFrame.path. */
  readonly filePaths: ReadonlyArray<string>;
}

interface CoordinatorApi {
  // ...
  setFocus(input: FocusInput): Promise<void>;
}
```

Семантика: focus — это «hint», а не директива. Координатор хранит последний snapshot, idempotent, частый вызов — норма.

### Parser-pool priority

[src/workers/coordinator/pool/parser-pool.ts](src/workers/coordinator/pool/parser-pool.ts):

```ts
export type ParserPriority = 'hot' | 'normal';

interface PendingRequest {
  resolve: (slot: PoolSlot) => void;
  priority: ParserPriority;
}

class ParserPool {
  async withWorker<T>(
    fn: (proxy) => Promise<T>,
    priority: ParserPriority = 'normal',
  ): Promise<T>;
}
```

### Adapter focus side-channel

[src/core/sources/source-adapter.ts](src/core/sources/source-adapter.ts) — добавить опциональный метод:

```ts
export interface LogSourceAdapter {
  readonly source: LogSource;
  open(signal: AbortSignal): Promise<ReadableStream<LogLineFrame>>;
  close(): Promise<void>;
  /** Hot-список путей для reorder/preemption. Реализуют только адаптеры, у которых это имеет смысл (directory). */
  setHotPaths?(paths: ReadonlySet<string>): void;
}
```

### Ingest orchestrator: приоритет на батч

[src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts) — расширить `IngestParams`:

```ts
interface IngestParams {
  // ...существующие поля
  /** Колбэк, вызывается перед каждым parserPool.withWorker — возвращает приоритет текущего батча. */
  readonly getPriority: (filePath: string) => ParserPriority;
}
```

## Изменения по файлам

### 1. Parser-pool: две FIFO + reserved-slot ([parser-pool.ts](src/workers/coordinator/pool/parser-pool.ts))

- Заменить `waiters: PendingRequest[]` на `hotWaiters` + `normalWaiters`.
- Расширить `withWorker(fn, priority='normal')` и `acquire(priority)`.
- В `release(slot)` — алгоритм передачи слота:
  1. `freeSlots = maxSize - busyCount` после освобождения.
  2. Если есть `hotWaiters` и `(busyHotCount < maxSize - 1 || normalWaiters.length === 0)` → отдать hot.
  3. Иначе если есть `normalWaiters` → отдать normal.
  4. Иначе → armReap.
- Поле `busyHotCount` ведём счётчиком, инкремент в `markBusy`, декремент в `release` до раздачи следующему waiter'у.
- Идея reserved-slot: пока хоть одна normal-задача ждёт, hot-задачи не могут занять последний свободный слот.

### 2. Координатор: focus + проброс ([coordinator.ts](src/workers/coordinator/coordinator.ts))

- Новое состояние:
  ```ts
  let currentFocus: { sources: Set<SourceId>; filePaths: Set<string> } = {
    sources: new Set(),
    filePaths: new Set(),
  };
  ```
- Реализовать `setFocus(input)`:
  - Обновить `currentFocus`.
  - Для каждого активного источника, у которого адаптер поддерживает `setHotPaths`, передать релевантное подмножество путей (`paths`, у которых `pathInSource(source, p)`).
- В `startIngest` ([coordinator.ts:559+](src/workers/coordinator/coordinator.ts#L559)):
  - Сохранить ссылку на созданный адаптер в `SourceEntry.adapter` чтобы потом дёрнуть `setHotPaths`. `SourceEntry` объявлен на [coordinator.ts:45](src/workers/coordinator/coordinator.ts#L45).
  - Передать в `ingestSource` параметр `getPriority: (filePath) => isHot(source.id, filePath) ? 'hot' : 'normal'`.
  - Функция `isHot(sourceId, filePath)`:
    - если `currentFocus.sources.has(sourceId)` и (`filePath === ''` или `currentFocus.filePaths.has(filePath)` или `filePaths` пустой Set) → `'hot'`.
    - иначе `'normal'`.
- Сразу после `startIngest` — если focus уже включает этот source, позвать `adapter.setHotPaths?` с релевантными путями.
- Динамический change-throttle ([coordinator.ts:426-441](src/workers/coordinator/coordinator.ts#L426-L441)) не трогаем — он отвечает за частоту `count()`, не за порядок парсинга.

### 3. Ingest orchestrator: приоритет на батч ([ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts))

В местах вызова `parserPool.withWorker(...)` (детекция парсера на первом батче, основной цикл, EOF-флаш) — пробросить приоритет:

```ts
const priority = getPriority(path);
const entries = await parserPool.withWorker(
  (p) => p.parse(folded, ctx),
  priority,
);
```

Аналогично для `detectParser` / `getParserMeta` — детекция должна идти с тем же приоритетом, что и первый батч.

### 4. Directory adapter: hotPaths + reorder + preemption ([directory-adapter.ts](src/core/sources/directory-adapter.ts))

Текущая реализация: один `ReadableStream`, внутри которого `for await (const entry of walkDirectory(...))` — последовательное чтение алфавитно. Для preemption нужно отделить «план обхода» от «текущего чтения»:

Новая модель:

- На `open()` — собрать **полный список файлов** через `walkDirectory` сразу (это дёшево: только обход FS, без чтения содержимого). Получим `plan: FileTask[]` где `FileTask = { path, handle, byteOffset: 0, done: false }`.
- Состояние в адаптере: `plan: FileTask[]`, `hotPaths: Set<string>`, `currentTask: FileTask | null`, `wakePreempt: () => void`.
- Селектор следующего файла:
  - Сначала — первый незавершённый task с `hotPaths.has(path)`.
  - Иначе — первый незавершённый task в plan-порядке (алфавитно, как сейчас).
- Реализовать `setHotPaths(paths)`:
  - Сохранить `hotPaths = new Set(paths)`.
  - Если есть `currentTask` и `!hotPaths.has(currentTask.path)` и есть незавершённый task в `hotPaths` — **прервать текущее чтение** (через локальный `AbortController` файла), сохранить `currentTask.byteOffset` = последний прочитанный `byteEnd + 1`, выставить `currentTask.done = false`, разбудить цикл.
- Чтение файла:
  - Открыть `handle.getFile()`, использовать `file.slice(currentTask.byteOffset).stream()` если резюмируем.
  - При reume `byteOffset` нужно пробросить в `createByteLineSplitter(path, baseOffset)` чтобы `byteStart/byteEnd` остались корректными относительно файла (см. ниже про `byte-line-splitter`).
  - На каждый успешно прочитанный frame обновлять `currentTask.byteOffset = frame.byteEnd + 1`.
  - На EOF файла — `currentTask.done = true`, переход к селектору.
  - На preemption-abort — currentTask остаётся в plan с обновлённым `byteOffset`, цикл выбирает hot-кандидата.

### 5. Byte-line-splitter: base offset ([byte-line-splitter.ts](src/core/sources/byte-line-splitter.ts))

Уже сейчас принимает `path`. Расширить сигнатуру до `createByteLineSplitter(path, baseByteOffset = 0)` — стартовать `byteStart` с `baseByteOffset` вместо 0. Это нужно чтобы при резюме `byteStart` отражал реальную позицию в файле (важно для `getEntry` / lazy resolver, который слайсит файл по `byteStart..byteEnd`).

### 6. UI: пробрасывать focus ([LvAppContainer.tsx](src/app/containers/LvAppContainer.tsx))

В контейнере уже есть `activeTabId` и `selectedIds` ([строки 90-181](src/app/containers/LvAppContainer.tsx#L90-L181)). Добавить `useEffect`, который при их изменении вычисляет focus и шлёт его координатору:

```ts
useEffect(() => {
  const { sourcesArr, filePaths } = tabSelection();
  const allSelectedSources = splitSelection(selectedIds, null).sources;
  // Union: то, что в активной вкладке + все выделенные.
  const sources = unique([...sourcesArr, ...allSelectedSources]);
  void api.setFocus({ sources, filePaths });
}, [activeTabId, selectedIds]);
```

Обёртка `setFocus` добавляется в [src/worker-client/log-client.ts](src/worker-client/log-client.ts) рядом с другими `api()`-методами.

### 7. SourceEntry: ссылка на адаптер

[coordinator.ts:45-60](src/workers/coordinator/coordinator.ts#L45) — добавить поле `adapter: LogSourceAdapter | null` в `SourceEntry`, заполнять в `startIngest`. Это чтобы `setFocus` мог вызвать `entry.adapter?.setHotPaths(paths)` для активных источников.

## Что НЕ трогаем

- Indexer и схема SQLite — никаких изменений. Записи приходят с тем же `byteStart`/`byteEnd`, просто в другом порядке.
- Подписки `subscribeStatus` / `subscribeChanges` — без изменений, UI продолжает обновляться по существующему механизму.
- `ingestSource` лайфцикл (`onStatus`, `onChange`, `onParserDetected`, отмена) — без изменений.
- Адаптеры file/text/url/stream — `setHotPaths` опциональный, они его не реализуют (для них priority всё равно эффективен через parser-pool).
- Дедупликация записей — не требуется, потому что preemption делается на границе уже отданных frame'ов (после `byteEnd + 1`), повторно те же байты не пройдут.

## Тонкие места

1. **Гонка preemption**: между моментом проверки `signal.aborted` в адаптере и переходом к hot-файлу может проскочить ещё пара батчей старого файла. Это ок — frame'ы из них корректно проиндексируются, currentTask.byteOffset просто продвинется.
2. **Detection парсера для hot-файла**: если первый файл в hot — у источника ещё нет `parserId`. Орчестратор детектит парсер на первом непустом батче (`parserId === null`), и hot-батч даёт детект → дальше парсер закреплён. Если потом приходит batched-файл из normal с другим форматом — он будет парситься как auto-detected, что и сейчас так работает (вся директория считается одним источником с одним парсером).
3. **`fileSeqByPath`** ([ingest-orchestrator.ts:109-115](src/workers/coordinator/ingest/ingest-orchestrator.ts#L109-L115)) — Map per-path, продолжает корректно нумеровать record'ы внутри каждого файла независимо от порядка чтения. Никаких изменений не требует.
4. **`continuationRegex` многострочные**: фолдинг ведётся per-source с проверкой `openPath !== path` — при preemption на другой файл `flushOpen(out)` корректно дофлашит открытый record до перехода. Это уже реализовано ([ingest-orchestrator.ts:152-158](src/workers/coordinator/ingest/ingest-orchestrator.ts#L152-L158)).
5. **Reserved slot при `maxSize === 1`**: на машинах с одним ядром `recommendedPoolSize() = 1`. Тогда reserved-логика выродится: hot вообще не имеет преимущества, нормальный FIFO. Это допустимо — задача про многоядерные UX-кейсы. На современных машинах после commit'а `2c50d60` cap = 8, и reserved-slot — это 1/8 пула.
6. **Bulk INSERT в indexer** ([indexer-api.ts insertBatch](src/workers/indexer/indexer-api.ts)) пишет 256 строк за один statement. Это не мешает приоритизации (приоритизация — на входе в парсер-пул, до индексера), но означает что эффект preemption на «время первой видимой строки» зависит от того, успел ли hot-файл накопить хотя бы один батч до того, как normal-батчи встанут в очередь indexer'а. На практике ~1000 строк × parser-задержка → один батч уйдёт в indexer быстро.

## Verification (end-to-end)

1. `pnpm gen:fixtures` — создаёт `.tmp/large.jsonl` (~6.5 MB, 50K строк) и пачку мелких файлов рядом.
2. `pnpm dev`, открыть `/log-viewer/app/`.
3. Добавить ресурс — директория `.tmp/`. Сразу выделить в сайдбаре только `app.log` (маленький, идёт после `large.jsonl` алфавитно).
4. **Ожидание**: `app.log` показывает строки в первые сотни мс; `large.jsonl` имеет `entriesIndexed > 0` но индексируется медленнее.
5. Снять выделение → переключиться на пустую вкладку. **Ожидание**: `large.jsonl` снова забирает основную долю воркеров, дочитывается до конца.
6. Тест-кейс «два ресурса»: добавить две директории подряд, выделить пару файлов в одной из них — выделенные ресурсы должны достигать `done` раньше второго.
7. DevTools-проверка: `await api.listSources()` показывает рост `entriesIndexed` у горячего быстрее.

Если поправляется юнит-тестами — добавить в `src/workers/coordinator/pool/parser-pool.test.ts` (создать) кейсы:

- два hot-waiter'а на пуле из 2 → оба занимают слоты, но если приходит normal-waiter — последний hot ждёт пока освободится reserved-slot? Уточнить тестом семантику.
- normal не запускается дальше hot если все слоты заняты hot — кроме случая, когда normal-waiter уже стоял первым.

## Файлы, которые меняются

- [src/core/rpc/coordinator.contract.ts](src/core/rpc/coordinator.contract.ts) — `FocusInput`, `setFocus`.
- [src/worker-client/log-client.ts](src/worker-client/log-client.ts) — обёртка `setFocus`.
- [src/app/containers/LvAppContainer.tsx](src/app/containers/LvAppContainer.tsx) — useEffect шлёт `setFocus`.
- [src/workers/coordinator/coordinator.ts](src/workers/coordinator/coordinator.ts) — `currentFocus`, `setFocus`, `isHot`, проброс `getPriority` в orchestrator, проброс `setHotPaths` в адаптер.
- [src/workers/coordinator/pool/parser-pool.ts](src/workers/coordinator/pool/parser-pool.ts) — две очереди + reserved-slot, `withWorker(fn, priority)`.
- [src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts) — `getPriority` в `IngestParams`, проброс приоритета в `parserPool.withWorker`.
- [src/core/sources/source-adapter.ts](src/core/sources/source-adapter.ts) — опциональный `setHotPaths`.
- [src/core/sources/directory-adapter.ts](src/core/sources/directory-adapter.ts) — план обхода, reorder, preemption, резюме по byteOffset.
- [src/core/sources/byte-line-splitter.ts](src/core/sources/byte-line-splitter.ts) — параметр `baseByteOffset`.

## Что обсудить отдельно (вне этого плана)

- Стоит ли добавлять `ADR-NNNN` про focus-driven prioritization (нетривиальное архитектурное решение — пробрасываем UI-state в worker pipeline). По духу [CLAUDE.md#architecture-decision-records](CLAUDE.md) — да, ADR имеет смысл. Создавать после согласования реализации.
- В будущем можно расширить focus-сигнал на «visible range» (виртуализированный скролл) — для приоритизации lazy-resolver'а, но это уже про read-path, не про ingest.
