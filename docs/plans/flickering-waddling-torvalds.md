# Logical fields (`~`-namespace) — работа с одним понятием поперёк форматов

## 1. Context

В реальных логах одно и то же логическое понятие записывается по-разному в зависимости от формата и конвенции сервиса. Канонический пример — `trace_id`:

- `pino.jsonl` → `{"trace_id": "abc"}`
- `bunyan.jsonl` → `{"traceId": "abc"}`
- `nginx-access.log` → парсер выдаёт поле `http_x_trace_id`
- `app.log` → plain-text `... traceId=abc` (regex по message)

Сейчас в проекте есть `LogEntry.fields` (произвольный JSON от парсера) и динамическая field-schema с `@`-namespace для built-in атрибутов ([ADR-0017](../adr/0017-dynamic-field-schema.md)). Но **нет слоя «логических полей»**: пользователь не может одним кликом сказать «trace_id — это вот эта штука во всех моих файлах» и дальше использовать её как обычное поле в filter / group / column.

В индустрии это решено давно: **Datadog Attribute Remapper + Standard Attributes**, Elastic ECS, Splunk FIELDALIAS, Loki `label_format`. Datadog подход — наиболее близкий: chain попыток (`sources: ["traceId", "trace_id", ...] → target: "trace_id"`) + каталог Standard Attributes (`http.*`, `user.*`, `trace_id`, `network.*`, …).

**Outcome:** ввести в проект слой **logical fields** в `~`-namespace, global workspace-wide. Активируется явно пользователем (из built-in каталога или custom). Поверх любого источника / формата ведёт себя как обычное поле в filter / group / column picker'ах.

Видимость самого формата файла остаётся **implicit** (расширение в имени файла в sidebar). Никаких parser-badges, parser-фильтр-чипов, отдельной `@parser` колонки — эту ветку отбрасываем.

## 2. Mapping model: chain extractors

Logical field = именованная цепочка extractor'ов. При resolve берём первый non-null:

```ts
interface LogicalField {
  name: string;                    // 'trace_id', 'user_id', 'http.status', ...
  type: 'string' | 'number' | 'bool';
  extractors: Extractor[];         // try in order, first non-null wins
  source: 'builtin' | 'user';
  enabled: boolean;
}

type Extractor =
  | { type: 'field'; path: string }                      // JSONPath-like, $.a.b
  | { type: 'regex'; on: 'message' | 'raw'; pattern: string; flags?: string; group?: string };
  // future: { type: 'expr'; expression: string } — Phase 3+
```

Пример `trace_id`:

```yaml
name: trace_id
type: string
extractors:
  - { type: field, path: trace_id }
  - { type: field, path: traceId }
  - { type: field, path: tid }
  - { type: field, path: dd.trace_id }
  - { type: regex, on: message, pattern: 'tr[ace]?[_-]?id[=:]\s*(?<v>[\w-]+)', flags: i, group: v }
```

Эта одна цепочка покрывает все 4 файла из §1.

### Что НЕ делаем

- Полноценный expression DSL (Vector VRL-style) — отложено. Дверь открыта: новый extractor type `expr` добавляется в цепочку, не ломая существующих определений.
- Per-format / per-source mapping (Splunk FIELDALIAS / ECS rename) — не масштабируется на mixed-convention внутри одного формата.
- Inline label_format в queries (Loki) — не наш UX.

## 3. Namespace и storage

- Имена логических полей живут в `~`-namespace: `~trace_id`, `~user_id`, `~http.status`. Не конфликтуют с `@`-built-ins и сырыми ключами из `fields`.
- Scope — **global workspace-wide**. Активные logical fields доступны во всех табах и всех источниках.
- Persistence — рядом с workspace state (там же, где `LvTab[]`, `LvTweaks`). Один JSON-документ: `LogicalFieldsConfig { activeFieldIds, customFields }`.
- Built-in каталог — статический list в коде, версионируется вместе с релизом. User-defined — в persistent storage.

## 4. Built-in каталог (стартовый набор)

Baseline берём из Datadog Standard Attributes, адаптируем под наши форматы (pino/bunyan/nginx/syslog/app-text):

```ts
// src/core/logical-fields/catalog.ts
[
  { name: 'trace_id', type: 'string', extractors: [
      { type: 'field', path: 'trace_id' },
      { type: 'field', path: 'traceId' },
      { type: 'field', path: 'tid' },
      { type: 'field', path: 'dd.trace_id' },
      { type: 'field', path: 'http_x_trace_id' },
      { type: 'regex', on: 'message', pattern: 'tr[ace]?[_-]?id[=:]\\s*(?<v>[\\w-]+)', flags: 'i', group: 'v' },
  ]},
  { name: 'span_id', type: 'string', extractors: [ ...{ path: span_id | spanId | sid } ]},
  { name: 'request_id', type: 'string', extractors: [ ...{ path: request_id | requestId | reqId | req_id | http_x_request_id } ]},
  { name: 'user_id', type: 'string', extractors: [ ...{ path: user_id | userId | usr.id | uid } ]},
  { name: 'session_id', type: 'string', extractors: [ ...{ path: session_id | sessionId | sid } ]},
  { name: 'service', type: 'string', extractors: [ ...{ path: service | service.name | logger } ]},
  { name: 'host', type: 'string', extractors: [ ...{ path: host | hostname | host.name } ]},
  { name: 'http.method', type: 'string', extractors: [ ...{ path: http.method | method } ]},
  { name: 'http.status', type: 'number', extractors: [ ...{ path: http.status_code | status | response_code } ]},
  { name: 'http.path', type: 'string', extractors: [ ...{ path: http.url | request_uri | path } ]},
  { name: 'error.kind', type: 'string', extractors: [ ...{ path: error.kind | exception_type | err.type } ]},
  { name: 'error.message', type: 'string', extractors: [ ...{ path: error.message | err.message | exception_message } ]},
]
```

По умолчанию все **disabled**. Активирует юзер вручную.

## 5. Resolution: read-path и worker-path

### Read-path (UI rendering)
Per-row resolver в `LogEntry` → `(fieldName) => unknown`:
- Берём activeLogicalFields из workspace state.
- Для каждой записи: `resolveLogicalField(entry, field)` бежит по extractors:
  - `field` → lookup в `entry.fields` через JSON-path
  - `regex` → match по `entry.message` / `entry.raw`
- Кэш per-field per-entry внутри одного render-pass (cheap memoization).

### Worker-path (SQL filter + group + groupCounts)
Через `fieldKeyToSql('~name')` → SQL-expression:
- `field`-extractor → `JSON_EXTRACT(entry.fields_json, '$.<path>')`
- `regex`-extractor → `REGEXP_EXTRACT_GROUP(entry.message, '<pattern>', '<group>')` через REGEXP UDF в SQLite (ADR-0011 «server-side regex» уже под это закладывался)
- COALESCE всех вместе:

```sql
COALESCE(
  JSON_EXTRACT(entry.fields_json, '$.trace_id'),
  JSON_EXTRACT(entry.fields_json, '$.traceId'),
  JSON_EXTRACT(entry.fields_json, '$.tid'),
  REGEXP_EXTRACT_GROUP(entry.message, 'tr[ace]?[_-]?id[=:]\s*(?<v>[\w-]+)', 'v')
)
```

WHERE `... IN (?, ?)` и GROUP BY работают без дополнительной логики поверх — стандартный flow `buildClause` + `groupFieldExpr`.

**Performance trade-off:** делаем chain inline в SQL, без материализации. Если будет тормозить на больших фильтрах — Phase 2 добавит computed-column в indexer (precompute logical fields при ingest). Не сейчас.

## 6. UI

### Settings → Logical Fields panel (новая)

Вход: gear-кнопка в filter-bar или header. Содержимое:

- **Active fields** — список включённых (built-in и custom вместе). У каждого:
  - Имя (`~trace_id`), coverage badge («3/4 sources, 12 480 / 12 500 lines»)
  - [Edit], [Toggle off], [Show coverage] (drill-down per source)
- **Catalog** — список доступных built-in templates. У каждого:
  - Имя, описание, preview chain'а, [Activate]
- **+ New custom field** — wizard:
  - Name (validate: `[a-z_][a-z0-9_.]*`), type
  - Add extractor (field или regex), reorder, test against open sources
  - Live coverage preview

### Coverage drill-down (per-source)
```
✓ pino.jsonl    extractor #1 ($.trace_id)      230/230
✓ bunyan.jsonl  extractor #2 ($.traceId)       156/156
✓ app.log       extractor #6 (regex)            89/103
✗ nginx.log     no match    [Add extractor for nginx]
```

### Filter bar / Group-by / Column picker

- `LvAddFieldFilter`, `LvGroupBySelect`, `LvColumnPicker` показывают активные logical fields как новую секцию **"Logical"** наверху. Имена с префиксом `~`.
- В group-by picker — pinned-section: `@level`, `@source.name`, `@file`, потом активные `~`-поля, потом dynamic из `fields`.
- В column picker — `~`-секция отдельно.

### Quick filter из строки
В `LvRow` / `LvRowDetail`: context-menu на значении (которое resolved через logical field) → "Filter by `~trace_id` = abc123". Это закрывает основной use-case корреляции (US-1).

## 7. Список изменений по файлам

### Core
- [src/core/types/logical-field.ts](../../src/core/types/logical-field.ts) — НОВЫЙ. Типы `LogicalField`, `Extractor`, `LogicalFieldsConfig`.
- [src/core/logical-fields/catalog.ts](../../src/core/logical-fields/catalog.ts) — НОВЫЙ. Built-in templates (§4).
- [src/core/logical-fields/resolver.ts](../../src/core/logical-fields/resolver.ts) — НОВЫЙ. `resolveLogicalField(entry, field)` + memoization helpers.
- [src/core/filter/field-key.ts](../../src/core/filter/field-key.ts) — extend: префикс `~` → строим COALESCE-выражение из конфига активных logical fields (передаётся через context).
- [src/core/filter/field-descriptor.ts](../../src/core/filter/field-descriptor.ts) — расширить FieldDescriptor `origin: 'builtin' | 'dynamic' | 'logical'`. Активные logical fields подмешиваются в field-schema.

### Worker
- [src/workers/indexer/sql/regexp-udf.ts](../../src/workers/indexer/sql/regexp-udf.ts) — НОВЫЙ (если ещё нет). Регистрация `REGEXP_EXTRACT_GROUP(text, pattern, group)` UDF на SQLite-инстанс indexer'а.
- [src/workers/indexer/aggregate.ts](../../src/workers/indexer/aggregate.ts) — `groupFieldExpr` для `~name` берёт chain из workspace-config (передаётся в filter/group payload через RPC).
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — `getFieldSchema` / `getGroupCounts` принимают `logicalFields: LogicalFieldsConfig` в payload и используют его в SQL builder'е.
- [src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts) — `logicalFieldsConfig` в state, прокидывается в RPC payload.

### UI
- [src/ui/components/settings/LvLogicalFieldsPanel.tsx](../../src/ui/components/settings/LvLogicalFieldsPanel.tsx) — НОВЫЙ. Settings panel.
- [src/ui/components/settings/LvLogicalFieldEditor.tsx](../../src/ui/components/settings/LvLogicalFieldEditor.tsx) — НОВЫЙ. Edit/create wizard.
- [src/ui/components/settings/LvCoverageDrill.tsx](../../src/ui/components/settings/LvCoverageDrill.tsx) — НОВЫЙ. Per-source coverage breakdown.
- [src/ui/components/filter/LvAddFieldFilter.tsx](../../src/ui/components/filter/LvAddFieldFilter.tsx) — секция "Logical" в picker'е.
- [src/ui/components/filter/LvGroupBySelect.tsx](../../src/ui/components/filter/LvGroupBySelect.tsx) — pinned built-ins + `~`-section + dynamic.
- [src/ui/components/filter/LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) — `~`-section.
- [src/ui/components/stream/LvRowDetail.tsx](../../src/ui/components/stream/LvRowDetail.tsx) — Meta-tab: показывать resolved logical fields с indicator'ом «via extractor #N».
- [src/ui/contracts/lv-column-registry.tsx](../../src/ui/contracts/lv-column-registry.tsx) — поддержка `~`-колонок (resolver-based render).

### Hooks / containers
- [src/hooks/use-logical-fields.ts](../../src/hooks/use-logical-fields.ts) — НОВЫЙ. Read/write `LogicalFieldsConfig` из workspace storage, экспонирует resolver.
- [src/hooks/use-field-schema.ts](../../src/hooks/use-field-schema.ts) — подмешивает активные `~`-поля в schema.
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — прокидывает `logicalFieldsConfig` в worker RPC + UI props.

### Не трогать
- Парсеры (`json-lines-parser.ts` etc.) — слой logical fields поверх их выходов.
- `LogEntry` / `ParsedRecord` — никаких новых полей. Logical fields резолвятся при чтении, не хранятся.
- Schema migration — не нужна (никаких новых колонок в `entry`).

## 8. Sequencing (commit-границы)

**Phase 1 — Foundation (MVP).**

1. `feat: types and built-in catalog for logical fields` — core types, catalog, без resolver'а.
2. `feat: read-path resolver for logical fields` — `resolveLogicalField` для UI rendering.
3. `feat: workspace persistence of LogicalFieldsConfig` — read/write через `use-logical-fields`.
4. `feat: LogicalFieldsPanel in Settings — list + activate built-ins` — UI без editor/coverage пока.
5. `feat: ~-namespace in field-schema + picker integration` — picker'ы видят активные logical fields. Только field-extractor через JSON_EXTRACT, regex пока не работает в SQL.
6. `feat: regex extractor + REGEXP_EXTRACT_GROUP UDF in indexer` — regex работает в filter/group SQL.

**Phase 2 — Power.**

7. `feat: coverage drill-down per source` — sample-query на open sources, считает per-extractor hits.
8. `feat: LvLogicalFieldEditor — create/edit custom logical fields` — full wizard.
9. `feat: quick filter from row value (~ field context menu)` — US-1 acceleration.

**Phase 3 — Polish (отдельная задача).**

- Discovery / auto-suggest (баннер «обнаружили похожее на trace_id»).
- Computed/composite fields (extractor type `expr`).

После Phase 1 — фича уже useful (built-in trace_id / request_id работают). Phase 2 — для серьёзного аудита/настройки.

## 9. ADR

Новый **ADR-0030 «Logical fields (`~`-namespace)»**:
- Контекст: trace_id в pino/bunyan/nginx/app-text поперёк форматов.
- Решение: chain extractors + built-in catalog + явная активация + `~`-namespace + global workspace scope.
- Альтернативы: per-format mapping (A), expression DSL (C, Vector VRL-style), inline в queries (Loki label_format).
- Reference: Datadog Attribute Remapper + Standard Attributes, Elastic ECS, Splunk FIELDALIAS.
- Связь: ADR-0017 (`@`-namespace расширяется до `~`), ADR-0028 (column registry поддерживает `~`-колонки), ADR-0011 (REGEXP UDF — теперь обязательна для logical fields).

## 10. Verification (end-to-end)

1. `pnpm gen:fixtures`; `pnpm dev` → `http://localhost:5173/log-viewer/app/`.
2. Загрузить `.tmp/pino.jsonl`, `.tmp/bunyan.jsonl`, `.tmp/nginx-access.log`, `.tmp/app.log`.
3. Открыть `__all__` таб.
4. **Activate built-in:** Settings → Logical Fields → catalog → `trace_id` → [Activate]. Видим в active list с coverage badge.
5. **Filter:** `LvAddFieldFilter` → секция Logical → выбрать `~trace_id`. Op `=`. Ввести значение из строки. Поток фильтруется поперёк всех 4 источников.
6. **Group:** `LvGroupBySelect` → `~trace_id`. Server-side aggregation работает (counts по реальным trace_id из всех источников).
7. **Column:** `LvColumnPicker` → активировать `~trace_id`. В строках видно значение (или `—` если нет).
8. **Coverage drill-down:** click на `~trace_id` в active list → видна per-source разбивка. Если nginx 0 hits — баннер с «Add extractor».
9. **Custom field:** "+ New" → `audit_id`, добавить два extractor'а (field + regex), сохранить. Доступен в picker'ах.
10. **Quick filter from row:** в `LvRowDetail` (Meta tab) click на значение `~trace_id` → context menu → "Filter by this" → автомат применяется фильтр.
11. **Single-file scenario:** открыть один pino.jsonl. `~trace_id` работает (одна цепочка, первый extractor pops). Coverage 1/1.
12. **Mixed.log:** открыть `.tmp/mixed.log`. Внутри plain-text + JSON. `~trace_id` срабатывает там, где находит — coverage показывает partial.
13. `pnpm lint && pnpm test && pnpm build` зелёные.
14. Скриншот: Settings panel с активными logical fields + aggregate-вью с filter `~trace_id=...` и group by `~trace_id` → `.tmp/screenshots/`.

## 11. Out of scope (явно)

- Сортировка по колонкам.
- Custom user-defined парсеры (отдельная Phase 2.C).
- Discovery / auto-suggest logical fields (Phase 3).
- Computed/composite logical fields (extractor type `expr`, Phase 3).
- Cross-workspace sharing logical fields (export/import — Phase 3).
- Merge-sort timestamps между источниками в aggregate (отдельный ADR).
- Format-aware визуализация (badges/иконки парсеров) — отброшено по итогам обсуждения. Расширение в имени файла в sidebar достаточно.
- Materialization logical fields в indexer (computed column) — только если будут проблемы с perf.
