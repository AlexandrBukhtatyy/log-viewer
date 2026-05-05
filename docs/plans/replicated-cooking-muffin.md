# Directory source: full tree in sidebar + per-file filtering

## Context

Сейчас `directory`-источник в сайдбаре — **одна leaf-нода** под «Local files». [`buildCatalogTree`](../../src/ui/utils/build-catalog.ts) синтетически кладёт в неё имя `source.name` без любой иерархии. Внутри пайплайна [directory-adapter](../../src/core/sources/directory-adapter.ts) читает только верхний уровень каталога и сливает строки всех файлов в один поток — `entry.source_id` одинаковый, путь-внутри-папки нигде не сохраняется.

Пользователь хочет: **дерево источника дублирует структуру каталога** (рекурсивно), и **каждый файл — выбираемый**. Кликнул по файлу — фильтр сужается до строк этого файла; кликнул по папке — toggle всех файлов под ней.

Критично: вопрос «как распределить фильтрацию между `filter.sources` и `filter.fieldFilters`» — Explore-агент подтвердил, что **fields-based** подход идиоматичнее: `entry.source_id` остаётся одним per-directory, а внутри-папки фильтрация идёт через `JSON_EXTRACT(fields_json, '$.file_path')`. Это сохраняет `removeSource`/reIndex-семантику ([ADR-0006](../adr/0006-persistence-strategy.md)) и `handle-store` без изменений.

## Recommended approach

### 1. Adapter contract: discriminated frames

[`LogSourceAdapter.open(signal)`](../../src/core/sources/source-adapter.ts) сейчас возвращает `ReadableStream<string>` (одна строка). Меняем на:

```ts
export interface LogLineFrame {
  /** Relative path inside the source root, or `null` for sources without sub-files. */
  readonly path: string | null;
  readonly line: string;
}
open: (signal: AbortSignal) => Promise<ReadableStream<LogLineFrame>>;
```

Все 11 адаптеров обновляются:
- **file/text/url/stream/snapshot** — заворачивают существующий `ReadableStream<string>` в `pipeThrough(mapper)` с `path: null`. Тривиально.
- **directory-adapter** — главный получатель новой формы (см. §2).
- **stub'ы (remote-ssh/cloud/k8s/bus/db)** — throw-on-open остаётся; форма frame'а обязательна только когда они реально заведутся.

### 2. Recursive directory walk + per-file path

[directory-adapter.ts](../../src/core/sources/directory-adapter.ts) перепишется:

- `walk(handle, prefix='')` рекурсивно через `for await (const entry of handle.values())`. Подкаталоги → `walk(subHandle, prefix + entry.name + '/')`. Файлы → matching по `glob`/default-extension, читаем stream, эмитим frame'ы `{ path: prefix + entry.name, line }`.
- Aborter поведение и текущий ext-whitelist (`*.log/jsonl/ndjson/txt/out/err`) сохраняются.
- При первой ошибке чтения файла — продолжаем с следующим (логируем `console.warn`); не прерываем весь walk. Иначе один сломанный файл уронит ingest всей папки.

### 3. Ingest pipeline: прокидываем `path` в ctx, кладём в `fields.file_path`

[ParseRequestCtx](../../src/core/rpc/parser.contract.ts) расширяется: `filePath?: string`. [ingest-orchestrator](../../src/workers/coordinator/ingest/ingest-orchestrator.ts) теперь:

- Группирует входящий стрим frame'ов **по `path`** перед chunker'ом — каждая batch гомогенна по path. Это либо отдельный `pathChunker(maxLines, maxMs)` (предпочтительно), либо текущий chunker + flush-on-path-change-логика.
- Передаёт `ctx.filePath = path` в `parserPool.withWorker(p => p.parse(lines, ctx))`.
- Парсеры ([src/core/parsers/](../../src/core/parsers/)) при создании `LogEntry` заполняют `fields.file_path = ctx.filePath ?? undefined`. Обновятся 3 парсера (json-lines, plain-text, registry-fallback) — однострочно в каждом, переиспользуя один helper `mergeContextFields(fields, ctx)`.

### 4. `LogFilter.filePaths` + SQL

[LogFilter](../../src/core/types/log-filter.ts) получает `filePaths: ReadonlyArray<string> | null` (симметрично `services`). [buildClause](../../src/core/filter/query.ts):

```sql
JSON_EXTRACT(fields_json, '$.file_path') IN (?, ?, …)
```

`EMPTY_FILTER` обновляется. Тесты в [query.test.ts](../../src/core/filter/query.test.ts) расширяются одним кейсом «filePaths IN clause».

### 5. UI: дерево из `dirHandle`

`buildCatalogTree` остаётся sync, но получает второй параметр — кэш `Record<SourceId, LvFolderNode>` с распарсенным деревом каталога. Walk сам — async, делается в контейнере:

- Новый хук [`useDirectoryTrees(sources)`](../../src/hooks/) — для каждого `directory`-source с status≠permission-required делает recursive walk `source.handle` (filtered тем же ext-pattern, что и адаптер) и кэширует результат. Walk идёт в main-thread (handle live в main + worker; для UI достаточно main). При смене source-set — invalidate соответствующих кэшей.
- LvFileNode.id для файла внутри директории = `${sourceId}::${relativePath}`. Существующий `selectedIds: Set<string>` остаётся плоским, но теперь содержит compound-id'ы.
- Folder-узлы (synthetic, in-tree) генерируются walk'ом как `LvFolderNode` с `id = ${sourceId}::${prefix}` (с trailing `/`), и `children` — file/folder-узлы внутри.
- Корневой узел самого источника — folder с id = source.id (без `::`). Toggle на нём = toggle всех вложенных file-id'ов; см. существующий [`collectFileIds`](../../src/ui/components/sidebar/LvTreeNode.tsx#L19-L21) — он уже рекурсивно собирает ids под node.

### 6. Container: maps `selectedIds` → `filter.sources` + `filter.filePaths`

[LvAppContainer](../../src/app/containers/LvAppContainer.tsx) §`filter` useMemo:

```ts
const sourcesSet = new Set<SourceId>();
const filePaths: string[] = [];
for (const id of selectedIds) {
  const sep = id.indexOf('::');
  if (sep === -1) {
    sourcesSet.add(id as SourceId);
  } else {
    sourcesSet.add(id.slice(0, sep) as SourceId);
    filePaths.push(id.slice(sep + 2));
  }
}
return {
  ...coreFilter,
  sources: sourcesSet.size === 0 ? null : [...sourcesSet],
  filePaths: filePaths.length === 0 ? null : filePaths,
};
```

Если в `filePaths` есть значение `''` (пустой prefix, выбран folder-узел самого корня) — оно уходит и фильтр расширяется до всех файлов под source: эквивалент null. Контейнер чистит такие записи перед записью в фильтр.

### 7. Persistence

[handle-store](../../src/workers/coordinator/handles/handle-store.ts) и `serializeSourceMeta` ([indexer-api.ts](../../src/workers/indexer/indexer-api.ts)) **не меняются** — directory-handle всё ещё единственная сущность. После reload `placeholderFromIndexed` восстанавливает source как раньше; UI снова делает walk и строит дерево.

### Critical files

**Modify:**
- [src/core/sources/source-adapter.ts](../../src/core/sources/source-adapter.ts) — `LogLineFrame`, новый `open`-return.
- [src/core/sources/directory-adapter.ts](../../src/core/sources/directory-adapter.ts) — recursive walk + per-line `path`.
- [src/core/sources/file-adapter.ts](../../src/core/sources/file-adapter.ts), [text-adapter.ts](../../src/core/sources/text-adapter.ts), [url-adapter.ts](../../src/core/sources/url-adapter.ts), [stream-adapter.ts](../../src/core/sources/stream-adapter.ts), [snapshot-adapter.ts](../../src/core/sources/snapshot-adapter.ts) — wrap-в-frame `{ path: null, line }`.
- [src/core/rpc/parser.contract.ts](../../src/core/rpc/parser.contract.ts) — `ParseRequestCtx.filePath?: string`.
- [src/core/parsers/](../../src/core/parsers/) (3 файла + registry) — `entry.fields.file_path` из ctx.
- [src/core/types/log-filter.ts](../../src/core/types/log-filter.ts) — `filePaths`, `EMPTY_FILTER`.
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — IN-clause; [query.test.ts](../../src/core/filter/query.test.ts) — кейс.
- [src/workers/coordinator/ingest/ingest-orchestrator.ts](../../src/workers/coordinator/ingest/ingest-orchestrator.ts) — group-by-path chunker.
- [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts) — принимает `directoryTrees: Record<SourceId, LvFolderNode>`, инлайнит детьми.
- [src/ui/components/sidebar/LvTreeNode.tsx](../../src/ui/components/sidebar/LvTreeNode.tsx) — `collectFileIds` уже работает; `toggleSelect` принимает compound-id (без change).
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — splitting `selectedIds` → sources + filePaths; интеграция `useDirectoryTrees`.

**Create:**
- `src/hooks/use-directory-trees.ts` — async walk + кэш.
- `src/core/sources/walk-directory.ts` — extracted helper (используется и адаптером, и хуком).

### Verification

1. `npx tsc -b`, `pnpm lint`, `pnpm test --run` — все зелёные. Новый кейс в `query.test.ts`. Существующие adapter-тесты (line-splitter / snapshot) обновляются под frame-form.
2. `pnpm build` — bundle растёт незначительно (≤1 KiB gz).
3. Browser smoke (через `.tmp/demo_logs/` или OPFS-mock):
   - Положить структуру `demo/{a.log, sub/b.log, sub/sub2/c.log}`. Open Folder → демо.
   - Сайдбар: «Local files → demo → a.log; sub/ → b.log; sub2/ → c.log». Развернуть.
   - Кликнуть на `a.log` → row-stream показывает только строки из `a.log` (из `app.log`). Status-bar `1 file`.
   - Кликнуть на папку `sub/` → выбраны `b.log` + `c.log`; row-stream — их строки.
   - Снять выбор всех → пустой stream.
   - Reload → структура дерева восстанавливается walk'ом из persisted handle.
   - 0 console errors.

### Out of scope

- Watcher (live tail на изменения в директории) — отдельный план/ADR.
- Drag-rename / move внутри дерева — read-only adapter.
- Большие каталоги (10k+ файлов) — walk на main thread может занять секунды; при необходимости перенесём в worker отдельным шагом.
