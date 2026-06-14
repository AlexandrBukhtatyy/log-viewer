# Концепция «Ресурс» — 4 варианта реализации

Сравнительный design doc. Цель — выбрать модель, в которой _Ресурс_ содержит несколько лог-файлов, и каждый файл может иметь свой парсер и свой набор динамических полей. Все варианты накладываются на текущую архитектуру (см. факты в задаче и `docs/adr/0016-offset-pointer-index-lazy-body.md`, `0017-dynamic-field-schema.md`, `0015-directory-tree-and-file-frames.md`).

Ключевые точки касания во всех вариантах:

- `src/core/types/log-source.ts` — `DirectoryLogSource`, `ParserOverride`.
- `src/core/types/log-entry.ts` — `LogEntry.filePath` уже относительный.
- `src/workers/coordinator/ingest/ingest-orchestrator.ts` — единственный парсер пика на источник.
- `src/workers/indexer/db/schema-v3-offsets.sql` + `schema-v4-field-meta.sql` — таблицы `source`/`entry`/`field_meta`.
- `src/hooks/use-workspace.ts` — workspace с tabs.
- `src/ui/contracts/lv-types.ts` — `LvFileNode.parserId` уже объявлен, но end-to-end не подключён.

---

## Вариант A — Per-file parser в DirectoryLogSource (минимальный)

### 1. Суть

Ресурс — это всё ещё `DirectoryLogSource` (без новой сущности). Расширяем существующий ingest-pipeline так, чтобы детекция парсера работала **per-file** внутри одного источника. Парсер выбирается заново при каждой смене `filePath` в потоке `LogLineFrame`.

### 2. Схема данных

- `DirectoryLogSource` получает опциональную карту override-ов:
  ```ts
  readonly fileParsers?: Readonly<Record<string /* relPath */, string /* parserId */>>;
  ```
- `ParserOverride.parserId` остаётся как fallback «парсер для всего источника по умолчанию».
- `SourceRecord.parserId` остаётся single-valued (последний детектированный или дефолтный) — для UI бейджа на корне дерева. Появляется параллельный `SourceRecord.fileParserIds?: Record<relPath, string>`.
- БД меняется минимально (см. §4).

### 3. Изменения в ingest

В `ingest-orchestrator.ts`:

- Состояние `parserId/continuationRegex` становится `Map<filePath, {parserId, continuationRegex}>`.
- Каждый batch до сих пор имеет один `path` (`directory-adapter` уже эмитит frame-ы с `path`). На каждый новый `path`:
  1. Сначала смотрим `source.fileParsers?.[path]`.
  2. Если нет — `source.parserId` (общий override).
  3. Если нет — старый auto-detect на первом батче этого `path` (sample из первых N строк _этого файла_).
- Continuation-regex/openFrame буфер уже сбрасывается при path-boundary — этот код можно переиспользовать.
- `onParserDetected` начинает эмитить `{filePath, parserId, defaultColumns}` (не однократно, а по одному разу на каждый новый `filePath`).
- `parserPool.parse` уже принимает `parserId` per call — менять не нужно.

### 4. Изменения в БД и миграция

- `source.meta_json` обогащается `fileParsers: {path -> parserId}` (мердж — не отдельная колонка).
- **Опционально** новая колонка `entry.parser_id TEXT` (или хранить в `fields_json` как `@parser`) — нужно если хочется фильтр «entries по парсеру». Можно отложить.
- Schema-v6 миграция: только ALTER TABLE для опциональной `entry.parser_id` или добавить `parser_id_json` в `source.meta_json` без миграции вообще.
- Re-ingest не обязателен — старые источники просто продолжают работать с auto-detect (как сейчас).

### 5. Изменения в Workspace/UI

- Sidebar: `LvFileNode.parserId` подключаем end-to-end (он уже объявлен). В contex-menu файла — пункт «Set parser…».
- Tabs: compound id `<sourceId>::<relPath>` уже есть, ничего не меняем.
- Column picker: на вкладке конкретного файла — `parserDefaultColumns` для **этого** файла. На «aggregate»-вкладке источника — берём дефолты «most common» парсера или fallback.
- Колонки **остаются per-user** (через `tweaks.columns`), но если активная вкладка — конкретный файл с известным `parserId`, можем предложить parser-specific preset (опционально, можно отложить).

### 6. Изменения в Field Schema

- `field_meta` остаётся per-source (PK `source_id, key`).
- Чтобы UI понимал «этот ключ только в `app/api.log`», есть два пути:
  - **Простой:** добавить колонку `file_path TEXT` в `field_meta`, PK станет `(source_id, file_path, key)`. Дороже по storage, но даёт точный per-file picker.
  - **Дешёвый:** оставить как есть, в `FieldDescriptor.perSource` дописать в строке `'sourceId/relPath'` (нарушение типа `sourceId`), либо ввести `perFile: Array<{sourceId, filePath, occurrences, presenceRate}>`. Лучше второе.
- Решение для A: per-source schema + дополнительный per-file breakdown в descriptor — отдельную таблицу `field_meta_file(source_id, file_path, key, …)` или JSON-агрегат в существующей `field_meta`. Compromise: добавить таблицу.

### 7. Открывающиеся сценарии

- Drag-drop папки с разнородными файлами (nginx + json + plain) — каждый парсится корректно.
- Существующие workflow ломаются минимально.
- Не покрывает: «k8s pod = ресурс из 3 контейнеров» (там нет общего `FileSystemDirectoryHandle`). «Логически связанные файлы из разных папок» — нельзя.

### 8. Сложность

**Small-Medium.** Концептуально расширяем существующий механизм. Один новый ADR: «per-file parser dispatch» (продолжение ADR-0018).

ADR-кандидаты:

- ADR-NN per-file parser selection (Phase 2.B extension).
- Опционально: ADR-NN per-file field_meta breakdown.

### 9. Trade-offs

**Плюсы:**

- Меньше всего кода и риска.
- Нулевая миграция БД (schema-v5 хватает).
- Совместимость со всем существующим UI (`'<sourceId>::<relPath>'` уже работает).

**Минусы:**

- «Ресурс» как идея остаётся неявным — пользователь не может явно сгруппировать файлы из разных папок.
- field_meta остаётся per-source, без per-file аккуратности придётся либо дублировать данные, либо мириться с шумом в column picker'е.
- Auto-detect по первой строке файла — слабое место для смешанных форматов в одном файле (`mixed.log`), но это уже проблема `parseAny` fallback.

### 10. Когда выбирать

Пользователь работает в основном с **локальными папками** (один логический проект = одна папка с разными .log). Не нужны k8s/cloud-сценарии. Хочет «положил папку — оно работает».

---

## Вариант B — Ресурс как UI-группа в Workspace (workspace-only)

### 1. Суть

Backend (coordinator, indexer, БД) **не трогаем**. Каждый файл = отдельный физический `LogSource` (со своим `parserId`, своим `field_meta`). В `useWorkspaceStore` добавляем `resources: ResourceGroup[]` — это чисто UI-концепция: упорядоченный список группировок над уже существующими source-id.

### 2. Схема данных

В `src/hooks/use-workspace.ts`:

```ts
export interface ResourceGroup {
  readonly id: string; // `res:<uuid>`
  readonly name: string; // 'api-staging'
  readonly accent?: string; // цветной маркер
  readonly memberSourceIds: ReadonlyArray<string>;
  readonly defaultFilter?: LogFilter;
  readonly defaultColumns?: ReadonlyArray<LvColumnPref>;
}
```

- `WorkspacePersistedV1` v2: добавляется поле `resources: ReadonlyArray<ResourceGroup>`. Нужна `migrate`-функция в `persist({ version: 2, migrate })`.
- В `openTabs` появляется новый тип id: `res:<groupId>` (вкладка-агрегатор).
- В `LogFilter` уже есть `sources: SourceId[] | null` — фильтр по группе разворачивается в `sources: group.memberSourceIds`.

### 3. Изменения в ingest

Никаких. Каждый файл импортируется как `FileLogSource` или как часть отдельного `DirectoryLogSource`. Парсер per-source — старая логика.

### 4. Изменения в БД и миграция

Никаких. Schema-v5 без изменений.

### 5. Изменения в Workspace/UI

- Sidebar: новая верхнеуровневая нода `LvResourceNode` (с accent-полоской). Дети — обычные `LvCatalogRoot` (file/folder). Можно перетаскивать sources между группами.
- Topbar: «New Resource…» → модал для создания группы + drag-drop файлов в неё.
- Tabs: `res:<id>` рендерится как агрегатор (filter.sources = members). На вкладке файла — обычное поведение, но в шапке tab указано «<resource>/<file>».
- Column picker: на resource-вкладке колонки = `group.defaultColumns ?? union(parserDefaultColumns по членам)`. На file-вкладке — обычный per-user (или per-source через `lv:source-prefs` из `docs/plans/per-source-customization.md`).
- Filter: фильтр сохранять можно как `defaultFilter` группы (вне coreFilter), применять автоматически при активации.

### 6. Изменения в Field Schema

`field_meta` уже per-source. UI-агрегатор просит `getFieldSchema(memberSourceIds)` — существующий API уже принимает array of SourceId (см. `field-descriptor.ts` perSource). Никаких изменений в схеме.

### 7. Открывающиеся сценарии

- «Логическое приложение из N файлов» (`api.log` + `nginx.access.log` + `worker.log` из трёх разных папок).
- Цветная маркировка прод/стейдж независимо от того, как физически загружены файлы.
- Сохранение «рабочих сетов» — пользователь возвращается и видит свои группы.
- НЕ покрывает: «k8s pod = ресурс» (там source — это live-stream, и контейнеры можно технически объединить — но семантика «ресурс существует на бэкенде» отсутствует).

### 8. Сложность

**Small.** Только UI + workspace persist v2 migration. Один ADR.

ADR-кандидаты:

- ADR-NN resource groups в workspace (расширение ADR-0025).

### 9. Trade-offs

**Плюсы:**

- Минимум риска для backend'а.
- Группа — это всего лишь list of source-ids, тривиально для тестов и сериализации.
- Естественно сочетается с `lv:source-prefs` плана `per-source-customization.md`.

**Минусы:**

- Каждый файл — отдельный `LogSource`. Для папки с 50 файлами user получает 50 кружков в sidebar'е (или их нужно вторично группировать).
- Импорт папки требует разбиения на N независимых файловых источников — это **меняет** UX импорта папок (сейчас папка = один source). Можно частично: оставить папку как source, но позволить «промотивровать файлы в отдельные sources».
- field_meta остаётся за источниками, агрегация для UI группы — на лету. Работает, но на 50 файлах select может стать дороже.
- Группа невидима для координатора — нельзя сделать сервер-side aggregations поверх группы как поверх источника без расширения contract'а.

### 10. Когда выбирать

Пользователь хочет **гибкую группировку** «по приложению/окружению» поверх любых источников (включая будущие k8s/url/stream), и не хочет ждать большую миграцию БД. Хорошо для проекта на ранней стадии.

---

## Вариант C — Resource как first-class entity в БД (фундаментальный)

### 1. Суть

Появляется новая таблица `resource(id, name, kind, meta_json)`. У `source` появляется опциональный FK `resource_id`. `LogSource` остаётся single-parser (как сейчас), но логически принадлежит ресурсу. Ресурс — это «контейнер sources», единица группировки и единица user-facing identity.

### 2. Схема данных

SQL (schema-v6):

```sql
CREATE TABLE resource (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'directory' | 'k8s-pod' | 'logical' | 'snapshot' | 'live'
  name        TEXT NOT NULL,
  meta_json   TEXT,                   -- accent, alias, defaultFilter, defaultColumns
  created_at  INTEGER NOT NULL
);

ALTER TABLE source ADD COLUMN resource_id TEXT REFERENCES resource(id) ON DELETE SET NULL;
CREATE INDEX idx_source_resource ON source(resource_id);
```

TypeScript:

- `src/core/types/log-resource.ts`:
  ```ts
  export type ResourceId = string & { readonly __brand: 'ResourceId' };
  export interface LogResource {
    readonly id: ResourceId;
    readonly kind: 'directory' | 'k8s-pod' | 'logical' | 'snapshot' | 'live';
    readonly name: string;
    readonly meta: {
      accent?: string;
      alias?: string;
      defaultColumns?: LvColumnPref[];
      defaultFilter?: Partial<LogFilter>;
    };
  }
  ```
- `LogSource` получает поле `resourceId?: ResourceId`.
- В RPC (`coordinator.contract.ts` / `indexer.contract.ts`) появляются: `listResources()`, `createResource()`, `attachSourceToResource(sourceId, resourceId)`, `removeResource(id)`.

### 3. Изменения в ingest

Никаких в pipeline самом. Парсер остаётся per-source. Меняется только бухгалтерия:

- При `addSource(...)` принимается опциональный `resourceId`. Если задан — `source.resource_id` записывается в БД.
- При импорте папки (UI «Add Resource from folder») coordinator создаёт `resource(kind='directory')` + N source-ов под ней, каждый со своим парсером.

### 4. Изменения в БД и миграция

- Schema-v6: новая таблица `resource`, новая колонка `source.resource_id`. Не разрушительно — старые источники имеют `resource_id = NULL` и продолжают работать как «не привязанные».
- В `field_meta` ничего не меняется — она per-source.
- `entry_minute` per-(source × file × minute) — не меняется. Серверные агрегации поверх ресурса = `WHERE source_id IN (SELECT id FROM source WHERE resource_id = ?)`.

### 5. Изменения в Workspace/UI

- Sidebar: верхний уровень дерева теперь = ресурсы. Под ресурсом — sources (физические).
- Tabs: компаунд id меняется на `<resourceId>::<sourceId>::<relPath?>`. `'__all__'` остаётся для workspace-aggregate.
- Topbar/Add menu: «New Resource → from folder | from K8s pod | from URL set | Empty».
- `LogFilter` получает поле `resources: ResourceId[] | null`. Все запросы по `coreFilter` дополнительно фильтруют по resource.
- Колонки могут быть **per-resource** (хранятся в `resource.meta_json.defaultColumns`). Pull request к ADR-0017.

### 6. Изменения в Field Schema

- `field_meta` остаётся per-source — но `getFieldSchema(resourceId)` агрегирует поверх sources ресурса.
- В `FieldDescriptor.perSource` уже есть инфраструктура per-source breakdown — этого хватает для UI бейджей «shared/partial/unique».
- Если хотим **per-file внутри source** — нужно отдельное решение (см. варианты A/D).

### 7. Открывающиеся сценарии

- K8s pod как ресурс: дети — sources, по одному на контейнер (kind='stream' или 'k8s'). Каждый со своим парсером.
- «Logical app»: 3 файла из разных мест, явно собраны в один ресурс.
- Snapshot-архив: при разворачивании автоматически создаёт ресурс с N sources.
- Server-side aggregations по ресурсу (timeline / groupBy) — естественно ложатся в существующий `entry_minute` через JOIN.

### 8. Сложность

**Medium-Large.** Новая сущность, миграция БД, расширение RPC, перепланировка sidebar tree, изменение compound id формата (что **сломает** persisted workspace — нужна workspace migration).

ADR-кандидаты:

- ADR-NN: Resource as first-class entity.
- ADR-NN: Tab/selection compound id schema v2.
- Возможно ADR-NN: per-resource column defaults (продолжение ADR-0017).

### 9. Trade-offs

**Плюсы:**

- Ресурс — настоящая first-class сущность. Можно безопасно ссылаться, бэкапить, экспортировать.
- Чистая модель для k8s/cloud сценариев (источники приходят и уходят, ресурс — стабилен).
- Естественные server-side aggregations поверх ресурса.
- Symmetric: directory становится одним из видов ресурса, а не основной концепцией.

**Минусы:**

- Самая большая миграция. Workspace persisted v1 → v2 нужно мигрировать аккуратно (compound tab id меняется).
- Внутри одного source файлы по-прежнему делят один парсер. Если в одной папке у пользователя файлы разных форматов — придётся либо разбивать на N sources (теряем атомарность walk-directory), либо комбинировать с A/D.
- Больше boilerplate в RPC и тестах.
- Риск «преждевременной абстракции» — пока нет k8s/cloud адаптеров, ресурс кажется тяжёлым over-engineering'ом.

### 10. Когда выбирать

Уверены, что в roadmap есть **k8s/cloud/stream**-источники и хочется однородная модель: «пользователь работает с ресурсами, а не с файлами». Готовы потратить 2-3 итерации на миграцию. Подходит, если проект собирается быть «general-purpose log viewer для всех видов источников».

---

## Вариант D — Гибрид: Resource entity + per-file parser (рекомендуемый)

### 1. Суть

Берём C (ресурс — first-class) **и** A (per-file parser dispatch внутри source). Получаем двухуровневую модель:

- **Resource** — пользовательская единица: «мой проект X», «k8s pod Y». Содержит 1+ sources.
- **Source** — физический поток (папка / файл / stream). Может содержать heterogeneous файлы с per-file parser.

Это «правильная» модель для general-purpose log viewer'а: пользователь думает в категории ресурсов, физическая структура источников остаётся прозрачной.

### 2. Схема данных

- Из C: таблица `resource`, колонка `source.resource_id`, тип `LogResource`.
- Из A: `DirectoryLogSource.fileParsers: Record<relPath, parserId>`, `SourceRecord.fileParserIds`.
- Опционально: новая таблица `field_meta_file(source_id, file_path, key, type, occurrences, total_seen, top_values_json)` для аккуратного per-file schema. PK `(source_id, file_path, key)`. Можно сделать `field_meta` view-ом поверх (или дублировать данные).

### 3. Изменения в ingest

Из A: per-file parser switch в `ingest-orchestrator.ts`. Координатор при создании ресурса+sources умеет принимать готовые маппинги `fileParsers`.

При drag-drop папки:

1. UI спрашивает «один ресурс из папки» или «ресурс из set of files».
2. Если «папка» — coordinator делает `createResource(kind='directory')` + один `DirectoryLogSource` с `fileParsers` (auto-detect per file).
3. Если «set of files» (k8s pod-стиль) — один `resource` + N `FileLogSource`-ов.

### 4. Изменения в БД и миграция

Schema-v6 за один шаг:

- `CREATE TABLE resource` (см. C).
- `ALTER TABLE source ADD COLUMN resource_id`.
- Опционально: `CREATE TABLE field_meta_file` (если выбираем per-file precision).
- `field_meta` остаётся, дополняется per-file таблицей.

Workspace persisted v2 migration: добавить `resources: []`, держать обратную совместимость по `openTabs` (одинаковая форма compound id).

### 5. Изменения в Workspace/UI

- Sidebar tree: Resource → Source → (Folder/File). Three levels. Иконки: ресурс с accent-полоской, source — outline icon, file — обычная иконка + parser badge.
- Tabs: id формы `<resourceId>::<sourceId>` или `<resourceId>::<sourceId>::<relPath>` для файлового tab. Дополнительный спец-id `res:<id>` для «весь ресурс».
- Column picker: priority chain `tweaks.columns (user override) > resource.defaultColumns > source.parserDefaultColumns > parserDefaults(filePath)`.
- Add menu: «New Resource…» — одна точка входа, под капотом разворачивается в нужный набор sources.

### 6. Изменения в Field Schema

- `field_meta` (per-source) + `field_meta_file` (per-file) — оба обновляются в `insertBatch`. Стоимость записи примерно ×1.5 относительно сейчас.
- `getFieldSchema(scope)` где scope = `{resourceId} | {sourceIds} | {sourceId, filePath}` — три уровня агрегации.
- UI бейджи:
  - `shared` (в ≥N% members ресурса),
  - `partial`,
  - `unique` (только в одном файле).
- `FieldDescriptor.perFile` дополняет `perSource` (см. вариант A §6).

### 7. Открывающиеся сценарии

- Полный набор: k8s pod (resource), drag-drop папки с heterogeneous файлами (per-file parser), архив (resource из snapshot adapter), «logical app» (resource из несвязанных sources).
- Корректное per-file поле в picker'е: «`request_uri` только из `nginx.log`, `trace_id` — из всех JSON-файлов».
- Per-resource accent / alias / saved filter сразу совмещается с per-source-customization планом.

### 8. Сложность

**Large.** Сумма C + A + per-file field_meta. Множественные ADR, согласованная миграция БД и workspace, координация изменений в sidebar/tabs/picker.

ADR-кандидаты (минимум 3, возможно 4):

- ADR-NN: Resource entity (model + migration).
- ADR-NN: Per-file parser dispatch (продолжение ADR-0018/0019).
- ADR-NN: Per-file field_meta cache (продолжение ADR-0017).
- ADR-NN: Workspace persisted v2 + tab id schema v2 (продолжение ADR-0025).

### 9. Trade-offs

**Плюсы:**

- Самая выразительная модель. Покрывает все обозримые сценарии.
- Каждая ось расширения (parser per file, group per resource) решается там, где она логически живёт.
- Хорошая UX-модель: пользователь редактирует ресурс, а под капотом всё «само раскладывается».

**Минусы:**

- Самый большой объём работы. Высокий риск перенести на 2-3 итерации.
- При неудачной миграции workspace persisted риски потери открытых вкладок (хотя они и так дёшево восстанавливаются).
- `field_meta_file` примерно удваивает запись в indexer'е на ingest пути — нужен бенчмарк.
- Сложнее тестировать (больше комбинаций scope-ов).

### 10. Когда выбирать

Готовы считать «концепцию ресурса» одной из core-абстракций проекта на годы вперёд и потратить полноценный квартал на её реализацию (с предварительным C, потом A-доработкой, потом per-file schema как третий шаг). Хорошо если фактически собираемся идти в сторону k8s/cloud.

---

## Сравнительная таблица

| Критерий                                     | A (per-file parser)                             | B (workspace-only group)                           | C (resource entity)                             | D (hybrid)                                           |
| -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| **Complexity**                               | Small-Medium                                    | Small                                              | Medium-Large                                    | Large                                                |
| **Schema migration**                         | Не нужна (опционально v6 ALTER)                 | Нет (workspace v2 only)                            | v6: new table + ALTER                           | v6: new table + ALTER + new field_meta_file          |
| **UI churn**                                 | Малый (sidebar parser badge, file context-menu) | Средний (новая нода группы, drag-drop, tabs)       | Большой (sidebar 2 уровня → 3, tab id меняется) | Большой (sidebar 3 уровня, picker chain усложняется) |
| **Future-proofness**                         | Низкая (закрыт случай папки)                    | Средняя (UI-only, потолочный)                      | Высокая (k8s/cloud-ready)                       | Высочайшая                                           |
| **Perceived UX**                             | Хороший для папок, никакой для k8s              | Хороший с гибкой группировкой, но сложно для папок | Чистая mental model, но изменение привычки      | Лучшая, но не реализуема за итерацию                 |
| **Performance impact**                       | Околонулевой                                    | Околонулевой                                       | Околонулевой (1 JOIN)                           | Заметный на ingest (per-file field_meta)             |
| **Backward compat**                          | Полная                                          | Workspace v1 → v2 (тривиально)                     | Workspace v1 → v2 + tab id schema               | Workspace v1 → v2 + tab id schema                    |
| **Покрывает «k8s pod = ресурс»**             | Нет                                             | Частично (как UI-группа над streams)               | Да                                              | Да, плюс per-container-file parsing                  |
| **Покрывает «папка с разнородными файлами»** | Да                                              | Через разбивку папки на N sources                  | Через подключение A                             | Да (нативно)                                         |
| **Покрывает per-file field schema**          | Через дополнение                                | Нет (агрегация на лету)                            | Нет (без A)                                     | Да                                                   |
| **ADR-нагрузка**                             | 1-2                                             | 1                                                  | 2-3                                             | 3-4                                                  |

---

## Рекомендация

**Рекомендую вариант A в качестве первого шага, с явно зарезервированной целью эволюции в D.**

### Почему именно A первый

Проект называет себя «just initialized», но фактически уже имеет:

- Полноценный ingest pipeline с parser-pool, multi-line buffer, offset-pointer index.
- Sidebar tree с уже выделенным `LvFileNode.parserId` (он буквально объявлен, но не подключён).
- field_meta per-source, perSource breakdown в descriptor'е.
- compound id `<sourceId>::<relPath>` в tabs и selection.

То есть **самый востребованный пользовательский сценарий — drag-drop папки с разнородными файлами — уже на 80% готов**. Не хватает только per-file dispatch'а в `ingest-orchestrator.ts` и подключения `parserId` в sidebar. Это 1-2 ADR, ноль миграции БД, ноль изменения compound id, и пользователь сразу получает «положил папку — оно понимает каждый файл».

### Почему не B первым

B хорош, но **переворачивает UX импорта папок**: текущая ментальная модель «папка = source» противоречит «группа = N отдельных sources». Перенос вызовет когнитивную нагрузку («где мой source — в группе или сам по себе?») и потребует параллельной кампании по миграции уже сохранённых workspace'ов. При этом B не решает реальную проблему — heterogeneous файлы в папке — только маскирует её через ручную группировку.

### Почему не C сразу

C — правильная архитектура, но:

1. Без A внутри неё heterogeneous-сценарий **не решён**: ресурс по-прежнему содержит monolithic sources с одним парсером.
2. Большая миграция (resource table + tab id schema) — это инвестиция, которую стоит делать **после** того, как мы выяснили UX «ресурса» на A+B-уровне.
3. Преждевременная абстракция: пока нет реально работающих k8s/cloud адаптеров, ценность first-class resource'а **гипотетическая**.

### Почему не D сразу

D — куда мы хотим прийти. Но D **за один присест** — это:

- 3-4 параллельных ADR с риском несогласованности.
- Миграция БД + миграция workspace + изменение compound id одновременно.
- per-file field_meta удваивает запись в indexer'е — нужен бенчмарк, который ещё не запланирован.

Это в полтора-два раза дороже последовательной траектории A → C → D и при этом не даёт никакого outcomes раньше.

### Предлагаемая траектория

1. **Сейчас (A):** per-file parser в `DirectoryLogSource`. ADR на per-file dispatch. Подключаем существующий `LvFileNode.parserId` end-to-end. 1-2 недели.
2. **Дальше (B-light):** добавить простой `ResourceGroup` поверх existing sources в workspace **только для группировки sources в sidebar** (не как замена папке) — это «лёгкая часть B», совместимая с любым будущим. Параллельно с `lv:source-prefs` из `per-source-customization.md`. 1 неделя.
3. **Когда появится k8s/url-bundle/snapshot use-case:** мигрируем ResourceGroup из workspace-only в БД (вариант C). Workspace v2 migration. 2-3 недели.
4. **Когда станет нужна per-file field schema:** добавляем `field_meta_file` (последний кусок D). С бенчмарком. 1 неделя.

На каждом шаге UI остаётся консистентным, миграции маленькие, ADR-ы атомарные. Цель «PWA для просмотра логов широкого назначения» достигается без big-bang перестройки.

### Если давление времени или продуктовая необходимость требует «сразу нормально»

Тогда **D**, но запланированный как 3-фазный releasу: сначала landing schema-v6 + resource API (без UI), потом перенос UI с workspace-tabs на resource-tabs, потом per-file field_meta. Не пытаться сделать всё одним PR.

### Critical files for implementation (вариант A — рекомендованный первый шаг)

- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/core/types/log-source.ts`
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/workers/coordinator/ingest/ingest-orchestrator.ts`
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/workers/coordinator/coordinator.ts`
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/ui/contracts/lv-types.ts`
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/hooks/use-directory-trees.ts`

### Дополнительно затрагиваемые при движении к D

- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/workers/indexer/db/migrations.ts` (новая schema-v6)
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/workers/indexer/field-meta.ts` (per-file scope)
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/hooks/use-workspace.ts` (resource refs в openTabs)
- `/Users/aleksandrbuhtatyj/Work/My/log-viewer/src/core/rpc/coordinator.contract.ts` (resource API)
