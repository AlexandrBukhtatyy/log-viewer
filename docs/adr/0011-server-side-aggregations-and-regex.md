## 0011. Server-side aggregates (group/histogram) и regex queryMode через REGEXP UDF

- Status: proposed
- Date: 2026-05-02

## Context and Problem Statement

После [ADR-0010](0010-lv-on-viewstore-core-types.md) UI работал с реальным
worker-pipeline, но три вещи остались на клиенте или вовсе не работали:

1. **regex queryMode** в [src/core/filter/query.ts](../../src/core/filter/query.ts)
   silently dropped — wa-sqlite/sqlite-wasm не имеет встроенного `REGEXP`.
2. **Группировка** в LvViewer считалась клиентом через `lvBuildGroups` поверх
   массива `LogEntry[]`. С виртуализованным окном из [useLogWindow](../../src/hooks/use-log-window.ts)
   полного массива на клиенте нет — группа считалась только из загруженных
   200-300 строк, и группа в 50k не отображалась как 50k.
3. **Гистограмма** в [LvTimeline](../../src/ui/components/timeline/LvTimeline.tsx)
   тот же конфликт: клиентский bucket'инг по `entries: LogEntry[]` дал бы
   правильный результат только если все entries попали в окно.

Эти три проблемы решаются по одной схеме — переносом агрегации на сторону
indexer-воркера, где есть весь dataset в SQLite. План фиксирует это
[Phase 2](../plans/replicated-cooking-muffin.md#phase-2--regex-и-group-by-на-сервере-p1).

## Considered Options

- **A. Перенести агрегацию в indexer (через расширение `IndexerApi`/`CoordinatorApi`),
  а regex — JS-функцией через `db.createFunction('regexp', …)`.**
- **B. Загружать полный отфильтрованный dataset в main thread по требованию.**
  Не делаем — на 1M строк это OOM в main thread и блокирующий transfer.
- **C. Считать группы по виртуализованному окну, отдавая «approximate counts».**
  Не делаем — пользователь не различит «50k errors in this trace» и «47k errors».

## Decision Outcome

Выбрано **«A»**.

### REGEXP UDF в indexer-DB

[src/workers/indexer/db/open-db.ts](../../src/workers/indexer/db/open-db.ts)
после `openDb()` регистрирует две функции:

- `regexp(pattern, text)` — case-sensitive (флаги `''`).
- `regexpi(pattern, text)` — case-insensitive (флаги `'i'`).

Скомпилированные `RegExp` кэшируются по `flags|pattern` — повторные вызовы
для разных строк не пересобирают регэксп. Невалидный паттерн возвращает `0`
(no match) — это сохраняет SQL-запрос живым на typo в search-боксе вместо
exception во весь worker.

[src/core/filter/query.ts](../../src/core/filter/query.ts) теперь:

- `queryMode='regex'` → `regexp(?, message)` или `regexpi(?, message)` в
  зависимости от `caseSensitive`. С `wholeWord` пользовательский паттерн
  оборачивается в `\b(?:<pattern>)\b` — non-capturing group, чтобы
  альтернация (`foo|bar`) не «съела» границы слова.
- `queryMode='substring'` + `wholeWord=true` → больше не fallback на
  «sentinel-spaces LIKE», а сразу `regexp/regexpi` с `\b<escaped>\b`. То
  есть «whole word» теперь корректно матчит границы у пунктуации
  (`foo.bar` matches `foo`), а не только у пробела.

### Server-side group counts

[CoordinatorApi.getGroupCounts(filter, field, limit?)](../../src/core/rpc/coordinator.contract.ts)

- [IndexerApi.groupCounts](../../src/core/rpc/indexer.contract.ts):

* `field` — whitelist `^[A-Za-z_][A-Za-z0-9_]*$` (см.
  [aggregate.ts](../../src/workers/indexer/aggregate.ts) `groupFieldExpr`).
  `level` / `source_id` мапятся на колонки entry, остальное — на
  `JSON_EXTRACT(entry.fields_json, '$.<key>')`. Whitelist ставит решётку
  против SQL-инъекции в interpolated SQL.
* Возвращает `GroupBucket[]` — `{ value, count, tsMin, tsMax, levelCounts }`,
  где `value === null` означает entries без этого поля. Sort по
  `count DESC, value ASC`, лимит по умолчанию 1000.
* Per-level breakdown через шаблон
  `SUM(CASE WHEN level=? THEN 1 ELSE 0 END) AS lc_<level>` — один проход
  по таблице, никаких дополнительных подзапросов.

UI: при `groupBy.length > 0` контейнер вызывает [`useGroupCounts`](../../src/hooks/use-group-counts.ts)
и пробрасывает `GroupBucket[]` в LvViewer через props
`groupBuckets`/`groupField`/`onGroupDrillDown`. LvViewer заменяет
виртуализованный список на `LvGroupHeader`-ы. Drill-down (Focus) добавляет
`{key: field, op: '=', value: bucket.value}` в `filter.fieldFilters` и
сбрасывает `groupBy` — пользователь видит уже отфильтрованные строки.

### Server-side histogram

[CoordinatorApi.getHistogram(filter, bucketCount)](../../src/core/rpc/coordinator.contract.ts)

- [IndexerApi.histogram](../../src/core/rpc/indexer.contract.ts):

* Range берётся из `filter.timeRange` (если оба бордера заданы) либо из
  `MIN/MAX(ts)` отфильтрованных entries. `null`-ts entries исключены.
* `bucketCount` clamp'ается в `[1, 1000]`, `bucketSize = (to - from) / bucketCount`.
* Bucket index = `MIN(bucketCount-1, FLOOR((ts - from) / bucketSize))` —
  clamp правого края в последний bucket, чтобы entry с `ts === to` не
  выпала на bucketCount.
* Empty bucket'ы (count=0) добавляются JS-постпроцессом для стабильной
  X-оси.

UI: [`useHistogram(80)`](../../src/hooks/use-histogram.ts) запрашивается
только когда `tweaks.timelineOn === true` (иначе `bucketCount=0` и хук
short-circuit'ит). LvTimeline принимает `data: HistogramResponse` напрямую
и не считает bucket'ы локально.

### Что удалено

- [src/ui/utils/lv-filter.ts](../../src/ui/utils/lv-filter.ts) теперь не
  нужен (уже удалён в Phase 1) — `lvBuildGroups` не пишется с нуля.
- `LvGroup` / `LvGroupPathSegment` из [lv-types.ts](../../src/ui/contracts/lv-types.ts)
  удалены — `LvGroupHeader` принимает `GroupBucket` из core RPC.
- Старая клиентская агрегация в `LvTimeline` — заменена на чтение
  `HistogramResponse.buckets[i].levelCounts`.

### Consequences

- Good: цифры на заголовке группы корректны для всего датасета, не для
  загруженного окна.
- Good: regex queryMode работает; whole-word через regex `\b…\b` ловит
  границы у пунктуации, не только у пробела.
- Good: цена rendering'а timeline'а отвязана от размера датасета — 80
  buckets всегда.
- Bad: regex через JS-UDF — построчная компиляция-вызов из SQLite в
  JS-callback. Кэширование RegExp смягчает, но на миллионах строк это
  всё равно дороже, чем нативный SQLite-only LIKE/MATCH. На больших
  датасетах есть смысл показывать прогресс/cancel; формат `cancel`-API
  есть в `CoordinatorApi.cancel()` (Phase 5).
- Bad: nested group-by (multi-level) пока не поддерживается — UI берёт
  только `groupBy[0]`. Drill-down полностью переносит entries в filter, и
  следующий уровень группировки приходится включать вручную. Полноценный
  tree-view вложенных групп — Phase 3+.
- Bad: `GroupBucket` не несёт `services`/`files`/`topMsg` — это требовало
  бы отдельных под-агрегатов. Для Phase 2 minimal — UI показывает только
  count + level breakdown + длительность.
- Neutral: уровень тестового покрытия — unit на helpers
  ([aggregate.test.ts](../../src/workers/indexer/aggregate.test.ts):
  `groupFieldExpr` whitelist, `levelBreakdownSql` shape,
  `collectLevelCounts`) и на расширенный `query.ts`. Полная
  integration-проверка SQL — через ручной smoke в браузере.

## Links

- [ADR-0005](0005-sqlite-fts5-opfs-index.md) — индексер OPFS+FTS5,
  расширяется этим ADR.
- [ADR-0007](0007-state-management-zustand.md) — ViewStore-контракт, к
  которому добавлены actions `getGroupCounts`/`getHistogram`.
- [ADR-0010](0010-lv-on-viewstore-core-types.md) — закрывает Phase 1
  (типы и wiring); этот ADR закрывает Phase 2 (агрегаты + regex).
- [docs/plans/replicated-cooking-muffin.md §Phase 2](../plans/replicated-cooking-muffin.md#phase-2--regex-и-group-by-на-сервере-p1)
  — план, по которому шла работа.
