# Multi-format log search — full roadmap

## Context

Log-viewer позиционируется как инструмент для одновременного просмотра нескольких файлов с разными форматами записей (pino JSONL, nginx access log, syslog, plain text, многострочные stacktrace'ы). Сегодня cross-format работа уже частично есть на storage-слое (ADR-0017: единая таблица `entry`, built-in `@`-namespace + `JSON_EXTRACT` для динамических ключей), но три критичных пробела ломают обещание UX:

1. **Free-text search фактически не работает.** После ADR-0016 (lazy resolve тела из OPFS) поле `query`/`queryMode`/`wholeWord`/`caseSensitive` намеренно НЕ транслируется в SQL — см. [src/core/filter/query.ts:42-45](../../src/core/filter/query.ts#L42-L45). Но и в read-path/lazy-resolver его никто не применяет. UI в [LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx) показывает substring/regex/FTS toggle, поиск не работает. FTS5 виртуальная таблица была удалена в [schema-v3-offsets.sql](../../src/workers/indexer/db/schema-v3-offsets.sql).
2. **Реальных парсеров мало.** Сейчас в [src/core/parsers/index.ts](../../src/core/parsers/index.ts) зарегистрированы только `jsonLinesParser` (приоритет 100) и `plainTextParser` (catch-all). CLAUDE.md обещает nginx/syslog/stacktrace, но кода нет — `gen-fixtures.mjs` создаёт файлы, которые приложение скармливает `plainTextParser`'у и теряет всю структуру.
3. **Cross-format UI «слепой».** В picker'ах (column/group-by/field-filter) поля из разных source'ов смешаны в одном списке. `FieldDescriptor.presenceRate` агрегирован по выбранным источникам — юзер не видит, что `req_id` есть только в pino, `request_uri` только в nginx, а фильтр `req_id = abc` молча выкинет все nginx-строки (NULL-семантика SQL).

Цель — закрыть все три гэпа, в указанном порядке. Phase 1 — самый горящий (search вообще не работает), phase 2 — расширяет ценность приложения, phase 3 — снимает «магию» которая раздражает юзера.

## Phase 1 — Free-text search restoration

### Проблема

После ADR-0016 read-path выглядит так:

1. SQL: `SELECT id, source_id, ts, level, file_path, byte_start, byte_end, fields_json FROM entry WHERE <filter>` — даёт «pointer rows».
2. Coordinator: `resolvePointersToEntries(pointers)` ([src/workers/coordinator/read/lazy-resolver.ts](../../src/workers/coordinator/read/lazy-resolver.ts)) тянет `raw`/`message` из OPFS-блобов / file-handle'а только для видимого окна.

Free-text query никто не применяет — ни до lazy resolve, ни после.

### Решение

**Двухуровневый подход**:

**1.1. Substring/regex — worker-side post-filter в `getRange`/`getCount`**

Самый простой и универсальный вариант. Алгоритм в [coordinator.ts](../../src/workers/coordinator/coordinator.ts):

- SQL уже применяет field/level/source/time/path фильтры → возвращает кандидатов.
- Если `filter.query` не пуст и `queryMode ∈ {substring, regex}`:
  - Для каждой страницы pointers: resolve body (lazy resolver), apply JS match (substring `String.includes` либо `RegExp.test`), оставить только matches.
  - Reuse `wholeWord` через `\b...\b` обёртку regex'а.
  - `caseSensitive=false` → `.toLowerCase()` обоих или флаг `i` regex'а.
- Counter (`getCount`) при non-empty query — отдельный код path: walk через все pointers батчами, resolve, считать. Сейчас count просто `SELECT COUNT(*)` — придётся уйти в slow path. Это медленнее, но честно (юзер видит true count).

Альтернатива для count'а — оптимистично показывать «N+» если резюме не докрутили (как Google).

**1.2. FTS — восстановить FTS5 виртуальную таблицу через v5 миграцию**

Substring/regex — slow path. Для больших источников нужен индекс. Возвращаем FTS5:

- Schema v5: `CREATE VIRTUAL TABLE entry_fts USING fts5(message, raw, content='entry', content_rowid='rowid')` + триггеры INSERT/DELETE.
- ВАЖНО: после ADR-0016 message/raw не лежат в SQLite. Два варианта:
  - **a) FTS-only хранение токенов в external content.** Не работает — FTS5 external-content требует, чтобы content table содержала исходный текст. Не наш случай.
  - **b) FTS5 в contentless mode** — индексирует, но текст не хранит. Подходит идеально. INSERT в FTS делаем в `insertBatch` ([indexer-api.ts:337-457](../../src/workers/indexer/indexer-api.ts#L337)) одновременно с insertEntry, передавая `parsed.message` и `parsed.raw` из batch'а (они есть на момент инсерта, до уезда в OPFS).
- Query: `SELECT rowid FROM entry_fts WHERE entry_fts MATCH ?` → JOIN с `entry` по rowid → pointers → lazy-resolve.

**1.3. UI**

- Восстановить семантику FTS toggle в [LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx).
- Не менять props — `filters.queryMode` уже принимает `'substring' | 'fts' | 'regex'`.
- Placeholder'ы в input'е уже корректны.

### Файлы Phase 1

- [src/workers/indexer/db/migrations.ts](../../src/workers/indexer/db/migrations.ts) — добавить v5 (FTS5 contentless table + триггеры).
- [src/workers/indexer/db/schema-v5-fts5.sql](../../src/workers/indexer/db/) — новый файл миграции.
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — `insertBatch` пишет в `entry_fts`; новый метод `searchFts(query, filter)` возвращает rowids.
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — `queryMode === 'fts'` поднимает JOIN с FTS5 (`JOIN entry_fts ON entry_fts.rowid = entry.rowid AND entry_fts MATCH ?`).
- [src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts) — `getRange`/`getCount` для `substring`/`regex` уходят в slow-path post-filter после lazy resolve.

### Verification Phase 1

- Unit тест `query.ts`: FTS path добавляет JOIN с `entry_fts`, substring path — нет.
- Unit тест миграции v5: применяется к свежей БД и поверх v4 (триггеры срабатывают для существующих рядов).
- Browser smoke: открыть pino + nginx, в search ввести `error` → видны строки из обоих с подсветкой. Переключить toggle на FTS → MATCH-grammar (фразы, AND/OR). Regex — `^GET` находит nginx-строки.

## Phase 2 — Parser plugin architecture + built-in expansion

### Проблема

Сейчас pino/bunyan = `jsonLinesParser`, всё остальное = `plainTextParser` (одна-строка-одна-запись, без полей). Базовая цель — добавить nginx/syslog/stacktrace. Но логи бывают **разные и кастомные**: K8s container logs, Apache, Tomcat, JSON-with-newlines, бизнес-форматы фирмы. Захардкодить тройку парсеров и закрыть тему — это лечение симптома. Архитектурная задача — сделать так, чтобы **добавление парсера стоило 50 строк кода + регистрацию** (для built-in) и **формы в UI** (для user-defined).

Цель Phase 2: стабильный plugin-API + 3 reference-реализации поверх него + UI для custom parser'ов.

### 2.A. Стабилизация Parser plugin API

Сегодня в [src/core/types/log-parser.ts](../../src/core/types/log-parser.ts) есть `LogParser { id, canParse, parseLine }`. Это уже плагин-интерфейс, но без вспомогательных утилит каждый парсер дублирует `normalizeLevel`/`normalizeTimestamp`. Выносим:

- **`src/core/parsers/lib/level.ts`** — `normalizeLevel(value: unknown): LogLevel` (текущая логика из `json-lines-parser.ts:28-62`) + `levelFromHttpStatus`/`levelFromSyslogSeverity` helpers.
- **`src/core/parsers/lib/time.ts`** — `parseTimestamp(value: unknown): number | null` (epoch ms / ISO / Apache `[%d/%b/%Y:%H:%M:%S %z]` / syslog `Mon DD HH:MM:SS`).
- **`src/core/parsers/lib/regex-parser.ts`** — фабрика:

  ```ts
  defineRegexParser({
    id: 'nginx-combined',
    pattern: /^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (\S+) HTTP\/\S+" (\d+) (\d+|-) "([^"]*)" "([^"]*)"$/,
    fields: {
      // group → field name + optional transform
      1: 'remote_addr',
      3: { name: '@ts', transform: parseApacheTime },
      4: 'method',
      5: 'request_uri',
      6: { name: 'status', transform: Number, deriveLevel: levelFromHttpStatus },
      7: { name: 'bytes_sent', transform: (s) => (s === '-' ? 0 : Number(s)) },
      9: 'referer',
      10: 'user_agent',
    },
    message: (g) => `${g[4]} ${g[5]} → ${g[6]}`,
  }): LogParser
  ```

  Один правильно отлаженный helper → 90% новых парсеров пишутся декларативно.

- **`src/core/parsers/lib/multiline.ts`** — типобезопасное расширение интерфейса для накопления записи из нескольких строк (stacktrace, multi-line JSON):
  ```ts
  interface MultilineHooks {
    isOpen(line: string): boolean;       // первая строка записи
    isContinuation(line: string, openLine: string): boolean;
    flush(lines: ReadonlyArray<string>, ctx: ParseCtx): ParseResult;
  }
  defineMultilineParser({ id, hooks }): LogParser
  ```
  Аккумулятор живёт в ingest-orchestrator'е (один buffer per source), парсеры остаются stateless.

### 2.B. Параметры выбора парсера (per-source override)

Сегодня `registry.pick(firstSample)` выбирает по первому `canParse=true`. Это работает в 90% случаев, но ломается на смешанных файлах и custom-форматах. Расширяем:

- При `addSource` юзер видит dropdown «Parser: auto / json-lines / nginx-combined / syslog-3164 / custom: my-format». «auto» — текущее поведение. Выбор хранится в `LogSource.parserId?: string`.
- В `ingest-orchestrator` если `source.parserId` задан — `registry.byId(parserId)` побеждает; иначе — `registry.pick(sample)`.
- Persisted: `parserId` укладывается в `LogSource` meta при первом ingest и сохраняется в `field_meta`/handle store вместе с другими атрибутами.

UI:

- В [LvAddSourceModal](../../src/ui/components/sidebar/LvAddSourceModal.tsx) — новое поле `<select>` с parsers, default `auto`. Список парсеров приходит через RPC `coordinator.listParsers()` (см. ниже).
- В строке source-а в сайдбаре — маленький бейдж с id парсера (на hover показывать confidence), клик → submenu «Re-parse with…» с тем же list'ом.

### 2.C. User-defined custom parsers

Юзер может определить свой парсер прямо в приложении одним из **четырёх способов** (от простого к сложному, все live одновременно).

#### Тип 1 — `regex` (MVP, основной)

Простейший: задаёшь JS-regex + group→field mapping. Тип `CustomParserDef`:

```ts
{
  kind: 'regex';
  pattern: string;               // регулярка как строка
  flags: string;                 // 'i', 'm', …
  fields: ReadonlyArray<{
    group: number;
    name: string;
    transform?: 'number' | 'apache-time' | 'iso-time' | 'epoch-ms' | 'as-is';
  }>;
  timestampGroup?: number;
  levelStrategy?: 'http-status' | 'syslog-severity' | 'group-name' | 'fixed';
  levelGroup?: number;
  levelFixed?: LogLevel;
  messageTemplate?: string;
}
```

#### Тип 2 — `grok` (читабельный синтаксис)

Logstash-стиль `%{PATTERN:name}` с готовой библиотекой токенов (IP, NUMBER, WORD, URI, DATA, GREEDYDATA, TIMESTAMP_ISO8601, HTTPDATE, HOSTNAME, …). Пример:

```
%{IPORHOST:client} - %{USER:user} \[%{HTTPDATE:ts}\] "%{WORD:method} %{URIPATHPARAM:uri} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int}
```

Компилируется в plain regex внутри `defineGrokParser`. Библиотека паттернов — небольшой `src/core/parsers/lib/grok-patterns.ts` (~60 встроенных, копируется из logstash-patterns-core минимально). Юзер может добавлять свои `%{MYPATTERN}` через тот же form.

Тип `CustomParserDef`:

```ts
{
  kind: 'grok';
  pattern: string;               // например: "%{IP:client} %{NUMBER:status:int}"
  customTokens?: Record<string, string>; // user-добавленные %{NAME}
  // + те же поля levelStrategy/etc что у regex
}
```

#### Тип 3 — `js-function` (advanced, power-user)

Юзер пишет полноценное тело `parseLine` в редакторе:

```ts
{
  kind: 'js-function';
  source: string; // function (line, ctx) { ... return { timestamp, level, message, fields } }
}
```

Компиляция через `new Function('line', 'ctx', source)` **в worker'е coordinator'а** (не main). Никакого sandbox'а — юзер по сути может вызвать что угодно в worker scope (нет `window`/`document` уже на этом уровне, fetch есть). Это personal-tool, не SaaS — risk acceptable. UI явно предупреждает: «Code runs with full worker permissions». Включается только если юзер опт-инит чек-бокс «Enable JS parsers» в Settings.

#### Тип 4 — Pre-bundled library (curated)

В репозитории: [docs/parsers/](../../docs/parsers/) — каталог из ~10 готовых definitions (Apache combined, Apache common, K8s/Docker JSON, journald-export, AWS ALB, AWS CloudFront, MongoDB, PostgreSQL, MySQL slow log). Каждый — JSON в формате `CustomParserDef`. Bundle загружается в приложение как асет (`import.meta.glob('/docs/parsers/*.json')`), показывается в Parsers panel как секция «Templates». Клик «Import» → копия попадает в user IDB как обычный custom parser.

#### Storage & hydration

- **IDB store**: `custom-parsers`, рядом с `log-viewer-handles`. Per-workspace, не per-source.
- Запись: `{ id, label, kind, ... fields-of-kind ..., version, createdAt, updatedAt }`.
- **Hydration**: при boot coordinator'а — main thread читает IDB и передаёт definitions через RPC `coordinator.loadCustomParsers(defs)`. Coordinator компилирует каждый через соответствующий `defineXxx`, регистрирует в `ParserRegistry` с приоритетом 50 (выше plain-text, ниже built-in).
- **Compile failure** в js-function/grok/regex — парсер регистрируется в «sick» состоянии (canParse → false), в UI показывается ошибка. Не падает приложение.

#### CRUD UI

Новая rail-panel **«Parsers»** в sidebar (рядом с Search/Bookmarks). Тело:

- Секция **«Yours»** — пользовательские definitions, карточки с id/label/kind + edit/delete.
- Секция **«Templates»** — pre-bundled, кнопка «Import» на каждой.
- Кнопка **`+ New parser`** — модальное окно с tab'ами Regex / Grok / JS-function. В каждом tab'е:
  - id, label
  - тело (regex/grok/js, с syntax-highlight)
  - таблица «Group/Token → field name + transform» (для regex/grok; auto-fill из named groups в grok)
  - **Test area** — paste 3-5 строк, в реал-тайме видишь parsed fields. Ошибки compile подсвечиваются.
  - Save → IDB → coordinator pickup без reload.
- **Версионирование**: definition несёт `version: number`, увеличивается на Save.

#### Re-parse при обновлении definition или смене parser'а у source

**Автоматически** (выбор юзера). Алгоритм в `coordinator.upsertCustomParser` / `coordinator.setSourceParser`:

1. Найти все `sources` с `parserId === changedId` (либо явно указанный source).
2. Для каждого: `clearSourceEntries(sourceId)` (новый indexer method — DELETE rows из `entry`/`field_meta`/`entry_fts` для source, но **сохраняем** handle/spool).
3. Re-trigger ingest: `startIngest(source)` — adapter перечитает с начала, парсит новым парсером.
4. На стороне UI — счётчик и статус-progress (`indexing N`) показывают прогресс.

Edge cases:

- Если source в режиме `streaming` (live tail) — clearSourceEntries только для исторических entries, новые продолжают идти через новый parser.
- Если source это `file` и handle потерян (после reload) — re-parse невозможен, помечаем как `permission-required` и показываем «Grant access to re-parse».
- Параллельная re-parse нескольких sources — sequential или parallel? Sequential проще, ниже peak memory.

### 2.D. Reference built-in парсеры

Три парсера, написанные через `defineRegexParser` / `defineMultilineParser`, служат как пример для custom-парсеров и как сами решают bug-out-of-the-box:

| id               | Тип          | Priority | Поля (highlights)                                                                       |
| ---------------- | ------------ | -------- | --------------------------------------------------------------------------------------- |
| `nginx-combined` | regex        | 80       | `remote_addr`, `method`, `request_uri`, `status`, `bytes_sent`, `referer`, `user_agent` |
| `syslog-3164`    | regex        | 70       | `priority`, `hostname`, `program`, `pid`, level из severity                             |
| `stacktrace-jvm` | multiline    | 60       | `exception_type`, `exception_message`, `stack[]`                                        |
| `json-lines`     | существующий | 100      | без изменений                                                                           |
| `plain-text`     | существующий | 0        | без изменений                                                                           |

«Stacktrace» — отдельный случай: записывается через `defineMultilineParser`, ingest-orchestrator поддерживает буфер. Континуация: строки начинающиеся с `\s+at ` (JVM), `\s+File "` (Python), `Caused by:`, `\t...`. Закрытие буфера — на первой не-continuation строке или EOF.

### 2.E. Parser-aware UI improvements

- **Format-specific column-presets**: `LogParser` экспортирует `defaultColumns?: ReadonlyArray<string>`. Когда source впервые получает первый batch с непустым parser-confidence — coordinator emit'ит подсказку, UI разово сохраняет в `tweaks.columns` (если у юзера ещё нет custom выбора). Это решает «открыл nginx → видит status/uri вместо дефолтных».
- **Бейдж парсера на source-row** (см. 2.B).
- **Confidence в Meta-вкладке** разворота строки: `@parser.id`, `@parser.confidence` — добавляются в [LvRowDetail](../../src/ui/components/stream/LvRowDetail.tsx) Meta-секцию.

### Файлы Phase 2

Базовые:

- [src/core/types/log-parser.ts](../../src/core/types/log-parser.ts) — добавить optional `defaultColumns`, `version`.
- [src/core/parsers/lib/level.ts](../../src/core/parsers/lib/) — новый.
- [src/core/parsers/lib/time.ts](../../src/core/parsers/lib/) — новый.
- [src/core/parsers/lib/regex-parser.ts](../../src/core/parsers/lib/) — новый, фабрика.
- [src/core/parsers/lib/multiline.ts](../../src/core/parsers/lib/) — новый.
- [src/core/parsers/json-lines-parser.ts](../../src/core/parsers/json-lines-parser.ts) — рефакторинг на shared helpers (level/time из lib).

Built-in парсеры:

- [src/core/parsers/nginx-combined-parser.ts](../../src/core/parsers/nginx-combined-parser.ts) — уже есть набросок, переделать через `defineRegexParser`.
- [src/core/parsers/syslog-parser.ts](../../src/core/parsers/) — новый.
- [src/core/parsers/stacktrace-jvm-parser.ts](../../src/core/parsers/) — новый, через `defineMultilineParser`.
- [src/core/parsers/index.ts](../../src/core/parsers/index.ts) — регистрация.

Ingest pipeline:

- [src/workers/coordinator/ingest/ingest-orchestrator.ts](../../src/workers/coordinator/ingest/ingest-orchestrator.ts) — multiline buffer; `LogSource.parserId` override.
- [src/core/types/log-source.ts](../../src/core/types/log-source.ts) — `parserId?: string` в каждом kind'е.

Custom parsers:

- [src/core/parsers/custom-parser-def.ts](../../src/core/parsers/) — type + compile.
- [src/workers/coordinator/custom-parsers/store.ts](../../src/workers/coordinator/custom-parsers/) — IDB layer.
- [src/core/rpc/coordinator.contract.ts](../../src/core/rpc/coordinator.contract.ts) — `listParsers`, `upsertCustomParser`, `removeCustomParser`, `reparseSource` RPCs.
- [src/ui/components/panels/LvParsersPanel.tsx](../../src/ui/components/panels/) — новый rail panel.
- [src/ui/components/sidebar/LvAddSourceModal.tsx](../../src/ui/components/sidebar/LvAddSourceModal.tsx) — parser-select dropdown.
- [src/ui/components/sidebar/LvSourceRow.tsx](../../src/ui/components/sidebar/) или внутри `LvTreeNode` — parser badge.

### Verification Phase 2

- Unit-тесты для `regex-parser`/`multiline`: golden fixtures `.tmp/demo_logs/` прогоняются через факторов, expected `ParsedRecord` совпадает.
- Unit-тест для `CustomParserDef` compile: невалидный regex → ошибка с подсказкой; валидный → парсит test-string.
- Persist test: создал custom parser → reload → parser виден в `listParsers` + работает на свежем source.
- Browser smoke:
  - Открыть `nginx-access.log` → колонки `status`, `request_uri` появляются по умолчанию; field-filter `status >= 400` работает.
  - Открыть `stack-traces.log` → одна entry на трейс, в Meta-вкладке `@parser.id = stacktrace-jvm`.
  - Создать custom parser «My App» с regex для своего формата → применить к source → field-filter работает.

### Phase 2 deliverable boundaries

Делается **инкрементально**:

1. ✅ **2.A** (lib helpers + `defineRegexParser` + `defineMultilineParser` stub) — DONE (uncommitted): [src/core/parsers/lib/](../../src/core/parsers/lib/) + рефактор `json-lines-parser` на shared helpers + 23 новых unit-теста.
2. 🟡 **2.D** (built-in nginx + syslog + stacktrace через factories) — IN PROGRESS: `nginx-combined-parser.ts` переписан на factory, осталось syslog, stacktrace, orchestrator multiline buffer, регистрация в registry, тесты.
3. **2.B** (per-source parser override + Add Source dropdown) — pending.
4. **2.E** (defaultColumns + badges + `@parser.*` в Meta) — pending.
5. **2.C-regex** (custom parsers, только `kind: 'regex'`, базовая UI panel) — pending.
6. **2.C-grok** (grok-патерны + token library + import grok templates) — pending.
7. **2.C-template-library** (pre-bundled `docs/parsers/*.json` + Import button) — pending.
8. **2.C-jsfunction** (JS-function kind + Settings opt-in + warning) — pending.

Между 5–7 порядок гибкий — все три не зависят друг от друга, только от 5 (общая UI panel и storage).

Re-parse on change (2.C финальная часть) добавляется одновременно с 2.B: `clearSourceEntries` + `startIngest`. Без этого смена parser'а у источника не имеет немедленного эффекта.

Можно остановиться после любого из шагов и иметь работающую систему.

### Open question for 2.D: parser-pool dispatch & multiline buffer location

Текущий ingest-pipeline ([ingest-orchestrator.ts:88-95](../../src/workers/coordinator/ingest/ingest-orchestrator.ts#L88-L95)) дёргает parser-pool так: `parserPool.withWorker((p) => p.parse(lines, ctx))` — batch строк уезжает в произвольный pool-worker, который сам выбирает parser по `ctx.parserId`. Multi-line аккумуляция плохо ложится на эту модель: buffer должен жить **между batch'ами одного source'а**, а worker'ы stateless и могут чередоваться.

Три варианта integration:

- **A. State в orchestrator'е**: orchestrator знает `continuationRegex` парсера, ведёт buffer (`openLine`, `openByteStart`, `accumulatedLines[]`) ДО посылки в parser-pool. На pool отправляет уже объединённый блок: `{ line: lines.join('\n'), byteStart: first, byteEnd: last }`. Parser-pool остаётся stateless. **Минус**: lazy-resolver должен уметь re-parse joined block (просто проверим что parser'ы делают `line.split('\n')` для multiline-case — фабрика `defineMultilineParser` уже так делает).
- **B. Sticky source→worker assignment**: каждый source pin'нится на конкретный pool-worker через consistent-hash (`source.id % poolSize`). Worker держит per-source buffer. **Минус**: ломается load-balancing, медленные source'ы блокируют свой worker.
- **C. Buffer в самом parser-pool через broker**: единый «multiline state manager» внутри pool, индексируется по `(sourceId, parserId)`. **Минус**: усложняет pool API.

Phase 2 plan называет **A**. Это значит:

1. Orchestrator после detect получает `parserId` → запрашивает `continuationRegex` через RPC `p.getParserMeta(parserId)` (cheap, кэшируется) → компилирует RegExp.
2. Перед `p.parse(lines, ctx)` orchestrator перепаковывает `lines`: проходит по физическим строкам, накапливает в buffer пока `continuationRegex.test(line)` true, на не-match flush'ит buffer как одну «logical line» с объединённым raw и широким byteStart..byteEnd.
3. Parser-pool получает уже-объединённые lines, parses как обычно. Multi-line `defineMultilineParser` парсер декодирует joined block (split по \n + parseBlock).

Это требует:

- Новый RPC метод parser-pool: `getParserMeta(parserId): Promise<{ continuationRegex: string | null }>`. Cheap: parser-pool worker уже имеет полный registry, lookup O(1).
- Изменения в [ingest-orchestrator.ts](../../src/workers/coordinator/ingest/ingest-orchestrator.ts): новая accumulation loop ДО parser-pool RPC.
- Lazy-resolver ([lazy-resolver.ts](../../src/workers/coordinator/read/lazy-resolver.ts)) после ADR-0016 читает bytes `[byteStart, byteEnd)` и заново парсит. Когда byteEnd покрывает несколько строк, прочитанный slice будет с `\n` внутри. Multi-line parser обрабатывает корректно (раз parseBlock умеет split); single-line parser получит multi-line input и потеряется. Это OK потому что лишь multi-line parser генерирует entries с byteEnd > end-of-physical-line.

Phase 2.D как один коммит:

- `syslog-3164-parser.ts` через `defineRegexParser` (single-line, простой).
- `stacktrace-jvm-parser.ts` через `defineMultilineParser`.
- `parser-pool` extension с `getParserMeta`.
- `ingest-orchestrator` extension с multiline buffer.
- Регистрация в `createDefaultRegistry()` с приоритетами 80/70/60.
- Тесты для парсеров + интеграционный тест на orchestrator buffer (нужно ли — large change).

## Phase 3 — Cross-format UI

### Проблема

В picker'ах поле `req_id` (только pino) и `request_uri` (только nginx) выглядят одинаково. Юзер кликает фильтр `req_id = x` и не понимает, почему пропали все nginx-строки.

### Решение

**3.1. Расширить `FieldDescriptor`**

В [src/core/filter/field-descriptor.ts](../../src/core/filter/field-descriptor.ts):

```ts
export interface FieldDescriptor {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly origin: 'builtin' | 'dynamic';
  readonly occurrences?: number;
  readonly presenceRate?: number;
  readonly topValues?: ReadonlyArray<{ value: string; count: number }>;
  /** NEW: per-source presence breakdown — drives the "pino only" badge. */
  readonly perSource?: ReadonlyArray<{
    sourceId: string;
    occurrences: number;
    presenceRate: number;
  }>;
}
```

`aggregateFieldDescriptors` в [field-meta.ts:118-191](../../src/workers/indexer/field-meta.ts#L118) уже агрегирует по ключу — нужно дополнительно собрать `perSource` массив до агрегации.

**3.2. Compatibility-бейджи в picker'ах**

Новый helper `src/ui/utils/field-compatibility.ts`:

```ts
type Compat = 'shared' | 'partial' | 'unique';
function compatOf(
  desc: FieldDescriptor,
  activeSources: ReadonlyArray<string>,
): { kind: Compat; presentIn: number; total: number };
```

- `shared` — поле есть во всех active sources (или это builtin).
- `partial` — есть в part'ах.
- `unique` — только в одном source'е.

Рендерить рядом с ключом:

- `partial` → бейдж «3/5» с tooltip списком sources.
- `unique` → бейдж имени source'а («pino.jsonl»).
- `shared` → ничего.

Обновляем три picker'а: [LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) (уже мёртв после `LvTableSettings`, но логика переехала в [LvTableSettings.tsx](../../src/ui/components/filter/LvTableSettings.tsx)), [LvAddFieldFilter.tsx](../../src/ui/components/filter/LvAddFieldFilter.tsx), [LvGroupBySelect.tsx](../../src/ui/components/filter/LvGroupBySelect.tsx).

**3.3. Inline warning у активных field-filter chips**

В [LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx) для каждого chip из `filters.fieldFilters` вычислять compat и, если `partial`/`unique`, показывать `⚠` иконку с tooltip-ом «excludes 3 of 5 sources». Helper тот же.

### Файлы Phase 3

- [src/core/filter/field-descriptor.ts](../../src/core/filter/field-descriptor.ts) — `perSource` поле.
- [src/workers/indexer/field-meta.ts](../../src/workers/indexer/field-meta.ts) — собирать `perSource` в `aggregateFieldDescriptors`.
- [src/ui/utils/field-compatibility.ts](../../src/ui/utils/) — новый helper.
- [src/ui/components/filter/LvAddFieldFilter.tsx](../../src/ui/components/filter/LvAddFieldFilter.tsx), [LvGroupBySelect.tsx](../../src/ui/components/filter/LvGroupBySelect.tsx), [LvTableSettings.tsx](../../src/ui/components/filter/LvTableSettings.tsx) — рендер бейджей.
- [src/ui/components/filter/LvFilterBar.tsx](../../src/ui/components/filter/LvFilterBar.tsx) — warning у chip'ов.
- [src/ui/styles/lv.css](../../src/ui/styles/lv.css) — `.lv-fld-compat`, `.lv-fld-compat-warn`.

### Verification Phase 3

- Unit тест `aggregateFieldDescriptors`: вход — `req_id` в pino (occ=500) + `request_uri` в nginx (occ=400), выход — `perSource[]` с двумя записями каждый.
- Unit тест `compatOf`: для `req_id` и activeSources=[pino, nginx] → `unique`, presentIn=1.
- Browser smoke: открыть оба source'а, в column-picker'е у `req_id` бейдж «pino», у `@level` нет. Добавить field-filter `req_id = x` → у chip'а ⚠ + tooltip.

## Reuse from existing

- `aggregateFieldDescriptors`, `BUILT_IN_FIELD_DESCRIPTORS` — переиспользуются как есть, расширяются.
- `fieldKeyToSql` — не меняется.
- Migration helpers (`migrations.ts`) — добавляем шестой migration step.
- Парсеры в [src/core/parsers/json-lines-parser.ts](../../src/core/parsers/json-lines-parser.ts) — образец интерфейса `LineParser` и normalization helpers (`stripWellKnown`, level mapping).
- Fixtures в `.tmp/demo_logs/` — готовые входы для тестов парсеров.

## Out of scope

- Custom regex parser (юзер задаёт паттерн в UI). Это отдельная фича после phase 2.
- Per-source overrides фильтра (разные query на разных source'ах в одной табе). Усложнит UI без явного спроса.
- К8s/journald/Apache combined log parsers. Те же кубики, отдельные задачи.
- Backfill FTS для уже проиндексированных entries. Допустимо: после миграции v5 новые entries попадают в FTS, для старых — re-index вручную через `clearAll`. Если важно — добавить отдельный шаг миграции с populate.

## Verification — overall

Каждая фаза — отдельный коммит и отдельный round тестирования. После всех трёх:

1. `npx tsc -b && pnpm lint && pnpm test --run` — зелёные.
2. Browser smoke с тремя источниками: `pino.jsonl`, `nginx-access.log`, `stack-traces.log`.
3. Free-text «timeout» в substring и FTS режимах — находит строки в обоих JSON и nginx.
4. Field-filter `status >= 400` — фильтрует только nginx (pino без `status`); у chip'а ⚠ с tooltip «excludes 2 of 3 sources».
5. Group-by `@source.kind` — три bucket'а (file, file, file… или соответствующие kinds).
6. 0 console errors.
