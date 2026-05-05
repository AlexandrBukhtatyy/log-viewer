## 0015. Directory source: per-file LogLineFrame, fields.file_path, filter.filePaths

- Status: proposed
- Date: 2026-05-05

## Context and Problem Statement

[ADR-0010](0010-lv-on-viewstore-core-types.md) поднял `directory`-источник
до прод-сценария, но контракт между адаптером и ingest-pipeline'ом не
переносил никакой per-line metadata. [directory-adapter](../../src/core/sources/directory-adapter.ts)
читал только верхний уровень папки, сливал все файлы в один поток
`ReadableStream<string>`, и в индексе оставался один `entry.source_id`
для всей директории — путь файла внутри неё нигде не сохранялся.

Сайдбар, соответственно, рисовал директорию **одной leaf-нодой** под
«Local files». Пользователь не мог отфильтровать конкретный файл внутри
открытой папки. Для UI это критично: открывая `~/logs/myapp/`, я хочу
видеть `app.log`, `sub/access.log`, `sub2/c.log` отдельно и щёлкать по
ним по одному.

Альтернатив было две:

- **A. Sub-source-id per file** — `entry.sourceId = <dirId>:<pathHash>`.
  Каждый файл — своя сущность в `sources`. Минус: ломает
  [ADR-0006](0006-persistence-strategy.md) handle-store (одна запись
  на handle, не на файл) и `removeSource`/`reIndex` поверх него; нужно
  переписывать persistence + ingest restart.
- **B. Один `source_id` per directory + `fields.file_path`** — путь
  кладётся в JSON-поле, фильтруется через `JSON_EXTRACT`. Persistence
  не трогаем; UI по-прежнему видит одну запись в `sources`, а файлы
  внутри неё — синтетические узлы дерева.

## Decision Outcome

Выбрано **«B»**.

### Adapter contract: `LogLineFrame`

[src/core/sources/source-adapter.ts](../../src/core/sources/source-adapter.ts):

```ts
export interface LogLineFrame {
  readonly path: string | null;
  readonly line: string;
}
open: (signal: AbortSignal) => Promise<ReadableStream<LogLineFrame>>;
```

`path` — forward-slash relative path внутри корня источника, или `null`
для источников без вложенной структуры (file/text/url/stream).
[snapshot-adapter](../../src/core/sources/snapshot-adapter.ts)
эксплуатирует то же поле для имён файлов внутри архива.

5 «no-substructure»-адаптеров (file/text/url/stream) заворачивают свой
существующий `ReadableStream<string>` через `tagLineStream(s, null)`
helper. [directory-adapter](../../src/core/sources/directory-adapter.ts)
переходит на recursive walk через новый общий
[walkDirectory](../../src/core/sources/walk-directory.ts) (depth-first,
alphabetical, abortable) и эмитит per-file `path`. snapshot-adapter
делает то же для членов архива.

### Ingest pipeline

[chunker](../../src/workers/coordinator/ingest/chunker.ts) теперь
**path-homogeneous**: на смене `path` текущая batch flush'ится, и
следующая стартует с новым path. Каждый emit — `{path, lines}`.
Гарантирует что один parse-вызов работает с одним файлом, и его
`filePath` корректно ассоциируется со всеми вытекающими entries.

[parser.contract.ts](../../src/core/rpc/parser.contract.ts) расширен
полем `ParseRequestCtx.filePath?: string`. [parser-api worker](../../src/workers/parser/parser-api.ts)
после получения entry от парсера stamping'ует
`entry.fields.file_path = ctx.filePath` — это **post-parse mutation**,
без необходимости менять каждый из 3 парсеров (json-lines/plain-text/registry).

### Filter: `LogFilter.filePaths`

[log-filter.ts](../../src/core/types/log-filter.ts) получает поле,
симметричное `services`:

```ts
readonly filePaths: ReadonlyArray<string> | null;
```

[buildClause](../../src/core/filter/query.ts):
```sql
JSON_EXTRACT(fields_json, '$.file_path') IN (?, ?, ...)
```

Тест в [query.test.ts](../../src/core/filter/query.test.ts) — 1 кейс.

### UI: дерево из dirHandle, compound id

Новый хук [useDirectoryTrees](../../src/hooks/use-directory-trees.ts):
для каждого live `directory`-source делает recursive walk handle и
кэширует `LvFolderNode`-дерево. Каждый узел дерева — file или folder —
получает compound id:

- `<sourceId>::<relPath>` — файл внутри директории.
- `<sourceId>::<relPath>/` — папка (trailing slash).
- `<sourceId>` (без `::`) — сам корень источника (legacy для
  не-directory kinds).

[buildCatalogTree](../../src/ui/utils/build-catalog.ts) принимает
второй опциональный аргумент `directoryTrees: Record<SourceId, LvFolderNode>`
и вставляет walked-tree вместо плоского `LvFileNode` для directory.
Source-level флаги (`live`, `count`, `needsPermission`, `errorMessage`)
сохраняются на root-folder'е дерева.

### Container: проекция selection

[LvAppContainer](../../src/app/containers/LvAppContainer.tsx) парсит
`selectedIds` по разделителю `::`:
- non-compound id → `filter.sources`.
- compound id → `filter.sources` (часть до `::`) **плюс**
  `filter.filePaths` (часть после, если это файл — не folder и не пусто).

`activeTabId` фильтрует selected-set по `sid === activeTabId`, поэтому
табы остаются per-source, а внутри-табы файлы выбираются нормально.

### ESLint relaxation: hooks → ui, type-only

`useDirectoryTrees` возвращает `LvFolderNode` — UI-shape. Раньше [ADR-0002
§Adapter-слой](0002-headless-architecture.md) запрещал hooks любые
импорты из `ui/`. Это перебор — runtime деп всё ещё запрещена, а
type-import безопасен и единственный осмысленный способ описать форму
возврата хука.

[eslint.config.js](../../eslint.config.js) — `FORBID_LAYER` принимает
опцию `{ allowTypeImports: true }`; `RULES_HOOKS` использует её.
Сообщение об ошибке обновлено: «Type-only imports are allowed».

Это **уточнение** ADR-0002, не отказ. Runtime hooks→ui по-прежнему
запрещён.

### Consequences

- Good: дерево источника совпадает со структурой каталога, per-file
  filter работает идиоматично через существующий `JSON_EXTRACT`.
- Good: persistence (handle-store) и `removeSource`/reIndex без
  изменений — directory остаётся одной сущностью.
- Good: `path` в frame расширяемо: future watcher сможет дописывать
  новые frames с тем же path и попадать в правильный indexer-source без
  каких-либо изменений API.
- Bad: walk на main thread. Для больших каталогов (10k+ файлов) UI
  заметно тормознёт во время первого build'а дерева. Acceptable для
  типичных лог-папок (~10–500 файлов); план на офлоад в worker —
  отдельный ADR.
- Bad: folder-level выбор пока не делает «select all children» — это
  чисто UI-affordance, оставлено в out-of-scope. Сейчас пользователь
  кликает per-file или Select all в корне.
- Bad: snapshot-adapter теперь не использует `createLineSplitter`
  (содержимое архива уже в memory, прямой `text.split('\n')`).
  Один тест-кейс в snapshot-adapter уже проверяет правильную обработку
  trailing newline.
- Neutral: bundle прирастает на ~1 KiB gzipped (helper + хук).

### Откат

Если walk на main thread окажется проблемой — введём lazy «walk on
expand»: `useDirectoryTrees` walk'ит только expand'нутые папки, не
сразу весь handle. API хука и compound-id schema не меняются.

## Links

- [ADR-0002](0002-headless-architecture.md) — слои; этот ADR ослабляет
  hooks→ui до type-only, формально уточняя §Adapter-слой.
- [ADR-0006](0006-persistence-strategy.md) — handle-store, не тронут.
- [ADR-0010](0010-lv-on-viewstore-core-types.md) — first wiring directory;
  этот ADR расширяет shape данных (`LogLineFrame`, `fields.file_path`,
  `filter.filePaths`).
- [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md)
  — план, по которому шла работа.
