# Концепция «Ресурс» — варианты реализации

> **Решение пользователя:** реализуем **вариант A** как фазу 1, держим в roadmap полный набор сценариев (drag-drop heterogeneous-папки, логическое приложение, k8s/cloud/stream, per-file колонки) через траекторию A → B-light → C → D. Конкретный план фазы 1 — см. раздел [«Фаза 1: implementation plan для варианта A»](#фаза-1-implementation-plan-для-варианта-a) ниже.

## Context

Пользователь хочет работать с понятием **Ресурс**: ресурс содержит несколько лог-файлов, и эти файлы могут иметь **разный формат** (парсер) и **разный набор полей** в записях. Сейчас в проекте такой абстракции нет.

### Что уже есть в коде

- `LogSource` — discriminated union (`file | directory | text | url | stream | snapshot | …`). Каждый `Source` = **один парсер на весь источник** (auto-detect по первой непустой строке или explicit `parserId`).
- `DirectoryLogSource` обходит каталог целиком, но **все файлы парсятся одним парсером**. См. [src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts).
- `entry.filePath` в [src/core/types/log-entry.ts](src/core/types/log-entry.ts) хранит относительный путь внутри directory — per-file разделение на уровне записей уже есть.
- В UI: `LvFileNode.parserId?: string` объявлен в [src/ui/contracts/lv-types.ts](src/ui/contracts/lv-types.ts), но end-to-end не подключён.
- Workspace умеет compound id `<sourceId>::<relPath>` для tab/selection — см. [src/hooks/use-workspace.ts](src/hooks/use-workspace.ts).
- `FieldDescriptor.perSource` в [src/core/filter/field-descriptor.ts](src/core/filter/field-descriptor.ts) даёт инфраструктуру для per-source breakdown полей. Таблица `field_meta` per-source.
- Custom-парсеры (regex/grok/js-function) уже есть — [src/core/parsers/custom-parser-def.ts](src/core/parsers/custom-parser-def.ts).

### Что хочется получить

1. Положил папку с разнородными файлами (nginx + json + plain) — каждый разбирается своим парсером.
2. Колонки/поля в UI понимают, что `request_uri` — только из `nginx.log`, а `trace_id` — из всех JSON-файлов.
3. (Перспективно) k8s pod = ресурс, контейнеры = его лог-потоки; архив = ресурс с N файлов; «логическое приложение» из файлов в разных папках.

---

## Вариант A — Per-file parser в DirectoryLogSource (минимальный)

### Суть
Ресурс ≡ существующий `DirectoryLogSource`. Расширяем ingest-pipeline так, чтобы парсер выбирался **per-file** внутри одного источника. Каждый `relPath` может иметь свой `parserId`. Без новой БД-сущности.

### Схема данных
- `DirectoryLogSource` получает опциональное поле:
  ```ts
  readonly fileParsers?: Readonly<Record<string /* relPath */, string /* parserId */>>;
  ```
- `SourceRecord.parserId` остаётся одним значением (для бейджа корня), плюс параллельное `fileParserIds?: Record<relPath, string>`.
- БД: миграции почти нет (см. ниже).

### Ingest
В [src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts):
- Состояние парсера становится `Map<filePath, {parserId, continuationRegex}>`.
- При каждом новом `filePath`: смотрим `source.fileParsers?.[path]` → `source.parserId` → auto-detect по первому батчу **этого файла**.
- Continuation-буфер уже сбрасывается на path-boundary — переиспользуем.
- `onParserDetected` эмитит один раз на каждый новый `filePath` (а не один раз на источник).

### БД и миграция
- `source.meta_json.fileParsers` — мердж в JSON, без миграции.
- (Опц.) колонка `entry.parser_id` или `@parser` в `fields_json` — нужна, если хотим фильтр «записи такого-то парсера». Можно отложить.

### Workspace/UI
- Sidebar: подключаем `LvFileNode.parserId` end-to-end (показ бейджа, context-menu «Set parser…»).
- Tabs: compound id `<sourceId>::<relPath>` уже есть, ничего не меняем.
- Column picker: на вкладке файла — `parserDefaultColumns` именно его парсера. На aggregate-вкладке — общий набор.

### Field Schema
- `field_meta` остаётся per-source. Для per-file UI-бейджа нужен один из двух подходов:
  - Дёшево: расширить `FieldDescriptor.perFile: Array<{sourceId, filePath, occurrences, presenceRate}>`, агрегацию делать на лету.
  - Точнее: добавить таблицу `field_meta_file(source_id, file_path, key, …)`. Дороже на запись, но даёт честный per-file picker.

### Открывающиеся сценарии
Папка с разнородными файлами — да. K8s pod / «логическое приложение из файлов в разных папках» — **нет**.

### Сложность
**Small-Medium.** 1-2 ADR. Без миграции БД.

### Trade-offs
**+** Минимум кода и риска; полная backward-совместимость; нулевая миграция.
**−** «Ресурс» как идея остаётся неявной; field_meta per-source неточен; не покрывает k8s/cloud.

### Когда выбирать
Пользователь работает в основном с локальными папками. Хочет «положил папку — оно работает».

---

## Вариант B — Ресурс как UI-группа в Workspace (workspace-only)

### Суть
Backend (coordinator, indexer, БД) **не трогаем**. Каждый файл = отдельный физический `LogSource` со своим парсером и `field_meta`. В `useWorkspaceStore` добавляем `resources: ResourceGroup[]` — упорядоченные UI-группировки поверх существующих source-id.

### Схема данных
В [src/hooks/use-workspace.ts](src/hooks/use-workspace.ts):
```ts
export interface ResourceGroup {
  readonly id: string;          // 'res:<uuid>'
  readonly name: string;
  readonly accent?: string;
  readonly memberSourceIds: ReadonlyArray<string>;
  readonly defaultFilter?: LogFilter;
  readonly defaultColumns?: ReadonlyArray<LvColumnPref>;
}
```
- `WorkspacePersistedV1` → v2: новое поле `resources`. Нужна `persist.migrate`.
- В `openTabs` появляется тип id `res:<groupId>` (вкладка-агрегатор).

### Ingest и БД
Никаких изменений. Schema-v5 без правок.

### Workspace/UI
- Sidebar: новая верхнеуровневая нода `LvResourceNode` с accent-полоской. Дети — обычные file/folder. Drag-drop sources между группами.
- Topbar: «New Resource…» → модал создания группы.
- Tabs: `res:<id>` рендерится как агрегатор (`filter.sources = members`).
- Filter: можно сохранить `defaultFilter` группы и применять при активации.

### Field Schema
`field_meta` уже per-source, `getFieldSchema(memberSourceIds)` принимает массив — изменений нет.

### Открывающиеся сценарии
- «Логическое приложение из N файлов в разных папках» — да.
- Цветная маркировка прод/стейдж независимо от физической раскладки.
- K8s/cloud — частично (только когда соответствующие adapter'ы появятся как самостоятельные sources).
- Папка с разнородными файлами — **только через разбивку папки на N независимых source-ов**, что ломает текущий «папка = один source» UX.

### Сложность
**Small.** Только UI + workspace persist v2. 1 ADR.

### Trade-offs
**+** Минимум риска для backend'а; естественно сочетается с любым будущим; сериализуется тривиально.
**−** Не решает реальную проблему heterogeneous-файлов в одной папке — только маскирует её ручной группировкой. При разбивке папки на N sources — 50 файлов = 50 кружков в sidebar.

### Когда выбирать
Нужна гибкая группировка «по приложению/окружению» поверх любых будущих источников, и не хочется ждать миграцию БД. Ранняя стадия проекта.

---

## Вариант C — Resource как first-class entity в БД (фундаментальный)

### Суть
Новая таблица `resource(id, name, kind, meta_json)`. У `source` появляется опциональный FK `resource_id`. `LogSource` остаётся single-parser, но логически принадлежит ресурсу. Ресурс — единица user-facing идентичности и группировки.

### Схема данных
Schema-v6:
```sql
CREATE TABLE resource (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,    -- 'directory' | 'k8s-pod' | 'logical' | 'snapshot' | 'live'
  name       TEXT NOT NULL,
  meta_json  TEXT,             -- accent, alias, defaultFilter, defaultColumns
  created_at INTEGER NOT NULL
);
ALTER TABLE source ADD COLUMN resource_id TEXT REFERENCES resource(id) ON DELETE SET NULL;
CREATE INDEX idx_source_resource ON source(resource_id);
```
Новый файл [src/core/types/log-resource.ts](src/core/types/log-resource.ts) с типом `LogResource`. RPC расширяется: `listResources / createResource / attachSourceToResource / removeResource`.

### Ingest
Pipeline не меняется. `addSource(...)` принимает опциональный `resourceId`; при импорте папки coordinator может создать `resource(kind='directory') + N sources` (если хотим разбивать), или один `directory` source внутри ресурса.

### БД и миграция
Schema-v6: новая таблица + ALTER. Старые источники с `resource_id = NULL` продолжают работать как «не привязанные».

### Workspace/UI
- Sidebar: верхний уровень = ресурсы; под ресурсом — sources.
- Tabs: compound id меняется на `<resourceId>::<sourceId>::<relPath?>`. **Workspace v1 → v2 migration** обязательна.
- `LogFilter` получает `resources: ResourceId[] | null`.
- Колонки могут быть per-resource (`resource.meta_json.defaultColumns`).

### Field Schema
`field_meta` остаётся per-source; `getFieldSchema(resourceId)` агрегирует поверх sources. Per-file внутри source — не решает (нужно сочетать с A).

### Открывающиеся сценарии
K8s pod / cloud / snapshot / «логическое приложение» — естественно. Серверные агрегации поверх ресурса — простой JOIN.
Папка с разнородными файлами в одном source — **по-прежнему не решена**.

### Сложность
**Medium-Large.** 2-3 ADR. Миграция БД + миграция workspace + изменение tab id schema.

### Trade-offs
**+** Чистая mental model; first-class entity; готовность к k8s/cloud; symmetric — directory становится одним из видов ресурса.
**−** Самая большая миграция; без A heterogeneous-файлы не решены; риск преждевременной абстракции, пока нет k8s/cloud-адаптеров.

### Когда выбирать
В roadmap есть k8s/cloud/stream и хочется однородной модели на годы вперёд. Готовы потратить 2-3 итерации.

---

## Вариант D — Гибрид: Resource entity + per-file parser

### Суть
Берём C (resource как first-class) **и** A (per-file parser dispatch). Двухуровневая модель:
- **Resource** — пользовательская единица: «мой проект X», «k8s pod Y». Содержит 1+ sources.
- **Source** — физический поток (папка / файл / stream). Может содержать heterogeneous файлы с per-file парсером.

### Схема данных
- Из C: таблица `resource`, колонка `source.resource_id`, тип `LogResource`.
- Из A: `DirectoryLogSource.fileParsers`, `SourceRecord.fileParserIds`.
- Опционально: новая таблица `field_meta_file(source_id, file_path, key, …)` для аккуратной per-file schema.

### Ingest
Из A: per-file parser switch в orchestrator. При drag-drop папки UI спрашивает «один ресурс из папки» или «ресурс из набора файлов» (k8s-style).

### БД и миграция
Schema-v6 одним шагом: `resource` + `source.resource_id` + (опц.) `field_meta_file`. Workspace v2.

### Workspace/UI
- Sidebar: 3 уровня — Resource → Source → File. Иконки/бейджи: accent ресурса, parser-бейдж файла.
- Tabs: id `<resourceId>::<sourceId>` или с `::<relPath>` для файлового tab. Спец-id `res:<id>` для агрегата.
- Column picker: chain priority `tweaks (user) → resource.defaultColumns → source.parserDefaultColumns → parserDefaults(filePath)`.

### Field Schema
`field_meta` (per-source) + `field_meta_file` (per-file). `getFieldSchema(scope)` где scope = `{resourceId} | {sourceIds} | {sourceId, filePath}`. UI-бейджи: `shared / partial / unique`.

### Открывающиеся сценарии
Полный набор: k8s pod, drag-drop папки с heterogeneous файлами, архив, «logical app», per-file поля в picker'е.

### Сложность
**Large.** 3-4 ADR. Согласованная миграция БД и workspace + изменение compound id.

### Trade-offs
**+** Самая выразительная модель; покрывает все обозримые сценарии; каждая ось расширения решается на своём уровне.
**−** Самый большой объём работы; per-file `field_meta` ~2× запись в indexer'е (нужен бенчмарк); сложнее тестировать.

### Когда выбирать
Концепция ресурса — core-абстракция на годы. Готовы фазировать релиз: schema+API → UI → per-file field_meta.

---

## Сравнительная таблица

| Критерий | A (per-file parser) | B (workspace group) | C (resource entity) | D (hybrid) |
|---|---|---|---|---|
| **Complexity** | Small-Medium | Small | Medium-Large | Large |
| **Schema migration** | Не нужна (опц. v6 ALTER) | Нет (workspace v2) | v6: new table + ALTER | v6: new table + ALTER + field_meta_file |
| **UI churn** | Малый | Средний | Большой | Большой |
| **Future-proofness** | Низкая (только папка) | Средняя (UI потолочный) | Высокая (k8s/cloud) | Высочайшая |
| **Perceived UX** | Хороший для папок | Гибкая группировка | Чистая модель | Лучшая |
| **Backward compat** | Полная | Workspace v1→v2 | Workspace + tab id schema | Workspace + tab id + БД |
| **«k8s pod = ресурс»** | Нет | Частично (UI-группа) | Да | Да |
| **«папка с разнородными»** | Да | Через разбивку на N sources | Через A | Да (нативно) |
| **Per-file field schema** | Через дополнение | Нет (агрегация on the fly) | Нет (без A) | Да |
| **ADR-нагрузка** | 1-2 | 1 | 2-3 | 3-4 |

---

## Рекомендация

**A первым шагом, с явно зарезервированной целью эволюции к D**, через траекторию A → B-light → C → D.

### Почему A первым

Самый востребованный сценарий — drag-drop папки с разнородными файлами — уже **на 80% готов** в коде:
- `LvFileNode.parserId` объявлен.
- compound id `<sourceId>::<relPath>` работает в tabs/selection.
- `FieldDescriptor.perSource` существует.

Не хватает только per-file dispatch'а в orchestrator'е и подключения `parserId` в sidebar. 1-2 ADR, ноль миграций, сразу выдаёт ценность.

### Почему не B первым

B хорош, но **переворачивает UX импорта папок**: сейчас «папка = source», а B предлагает «группа = N отдельных sources». Не решает heterogeneous-файлы внутри папки — только маскирует.

### Почему не C сразу

Без A внутри C heterogeneous-сценарий **не решён**: ресурс содержит monolithic sources. Большая миграция (resource table + tab id) — инвестиция, которую стоит делать **после** валидации UX «ресурса» на A+B-уровне.

### Почему не D сразу

D — куда хотим прийти. Но за один присест: 3-4 параллельных ADR + миграция БД + миграция workspace + изменение compound id + бенчмарк per-file field_meta. В 1.5–2× дороже последовательной траектории и не даёт результатов раньше.

### Предлагаемая траектория

1. **A** (сейчас): per-file parser в `DirectoryLogSource`. Подключаем `LvFileNode.parserId` end-to-end. 1-2 недели.
2. **B-light**: простая `ResourceGroup` в workspace **только для группировки** sources в sidebar (не замена папке). Совместима с любым будущим. ~1 неделя.
3. **C**: когда появится первый k8s/url-bundle/snapshot use-case — мигрируем ResourceGroup в БД. Workspace v2. 2-3 недели.
4. **D-tail**: при необходимости точной per-file schema — добавляем `field_meta_file` с бенчмарком. ~1 неделя.

Каждый шаг — атомарный ADR, маленькая миграция, консистентный UI.

### Альтернатива «сразу нормально»

Если есть продуктовое давление — **D в 3 фазы**: (1) landing schema-v6 + resource API без UI; (2) перенос UI на resource-tabs; (3) per-file `field_meta`. Не одним PR.

---

## Critical files

### Для A (рекомендованный первый шаг)
- [src/core/types/log-source.ts](src/core/types/log-source.ts) — добавить `fileParsers` в `DirectoryLogSource`.
- [src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts) — per-file dispatch.
- [src/workers/coordinator/coordinator.ts](src/workers/coordinator/coordinator.ts) — пробросить `fileParserIds` в `SourceRecord`.
- [src/ui/contracts/lv-types.ts](src/ui/contracts/lv-types.ts) — `LvFileNode.parserId` end-to-end.
- [src/hooks/use-directory-trees.ts](src/hooks/use-directory-trees.ts) — подмешать `parserId` per file в дерево.

### При движении к C/D дополнительно
- [src/workers/indexer/db/](src/workers/indexer/db/) — schema-v6 (new `resource` table, ALTER `source`).
- [src/workers/indexer/](src/workers/indexer/) — per-file `field_meta_file` (D only).
- [src/hooks/use-workspace.ts](src/hooks/use-workspace.ts) — workspace v2 + resource refs в `openTabs`.
- [src/core/rpc/coordinator.contract.ts](src/core/rpc/coordinator.contract.ts) — resource API.

---

## Фаза 1: implementation plan для варианта A

### Цель фазы

Папка, перетянутая в приложение, **обнаруживает парсер для каждого файла отдельно**. UI показывает на каждом файле бейдж с его парсером и предлагает соответствующий column-preset. Backward compatibility: существующие источники продолжают работать без изменений (auto-detect остаётся fallback'ом).

### Шаги

#### 1. Доменные типы (`src/core/types/`)

- **[log-source.ts](src/core/types/log-source.ts):** в `DirectoryLogSource` добавить
  ```ts
  readonly fileParsers?: Readonly<Record<string /* relPath */, string /* parserId */>>;
  ```
  `parserId` (single) сохраняется как общий fallback для всего источника.
- **[log-source.ts](src/core/types/log-source.ts):** в `SourceRecord` (если он определён там же или в [src/core/types/source-record.ts](src/core/types/source-record.ts) — проверить) добавить
  ```ts
  readonly fileParserIds?: Readonly<Record<string /* relPath */, string /* parserId */>>;
  ```
  Для бейджа в sidebar и для column-pres'ета на per-file вкладке.

#### 2. Ingest pipeline ([src/workers/coordinator/ingest/ingest-orchestrator.ts](src/workers/coordinator/ingest/ingest-orchestrator.ts))

- Текущее состояние парсера (один `parserId` + `continuationRegex` на весь поток) заменить на
  ```ts
  const perFile = new Map<string /* path */, { parserId: string; continuationRegex?: string }>();
  ```
- Логика выбора парсера на каждом новом `path`:
  1. `source.fileParsers?.[path]` (явный override per-file).
  2. `source.parserId` (общий override источника).
  3. Auto-detect через `registry.pick(sample)` на первом батче **этого** path'а.
- `onParserDetected` эмитит один раз на каждый новый `filePath`: `{filePath, parserId, defaultColumns}` (сейчас эмитится один раз на источник — расширить контракт).
- Continuation-буфер уже сбрасывается на path-boundary — проверить и переиспользовать.
- `parserPool.parse` уже принимает `parserId` per call — менять не нужно.

#### 3. RPC и coordinator ([src/workers/coordinator/coordinator.ts](src/workers/coordinator/coordinator.ts))

- При получении `onParserDetected({filePath, parserId, defaultColumns})` обновляет `sourceRecord.fileParserIds[filePath] = parserId` и пробрасывает в ViewStore.
- При persist source в SQLite сохраняет `fileParsers` map в `source.meta_json` (мердж). При resume — читает обратно в `DirectoryLogSource.fileParsers` и в `SourceRecord.fileParserIds`.
- В контракте [src/core/rpc/coordinator.contract.ts](src/core/rpc/coordinator.contract.ts) добавить опциональный метод `setSourceFileParser(sourceId, filePath, parserId | null)` — для context-menu «Set parser…».

#### 4. UI ([src/ui/contracts/lv-types.ts](src/ui/contracts/lv-types.ts), `src/ui/components/sidebar/`)

- `LvFileNode.parserId` уже объявлен — заполнить его в [src/hooks/use-directory-trees.ts](src/hooks/use-directory-trees.ts) (или там где собирается catalog) из `SourceRecord.fileParserIds[relPath]`.
- Sidebar: показать parser-бейдж на `LvFileNode` (стиль `LvFolderNode.parserId`, если он уже есть, иначе мини-чип справа от имени).
- Context-menu файла: пункт «Set parser…» → выбор из `coordinator.listParsers()` + `listCustomParsers()` → `setSourceFileParser`.
- Column picker ([src/ui/components/filter/LvColumnPicker.tsx](src/ui/components/filter/LvColumnPicker.tsx)): когда `activeTabId` — конкретный файл с известным `parserId`, в качестве подсказки defaults использовать `parserDefaultColumns` именно этого парсера (через `coordinator.getParserMeta(parserId)`).

#### 5. БД ([src/workers/indexer/](src/workers/indexer/))

- Schema-v6 **не нужна** для базовой версии. `source.meta_json` уже JSON — добавляем туда `fileParsers: Record<string, string>` через стандартный мердж.
- (Опционально, отдельным PR) — колонка `entry.parser_id` или `@parser` в `fields_json`, если потребуется фильтр «записи такого-то парсера». Не блокирует фазу 1.

#### 6. ADR

Создать через `/adr per-file parser dispatch`:
- Контекст: `DirectoryLogSource` имел один парсер на весь источник; реальные папки часто содержат файлы разных форматов.
- Решение: per-file dispatch в orchestrator'е, persist через `source.meta_json.fileParsers`, end-to-end `LvFileNode.parserId`.
- Альтернативы: B / C / D (ссылка на этот plan-файл).
- Последствия: backward-compatible; field_meta остаётся per-source; per-file field schema — отдельный future ADR (часть варианта D).

### Out of scope для фазы 1

- Per-file `field_meta` / per-file column auto-apply (отложено в D-tail).
- `ResourceGroup` в workspace (фаза 2, B-light).
- `resource` таблица в БД (фаза 3, C).
- Workspace v2 / изменение compound id (только при C).
- Bench индексатора (нужен только при добавлении `field_meta_file` в D-tail).

### Чек-лист готовности фазы 1

1. `pnpm gen:fixtures` → `.tmp/` с разнородными файлами.
2. Drag-drop папки `.tmp/` → каждый файл в sidebar показывает свой parser-бейдж (pino, nginx-combined, app-text, json-lines).
3. Context-menu файла → «Set parser…» → выбор custom-парсера → перезапись `source.meta_json.fileParsers` → re-ingest (на этом этапе re-ingest можно реализовать как remove + re-add, оптимизацию оставить на потом).
4. Перезапуск приложения → workspace восстанавливает per-file парсеры из `source.meta_json`.
5. На вкладке `__all__` ресурса записи из nginx-файла содержат `request_uri`, из JSON — `trace_id`; на индивидуальной вкладке column picker предлагает соответствующий preset.
6. `pnpm test`, `pnpm lint`, `pnpm build` зелёные.

---

## Verification

После реализации A:
1. `pnpm gen:fixtures` → в `.tmp/` лежат файлы разных форматов (pino, bunyan, app.log, nginx, mixed).
2. `pnpm dev` → перетащить **папку** `.tmp/` в приложение.
3. В sidebar каждый файл показывает свой parser-бейдж (pino, nginx-combined, app-text, …).
4. Открыть вкладку `mixed.log` → проверить, что многострочные блоки распознаны корректно (multiline buffer сбрасывается на path-boundary).
5. На вкладке файла column picker предлагает `parserDefaultColumns` именно его парсера.
6. На вкладке `__all__` ресурса агрегируются все файлы; колонка `request_uri` присутствует только для строк из nginx-файла, колонка `trace_id` — только для JSON-файлов.
7. Перезапустить — workspace восстанавливает выделение, parser per file сохранён (через `source.meta_json.fileParsers`).

---

## Концептуальные идеи (расширенный scope парсеров)

> Брейншторм верхнего уровня. Не имплементационный план — это карта возможных направлений, которую переразложим на фазы позже.

### 1. Разделить три слоя, которые сейчас слиты

```
File reader     — формат-контейнер: text-lines / json-doc / json-array / xml / csv / binary / gzip
   ↓ выдаёт raw record blocks
Record parser   — схема записи: pino / winston / log4j / nginx / custom-regex / xpath
   ↓ выдаёт LogEntry с динамическими полями
Field mapper    — нормализация: lvl → @level, ts → @ts, app → @service
   ↓ выдаёт LogEntry с каноничными полями
```

Сегодня слои 1 и 2 склеены — парсер сам решает «как читать» и «как понять». Это закрывает дорогу к XML/CSV/JSON-документу. Разделение даёт reuse: один record-parser (pino-shape) поверх JSON Lines и XML-обёртки — одно и то же.

### 2. Парсер как first-class артефакт (манифест)

Не функция в registry, а декларативный манифест с identity, версией, тестами:

```ts
{
  id: 'pino',
  version: '1.2.0',
  label: 'Pino (Node.js)',
  author: 'lv-builtin' | 'user' | 'community',
  file: { format: 'text-lines', extensions: ['.log', '.jsonl'], signatures: [/* magic */] },
  record: { kind: 'json' | 'regex' | 'grok' | 'jsonpath' | 'xpath' | 'js' },
  fields: [ /* bindings → canonical names */ ],
  defaultColumns: [],
  tests?: [{ input, expected }]
}
```

`CustomParserDef` уже близок к этому — расширить и сделать **единым форматом и для built-in, и для custom**. Built-in перестают быть TS-кодом, становятся декларативными манифестами (опц. hot-path остаётся в коде).

### 3. Каталог парсеров — first-class экран

В icon rail слот `parsers` уже есть. Содержание:

- **Browse** — built-in: pino / bunyan / winston / log4j / log4net / nginx / apache / syslog / journald / k8s / docker / IIS / Postgres slow query / …
- **My parsers** — локальные custom (IndexedDB).
- **Used in this workspace** — фактически в работе.
- **Import / Export** — file picker / drag-drop.
- Search + теги по системе и формату.

### 4. Форматы-контейнеры — отдельная ось

| Формат | Стратегия |
|---|---|
| text-lines | существующий line-by-line + multiline fold |
| JSON Lines | text-lines + JSON record parser |
| JSON document / array | streaming JSON (clarinet / oboe), JSONPath к массиву записей |
| XML | streaming SAX (sax-js / htmlparser2), XPath к record-элементу |
| CSV / TSV | papaparse, header row → имена полей |
| gzip / zstd | прозрачный distreaming поверх любого формата |
| zip / tar | архив = virtual directory (адаптер `snapshot` уже намечен) |
| binary (msgpack, protobuf) | edge-case, отложить |

`LogSourceAdapter` стримит **record blocks**, line-based — частный случай (record ≡ строка).

### 5. Каноничные поля (ECS / OpenTelemetry-style)

Чтобы UI-колонки не зависели от парсера. Парсер маппит свои поля в канон:

```
@ts, @level, @message
@service, @host, @env
@http.method, @http.status, @http.uri, @http.duration_ms
@trace.id, @span.id
@user.id
@error.type, @error.message, @error.stack
@k8s.namespace, @k8s.pod, @k8s.container
```

Pino `lvl=20` → `@level=debug`. Nginx `$status=502` → `@http.status=502 + @level=error`. Исходные поля остаются в `fields` для drill-down. Близко к **ECS (Elastic Common Schema)** — взять его подмножество как baseline.

### 6. Шаринг — уровни

| Уровень | Носитель | Сценарий |
|---|---|---|
| Локально | IndexedDB | «мой парсер на этой машине» |
| **Файл** `.lvparser.json` | export/import через File System Access | «скинул в slack» |
| **Pack** `.lvparsers.json` (массив) | то же | «набор для команды» |
| **URL** | paste URL → fetch + verify | «парсер в репо/wiki» |
| **Inline link** | `https://app/?import=<base64>` или `lv://parser?…` | one-click из чата |
| **Gist / Git repo** | автодетект gist URL → fetch raw | open-source наборы |
| **Marketplace** (далеко) | central registry | community contributions |

Минимум фазы — file export/import + URL paste.

### 7. Безопасность шаринга

Главная угроза — `kind: 'js-function'` (execute arbitrary code в worker'е). Меры:

- **Запретить js-function для импортированных** парсеров (только для своих локальных).
- Isolated worker с урезанным API.
- Checksum/подпись в манифесте.
- Trust-флаг с явным confirm перед первым прогоном.

Regex / grok / jsonpath / xpath — относительно безопасны (ReDoS лечится timeout'ом).

### 8. Autodetect — обогатить сигналами

Сегодня только первая строка. Дать парсеру:

- `signatures` — magic-bytes / regex на начало файла.
- `extensions` — `.log`, `.access`, `.audit`, `.evtx`.
- `filenamePatterns` — `nginx.access.log`, `application.log`, `kube-apiserver-*.log`.
- `schemaProbe` — для JSON: «есть ли ключи `level + msg + time`».
- `confidence` с tie-breaker.

Auto-detect возвращает **ranked list с confidence** — UI показывает «Pino (95%), возможно Bunyan (40%)» с быстрым переключением.

### 9. UI создания custom-парсера — wizard, не form

1. **Paste sample** → live preview сырых строк.
2. **Choose format** (auto-detected, можно override) — text-lines / JSON / XML / CSV / regex.
3. **Build extractor** — regex builder с подсветкой групп, JSONPath picker по дереву, XPath builder.
4. **Map fields** — drag-drop из обнаруженных полей в каноничные слоты.
5. **Test** — прогон на sample, показ результирующего `LogEntry[]`.
6. **Save** локально + опционально **Export**.

### 10. Новое в доменной модели (резюме)

- `Parser` — entity с identity, версией, манифестом, опц. подписью.
- `Source.fileParsers` (per-file) — фаза 1 / вариант A.
- `ParserPack` (опц.) — bundle of parsers.
- `LogEntry.parserId` (хотя бы как `@parser` в `fields_json`) — для фильтрации «откуда поле пришло».
- Канон полей (`@-namespace`) — формализовать как enum/constant + mapping helper в [src/core/types/](src/core/types/).

### Открытые вопросы для следующего раунда

- Реальный контур форматов: line-based + JSON достаточно / нужен XML / CSV / архивы?
- Шаринг в фазе 1: file export/import / URL / marketplace?
- Канон полей: ECS-подмножество или свой?
- Custom parser должен уметь JS-function или только regex/grok/jsonpath/xpath (безопаснее)?
- Manifests для built-in: декларативный формат сразу или сначала только для custom?
