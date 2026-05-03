# UI ↔ headless: gap-инвентаризация и план перепривязки `LvApp`

## Context

После [ADR-0009](../adr/0009-mock-default-app.md) дефолтный entry — `<LvApp/>` на mock-фикстуре в [src/dev/log-data-mock.ts](../../src/dev/log-data-mock.ts). Headless-слой (core / hooks / worker-client / workers) живой, под ним лежат рабочие core-парсеры, FTS5-индексер на wa-sqlite + OPFS, source-адаптеры, RPC через Comlink, Zustand-обёртка [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts) и пять хуков-контрактов.

Но: новый UI декомпонован «по дизайну», а не «по контракту хуков», поэтому в нём есть фичи и формы данных, которые headless ЛИБО не умеет, ЛИБО умеет иначе. Цель — **актуализировать headless под UI** и сделать LvApp прод-вьювером.

Подход — **никаких адаптеров между формами**. Где UI и core расходятся — расширяем core (это одно изменение в одной точке), и UI начинает потреблять core-типы напрямую через `import type` (разрешено `allowTypeImports` из [eslint.config.js:69-78](../../eslint.config.js#L69-L78)). Дублирующие UI-типы из [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts) удаляются. Это и проще для рантайма (один формат, без конверсий), и чище в коде (один источник истины для shape'ов).

## 1. Каталог несовпадений

### 1.1 Формы данных

#### `LvFilters` (UI) ↔ `LogFilter` (core)

| Поле | UI ([src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts)) | Core ([src/core/types/log-filter.ts:18](../../src/core/types/log-filter.ts#L18)) | Разрыв |
| --- | --- | --- | --- |
| `levels` | `Set<LvLogLevel>`, 5 значений | `ReadonlyArray<LogLevel> \| null`, 7 значений (+ `fatal/unknown`) | UI расширяется на 7 уровней; форма — массив (не Set). |
| `services` | `Set<string>` | — | Добавить в core как `services: ReadonlyArray<string> \| null` (симметрично `sources`). |
| `query` | `string` | `string` | OK. |
| режим запроса | три `boolean`: `useRegex`, `caseSensitive`, `wholeWord` | enum `queryMode: 'substring'\|'fts'\|'regex'` + `caseSensitive` | Добавить в core `wholeWord: boolean`. UI получает явный select для `queryMode`; кнопка «Match Whole Word» пишет `wholeWord`. |
| `timeRange` | `[number, number] \| null` | `{ from: number\|null; to: number\|null } \| null` | UI переходит на core-форму. |
| `fieldFilters` | `{ key, op: '='\|'!='\|'>'\|'<'\|'~', value }[]` | `{ key, op: 'eq'\|'ne'\|'contains', value }[]?` | Расширить `FieldFilterOp` до символьного набора `'='\|'!='\|'~'\|'>'\|'<'`. UI-натуральные обозначения становятся wire-форматом. |

**Решение — выровнять core под UI, без адаптеров.** Расширить `LogFilter` тремя точечными добавлениями:
- `wholeWord: boolean`
- `services: ReadonlyArray<string> \| null`
- `FieldFilterOp = '=' | '!=' | '~' | '>' | '<'`

После этого `LvFilters` удаляется как тип, UI потребляет `LogFilter` напрямую. Toggle уровней через `levels.includes(L) ? levels.filter(...) : [...levels, L]` — нативный массив, без Set.

#### `LogEntry` (core) ↔ `LvLogEntry` (UI)

| Поле UI | Поле core | Решение |
| --- | --- | --- |
| `id` | `id: EntryId` | OK (branded string). |
| `fileId` | `sourceId: SourceId` | UI переименовывает доступ на `sourceId`. |
| `file`, `path`, `kind` | — | Не дублируем в entry. UI берёт из `filesById[entry.sourceId].name/path/kind` — родительский prop. |
| `line` | `seq: number` | Один и тот же концепт; UI рендерит как «line». |
| `ts` (ISO string) | `timestamp: number \| null` | UI работает с числом; форматтер `lvFmtTime(timestamp, showDate?)` принимает `number \| null`. |
| `level` | `level: LogLevel` | Идентично после расширения UI до 7 уровней. |
| `service` | `fields.service` | UI уже по сути читает `entry.fields[...]` — продолжает. Если `service` нет в fields — fallback на `filesById[sourceId].service`. |
| `msg` | `message` | Переименовать вызовы в UI. |
| `fields`, `raw` | `fields`, `raw` | OK. |
| `stack?` | — | Парсер stacktrace кладёт `stack: string[]` в `entry.fields.stack` — UI читает оттуда при `kind === 'stacktrace'`. |

**Решение — `LogEntry` НЕ трогаем.** UI потребляет его напрямую. Потребуется правка вызовов в Lv*-компонентах (`entry.msg → entry.message`, `entry.ts → entry.timestamp`, `entry.line → entry.seq`); поля `file/path/kind` берутся через lookup `filesById`. `LvLogEntry` удаляется.

#### Каталог источников

UI рендерит дерево `LvCatalogRoot[]` с детьми-папками-файлами. Headless даёт **плоский** `SourceRecord[]` через `useSourceStatus()`. Гэп — реконструкция дерева из плоского списка.

**Решение — утилита `buildCatalogTree(sources: SourceRecord[]): LvCatalogRoot[]`** в [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts). Группирует по `source.kind`, маппит `SourceStatus` → `LvFolderNode`/`LvFileNode` бейдж, `live`, `newCount`. Это **строитель UI-дерева**, не адаптер: формы entry/filter он не трогает.

Долгосрочно для `directory`-источников можно отдавать реальную иерархию из `dirHandle` — отдельная итерация (Phase 4 ниже).

#### Бренды

UI работает с обычными `string` для id. Core — с branded `EntryId`/`SourceId`. После удаления LvLogEntry все компоненты получают branded типы напрямую — runtime тот же `string`, разница только на уровне TS, проблем не будет.

### 1.2 Что core/workers не умеют сегодня

Подтверждено чтением [src/core/filter/query.ts:64](../../src/core/filter/query.ts#L64) и [src/core/rpc/coordinator.contract.ts:32-72](../../src/core/rpc/coordinator.contract.ts):

| Возможность | Состояние | Phase |
| --- | --- | --- |
| `queryMode='regex'` | silently dropped в `buildClause` | Phase 2 (REGEXP UDF в wa-sqlite) |
| `fieldFilters` в SQL | не реализованы (комментарий «после MVP, через JSON_EXTRACT») | **Phase 1** |
| `wholeWord` | в core нет | **Phase 1** (через `\b`-обёртку для substring) |
| `services` | нет | **Phase 1** (новое поле + `IN`-clause через JSON_EXTRACT) |
| Числовые операторы `>`, `<` | нет | **Phase 1** (новые `FieldFilterOp` + CAST) |
| `coordinator.reIndex(id)` | `notImplemented` | Phase 5 |
| `coordinator.resumePersistedSources()` | `notImplemented` | Phase 4 (нужно для directory persistence) |
| `coordinator.grantPermission(id)` | `notImplemented` | Phase 4 |
| `coordinator.exportFiltered(filter, format)` | `notImplemented` | Phase 5 |
| `coordinator.cancel(taskId)` | `notImplemented` | Phase 5 |
| Группировка на сервере | нет API | Phase 2 (`getGroupCounts`) |
| Гистограмма по time-buckets | нет API | Phase 2 (`getHistogram`) |
| Live-tail end-to-end | компоненты есть, не верифицирован полностью | Phase 3 (smoke-проверка) |

### 1.3 Концептуальные конфликты

#### Группировка vs виртуализация

UI группирует через [`lvBuildGroups`](../../src/ui/utils/lv-filter.ts) поверх массива `filtered: LogEntry[]`. Core отдаёт **виртуализованное окно** (`useLogWindow.getRow(i)` → undefined для не-загруженных) — полного массива на клиенте нет.

**Решение** (Phase 2): серверная группировка — новый метод `coordinator.getGroupCounts(filter, fields, parent?)`. UI рендерит заголовки групп из агрегатов; entries внутри группы — отдельным окном по уточнённому фильтру (`filter.fieldFilters += group.path`).

#### Timeline vs виртуализация

`LvTimeline` принимает `entries: LogEntry[]` и считает гистограмму по 80 buckets. Тот же конфликт. **Решение** (Phase 2): серверный `coordinator.getHistogram(filter, buckets)`.

#### Selectability файла vs `filter.sources`

`LvApp.selectedIds: Set<string>` и `LvApp.activeTabId: string` — UI-state в контейнере. Маппинг в `filter.sources` тривиальный:
```ts
filter.sources = activeTabId === '__all__' ? [...selectedIds] : [activeTabId]
```
Контейнерная склейка, не headless-доделка.

#### Find-in-table

`LvViewer` имеет find-in-table (cmd+F) с собственным regex по уже отрендеренным строкам. С виртуализацией — матчи только в видимом окне. Решение в Phase 5: либо ограничиться окном (как сейчас), либо превратить в серверный поиск с подсветкой.

### 1.4 UI-only фичи (headless не нужен)

| Фича | Где | Что нужно |
| --- | --- | --- |
| Tweaks (theme/density/accent/wrap/showDate/timelineOn) | LvApp local state, ставит CSS-vars | Persistence через `localStorage` — `useUiPrefs` хук. |
| Recent files | LvApp `recentFiles` | `localStorage`, top 10. |
| Saved searches | LvApp `savedSearches` | `localStorage`. |
| Bookmarks | LvApp `Set<EntryId>` | `localStorage`. **Caveat:** `EntryId` меняется при reload источника — bookmarks устаревают. В Phase 4 заменить на стабильный fingerprint. |
| Closed tabs | LvApp `closedTabs: Set<id>` | UI-only, можно не персистить. |
| AI panel | `onAiComplete` prop | Внешняя интеграция (Anthropic API), отдельный ADR. |
| Alerts panel | stub | Будущее. |
| Open-at-line external editors | `vscode://`, `cursor://`, … | URI scheme, никакой headless-работы. |
| Find-in-table | LvViewer local state | Уже работает, см. §1.3. |

### 1.5 Источники: 10 типов в UI vs 5 адаптеров в core

[src/core/sources/index.ts:21-29](../../src/core/sources/index.ts#L21-L29) даёт пять адаптеров: `file`, `directory`, `text`, `url`, `stream`. UI ([src/ui/components/sidebar/LvAddSourceMenu.tsx](../../src/ui/components/sidebar/LvAddSourceMenu.tsx)) предлагает девять.

| UI kind | Core эквивалент | Решение |
| --- | --- | --- |
| `local-static` | `directory` | Маппинг 1-в-1. |
| `local-live` | `directory` + watcher | watcher не реализован. ADR-0006 follow-up. |
| `remote-ssh` | — | Не в браузере без прокси. **Скрыть в UI.** |
| `stream` | `stream` (WS/SSE) | OK. |
| `cloud` | возможно `url` или `stream` | Внешние API, отдельные интеграции. **Скрыть в Phase 1.** |
| `k8s`, `bus`, `db` | — | Без прокси-сервера невозможно. **Скрыть в Phase 1.** |
| `snapshot` | новый адаптер: zip → file/text-цепочка | **Phase 3.** |
| (нет UI) | `file`, `text`, `url` | UI добирает через titlebar-меню «Open File / Paste / Open URL». |

### 1.6 Связь с ADR-0002 (зачем тогда `src/ui/adapters/`?)

[ADR-0002 §«Adapter-слой для несовпадающих props»](../adr/0002-headless-architecture.md) задумывал `src/ui/adapters/` как **тонкую обёртку для починки props после регенерации UI**, не как обязательный конверсионный слой между формами данных. Прямая цитата: *«Если шейпы совпадают — adapter = re-export. Если adapter растёт за ~30 строк — переделываем промпт под контракт, не лечим обёртку.»*

Ограничение «UI-компонент только props и type-imports из core» закреплено [ESLint'ом](../../eslint.config.js#L69-L78) с `allowTypeImports: true` — то есть импортировать `LogFilter`/`LogEntry` из `src/core/types/` прямо в `Lv*`-компонент архитектурой **разрешено**.

Текущий подход (выровнять core под UI, потреблять напрямую) — это не отказ от ADR-0002, а его логическое завершение: после расширения core шейпы совпадают, и адаптер вырождается даже не до re-export'а — до пустоты.

**`src/ui/adapters/` остаётся опциональной папкой** на случай:
- Claude Design регенерирует `LvRow` и переименует `onSelect → onClick` — кладём адаптер с переименованием prop'а.
- Появится второй потребитель компонентов (storybook, e2e) с другим shape'ом — адаптер.
- Понадобится cross-tab sync / deep-link с обратной конверсией LogFilter → URL → LogFilter — адаптер.

В ADR-0010 (см. Phase 1, шаг 11) явно зафиксируем: «По ADR-0002 §Adapter-слой адаптеры — escape hatch, не обязательный слой; при шейп-совпадении они не нужны».

## 2. Фазированный план

### Phase 1 — Выровнять core под UI и навязать wiring (P0)

**Цель:** core получает недостающие поля/операторы; UI потребляет core-типы напрямую (без конверсий); LvApp работает на реальных источниках.

1. **Расширить core:**
   - [src/core/types/log-filter.ts](../../src/core/types/log-filter.ts):
     - Добавить `wholeWord: boolean`.
     - Добавить `services: ReadonlyArray<string> | null`.
     - Расширить `FieldFilterOp` до `'='|'!='|'~'|'>'|'<'` (вместо `'eq'|'ne'|'contains'`).
     - Обновить `EMPTY_FILTER`.
   - [src/core/filter/query.ts](../../src/core/filter/query.ts):
     - Добавить SQL-генерацию для `services`: `JSON_EXTRACT(fields_json, '$.service') IN (?, ?, ...)`.
     - Реализовать `fieldFilters` через `JSON_EXTRACT(fields_json, '$.<key>')` со всеми пятью операторами; для `>`/`<` — `CAST(... AS REAL)`.
     - Реализовать `wholeWord`: для substring — обёртка regex `\b<escaped>\b` через REGEXP UDF (см. шаг ниже) ИЛИ временный fallback `LIKE % <word> %` с пробелами; для FTS — фразовое квотирование `"phrase"`.
     - regex queryMode пока остаётся silently dropped — закроем в Phase 2 (тогда же доедет REGEXP UDF, и `wholeWord` для substring уже автоматически заработает через regex).
   - [src/core/filter/query.test.ts](../../src/core/filter/query.test.ts) — обновить тесты под новые операторы и поля.

2. **Удалить дубликаты типов в UI** в [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts):
   - Убрать `LvFilters`, `LvLogEntry`, `LvLogLevel`, `LvLogKind`, `LvFieldFilter`, `LvFieldFilterOp`.
   - Оставить чисто-UI типы: `LvCatalogRoot`, `LvFolderNode`, `LvFileNode`, `LvNode`, `LvSourceKind`, `LvSavedSearch`, `LvTweaks*`, `LvRail`, `LvGroup`, `LvGroupBy`, `LvTab`.
   - Заменить упоминания на `import type { LogFilter, LogEntry, LogLevel, FieldFilter, TimeRange, QueryMode, EntryId, SourceId, SourceRecord, SourceStatus } from '../../core/types/index.ts'`.

3. **Refactor Lv*-компонентов под core-типы:**
   - `LvRow`, `LvRowDetail`, `LvFilePeek`, `LvBookmarksPanel`, `LvGroupHeader`: `entry.msg → entry.message`, `entry.ts → entry.timestamp`, `entry.line → entry.seq`. Поля `file/path/kind` приходят через новый prop `fileMeta: LvFileNode | null` (lookup в родителе).
   - `LvFilterBar`: добавить `queryMode`-select (substring/fts/regex). Кнопка regex (бывшая `useRegex`) теперь устанавливает `queryMode='regex'`. `wholeWord` остаётся отдельной кнопкой.
   - `LvLevelPill`: рендер всех 7 уровней в pill-set (добавить `fatal`, `unknown`).
   - `LvAddFieldFilter`: новый список операторов (`=`, `!=`, `~`, `>`, `<`).
   - `LvTimeline`: `range: TimeRange | null` вместо tuple.
   - `LvViewer`: меняется контракт (см. шаг 5).
   - `lvApplyFilters` ([src/ui/utils/lv-filter.ts](../../src/ui/utils/lv-filter.ts)) — удалить (фильтрация на сервере).
   - `lvBuildGroups` — оставить до Phase 2 (тогда уйдёт в координатор).
   - `lvFmtTime` ([src/ui/utils/lv-format.ts](../../src/ui/utils/lv-format.ts)) — сигнатура `(timestamp: number | null, showDate?) => string`.

4. **Новые UI-only хуки** в [src/hooks/](../../src/hooks/) (Zustand + `localStorage`-persist):
   - `use-ui-prefs.ts` — tweaks (theme, density, accent, wrap, showDate, timelineOn, queryModeDefault).
   - `use-bookmarks.ts` — `Set<EntryId>` с persist'ом. Caveat по нестабильности `EntryId` задокументировать в JSDoc.
   - `use-recent-files.ts` — top-10 selected (`SourceId`).
   - `use-saved-searches.ts` — массив `LvSavedSearch`.
   - `use-tabs.ts` — `{ activeTabId, closedTabs, activate(id), close(id), reopen(id) }`.

5. **Виртуализация в `LvViewer`**: портировать `@tanstack/react-virtual` (уже в deps). LvViewer теперь принимает не `entries: LogEntry[]`, а `rowCount: number`, `getRow(i): LogEntry | undefined`, `onVisibleRangeChange(from, to)` — это контракт `useLogWindow`. LvRow остаётся pure.

   Это меняет props-контракт LvViewer однократно; зафиксировать ADR'ом «UI потребляет windowed-данные» (новый ADR Phase 1).

6. **Утилита `buildCatalogTree`** в [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts):
   - Вход: `SourceRecord[]`.
   - Выход: `LvCatalogRoot[]` — группировка по `source.kind`, бейджи из `SourceStatus`, флаг `live` для streaming.
   - Юнит-тест в `*.test.ts`.

7. **Контейнер [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx):**
   - Хранит `LogFilter` локально (или через `useUiFilters` — на ваше усмотрение). Источник истины для UI-контролов.
   - На каждое изменение пушит вниз: `useLogFilter().setFilter(next)`. Без конверсий — UI и core теперь говорят на одном языке.
   - Локально: `selectedIds: Set<SourceId>`, `activeTabId: SourceId | '__all__'`, `groupBy: string[]` (UI-state).
   - Связь `selectedIds + activeTabId → filter.sources` — одной строкой:
     ```ts
     setFilter(prev => ({
       ...prev,
       sources: activeTabId === '__all__' ? [...selectedIds] : [activeTabId],
     }))
     ```
   - Зовёт `useLogWindow`, `useSelectedEntry`, `useSourceController`, `useSourceStatus`, плюс новые `useUiPrefs`, `useBookmarks`, `useRecentFiles`, `useSavedSearches`, `useTabs`.
   - Собирает props для LvApp: `catalog = buildCatalogTree(sources)`, `filesById = Object.fromEntries(...)`, `getRow / rowCount / setVisibleRange = useLogWindow()`, `bookmarks = useBookmarks().ids`, и т.д.

8. **Скрыть неподдерживаемые kind'ы** в [src/ui/components/sidebar/LvAddSourceMenu.tsx](../../src/ui/components/sidebar/LvAddSourceMenu.tsx). Оставить: `local-static` (→ `directory`), `local-live` (→ `directory` без watcher'а пока), `stream`. Дополнить через titlebar-меню: file (Open File…), text (Paste…), url (Open URL…). Скрыть `remote-ssh`, `cloud`, `k8s`, `bus`, `db`, `snapshot`, `bookmark`.

9. **`src/App.tsx` → `<LvAppContainer/>`**, удалить mock-данные:
   - Удалить [src/dev/log-data-mock.ts](../../src/dev/log-data-mock.ts).
   - Старый `App.tsx` с mock-логикой заменяется на тонкую обёртку:
     ```tsx
     import { LvAppContainer } from './app/containers/LvAppContainer.tsx';
     import { WorkerClientProvider } from './app/providers/WorkerClientProvider.tsx';
     export default () => <WorkerClientProvider><LvAppContainer/></WorkerClientProvider>;
     ```

10. **Тесты:**
    - Обновлённый `query.test.ts` (новые операторы, wholeWord, services).
    - Новый `build-catalog.test.ts`.
    - Smoke в браузере: загрузить `public/sample.jsonl`, фильтр + раскрытие row + bookmark работают.

11. **ADR:** написать ADR-0010 «LvApp поверх ViewStore: core-типы — единственный источник, UI без адаптеров». Отметит снятие ADR-0009 (`superseded by 0010`).

### Phase 2 — regex и group-by на сервере (P1)

**Цель:** добиваем последние SQL-фичи + серверная группировка/гистограмма.

1. **regex queryMode в SQL:**
   - REGEXP UDF в [src/workers/indexer/db/open-db.ts](../../src/workers/indexer/db/open-db.ts). SQL: `WHERE message REGEXP ?`.
   - Расширить `query.ts` под `queryMode='regex'`. После этого `wholeWord` поверх substring чистится через regex `\b...\b`. Тесты.
2. **`coordinator.getGroupCounts(filter, fields, parent?)` + `coordinator.getHistogram(filter, buckets)`:**
   - Контракт в [src/core/rpc/coordinator.contract.ts](../../src/core/rpc/coordinator.contract.ts).
   - SQL: `GROUP BY JSON_EXTRACT(fields_json, '$.' || ?)` + `MIN(ts), MAX(ts), COUNT(*), SUM(level=...)`. Гистограмма — bucket'ы по `ts`.
   - Хуки `use-group-counts.ts`, `use-histogram.ts`.
3. **LvViewer:** при активной `groupBy` → `LvGroupHeader`'ы из `useGroupCounts`; разворачивание группы → `useLogWindow` с уточнённым `filter.fieldFilters`.
4. **LvTimeline:** переключить с клиентского bucket'инга на `useHistogram`.
5. **Удалить `lvBuildGroups`** — больше не нужен.
6. **Тесты** на coordinator + indexer.

### Phase 3 — Snapshot-адаптер и live-tail верификация (P2)

1. **Snapshot adapter** в [src/core/sources/](../../src/core/sources/): zip/tar.gz → распаковка в memory (например `fflate`) → каждый файл → file-adapter. ADR на dep.
2. **Live-tail end-to-end:** локальный WS-эхо (или test endpoint) → `addStream` → `subscribeChanges → version++ → useLogWindow refresh` → UI auto-scroll.

### Phase 4 — Persistence directory-источников (P2)

По [ADR-0006](../adr/0006-persistence-strategy.md):
1. `coordinator.resumePersistedSources()` + `coordinator.grantPermission(id)`.
2. UI: при `SourceStatus.kind === 'permission-required'` — кнопка «Grant access» в `LvTreeNode`. Клик → `useSourceController.grantPermission(id)`.
3. Bookmarks: переход с `EntryId` на стабильный fingerprint (`{sourceId, seq}` хэш + сравнение `raw`-строки на коллизии).

### Phase 5 — Polish (P3)

- `coordinator.exportFiltered(filter, format)` (jsonl/csv) + UI «Export» в File-меню.
- `coordinator.reIndex(id)`.
- `coordinator.cancel(taskId)` + UI прогресс-бар (читает `SourceStatus.bytesRead/bytesTotal`).
- AI-панель: реальная Claude API интеграция (нужен ADR — браузерные запросы к Anthropic из-за CORS требуют проксирования).
- Alerts engine — отдельный план.
- Server-side find (с подсветкой за пределами окна).

## 3. Critical files

**Создать (Phase 1):**
- `src/ui/utils/build-catalog.ts` + `*.test.ts`
- `src/hooks/use-ui-prefs.ts`
- `src/hooks/use-bookmarks.ts`
- `src/hooks/use-recent-files.ts`
- `src/hooks/use-saved-searches.ts`
- `src/hooks/use-tabs.ts`
- `src/app/containers/LvAppContainer.tsx`
- `docs/adr/0010-lv-on-viewstore-core-types.md`

**Модифицировать (Phase 1, core):**
- [src/core/types/log-filter.ts](../../src/core/types/log-filter.ts) — `wholeWord`, `services`, расширенный `FieldFilterOp`, `EMPTY_FILTER`.
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — services-IN, fieldFilters все операторы, wholeWord (через regex или fallback).
- [src/core/filter/query.test.ts](../../src/core/filter/query.test.ts) — расширенное покрытие.

**Модифицировать (Phase 1, UI):**
- [src/App.tsx](../../src/App.tsx) → тонкая обёртка `<WorkerClientProvider><LvAppContainer/></WorkerClientProvider>`.
- [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts) — удалить дубликаты, оставить только UI-only.
- [src/ui/components/stream/LvViewer.tsx](../../src/ui/components/stream/LvViewer.tsx) — виртуализация + новый props-контракт (rowCount/getRow/setVisibleRange).
- [src/ui/components/stream/LvRow.tsx](../../src/ui/components/stream/LvRow.tsx), `LvRowDetail.tsx`, `LvFilePeek.tsx`, `LvGroupHeader.tsx` — переименование полей entry, prop `fileMeta`.
- [src/ui/components/filter/LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx) — `queryMode`-select, levels как массив, 7 pill'ов.
- [src/ui/components/filter/LvLevelPill.tsx](../../src/ui/components/filter/LvLevelPill.tsx) — расширить.
- [src/ui/components/filter/LvAddFieldFilter.tsx](../../src/ui/components/filter/LvAddFieldFilter.tsx) — новые операторы.
- [src/ui/components/timeline/LvTimeline.tsx](../../src/ui/components/timeline/LvTimeline.tsx) — `TimeRange` объект.
- [src/ui/components/sidebar/LvAddSourceMenu.tsx](../../src/ui/components/sidebar/LvAddSourceMenu.tsx) — фильтр поддерживаемых kind'ов.
- [src/ui/components/panels/LvBookmarksPanel.tsx](../../src/ui/components/panels/LvBookmarksPanel.tsx) — entry.message/timestamp.
- [src/ui/utils/lv-format.ts](../../src/ui/utils/lv-format.ts) — сигнатура `(timestamp: number | null, showDate?)`.

**Удалить (Phase 1):**
- [src/dev/log-data-mock.ts](../../src/dev/log-data-mock.ts).
- [src/ui/utils/lv-filter.ts](../../src/ui/utils/lv-filter.ts) — `lvApplyFilters` устарел; `lvBuildGroups` — в Phase 2.
- Пометить [docs/adr/0009-mock-default-app.md](../adr/0009-mock-default-app.md) как `superseded by ADR-0010`.

**Модифицировать (Phase 2):**
- [src/core/rpc/coordinator.contract.ts](../../src/core/rpc/coordinator.contract.ts) — `getGroupCounts`, `getHistogram`.
- [src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts) — реализация.
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — group/histogram SQL.
- [src/workers/indexer/db/open-db.ts](../../src/workers/indexer/db/open-db.ts) — REGEXP UDF.
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — regex queryMode.

## 4. Verification

### Phase 1 acceptance

- `pnpm dev` стартует, `/` показывает пустое дерево + CTA «Add source».
- Open File… → выбор `public/sample.jsonl` → дерево показывает файл, badge переходит loading → indexing → done.
- LvViewer показывает 15 строк из sample-файла; виртуализованный скролл (проверить на синтетическом 100k-jsonl).
- Toggle level pill `info` (в наборе из 7) → строки `info`-уровня скрываются (фильтрация на сервере).
- Search query "boot" в substring-режиме → одна строка. Переключение FTS-режима через select.
- Field-filter chip `service = api-gateway` → entries сужаются. Числовой `duration_ms > 1000` тоже работает.
- whole-word toggle переключает поведение substring (через regex `\b` после Phase 2; в Phase 1 — через временный fallback с пробелами).
- Click row → expand, видно raw + JSON fields.
- Bookmark on a row → reload → bookmark остался (localStorage).
- Theme/density/accent сохраняются между перезагрузками.
- `pnpm build`, `pnpm lint`, `pnpm test` зелёные.

### Phase 2 acceptance

- regex query `\bdeadlock\b` ловит точное слово (через REGEXP UDF).
- groupBy=['trace_id']: заголовки групп с count/levelCounts. Скролл мгновенный.
- Click на группу → entries (виртуализованно, через `useLogWindow` с уточнённым `fieldFilters`).
- Multi-level groupBy ['service', 'trace_id'] — вложенные группы.
- Timeline: drag-to-select → `filter.timeRange` обновляется, гистограмма перерисовывается из `useHistogram`.

### Phase 3–5

См. соответствующие секции; верификация — отдельными приёмочными чек-листами.

## 5. Out of scope этого плана

- Реальные адаптеры для `remote-ssh`, `cloud`, `k8s`, `bus`, `db` — каждый требует ADR (CORS/proxy/auth).
- Реализация Alerts engine.
- Cross-tab sync ViewStore.
- Multi-window support.
- Offline-first для cloud-источников.

## 6. Замечания по плановой работе с UI и Playwright MCP

Запросить prod-снапшот UI через Playwright MCP в этой сессии не получилось — соответствующие tool'ы (`browser_*` / `playwright_*`) не загружены, хотя `.mcp.json` сконфигурирован. На будущих итерациях при доступности MCP — добавить smoke-сценарий: «открыть `/`, добавить sample.jsonl, проверить badge'и переходят, фильтры работают, скриншот сохраняется в `docs/assets/`». Это автоматизирует регрессию после каждой фазы. Сейчас — ручная верификация в DevTools.
