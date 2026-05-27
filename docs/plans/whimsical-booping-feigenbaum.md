# Колонки для разнородных форматов логов — discovery-документ

> Это **design exploration**, не implementation plan. Цель — зафиксировать варианты верхнеуровневой архитектуры UI работы с колонками для разных форматов логов и выбрать направление до того, как начнём резать код.

## Context

В таблице логов сейчас фиксированный набор колонок (LN, TS, LEVEL, SERVICE, FILE, MESSAGE) плюс динамические, выбираемые через [LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) из field schema. Этот набор был спроектирован под "усреднённый" структурированный лог и недостаточен для двух крайних случаев:

- **Богато структурированные форматы** (pino/bunyan JSON Lines, nginx combined, syslog) — у них есть native-поля, которые хочется видеть в таблице как колонки: `traceId`, `userId`, `remote_addr`, `status`, `request_method`. Сейчас они доступны только через ручной picker по presenceRate.
- **Неструктурированные форматы** (`plain-text-parser`, `app.log` без чёткой схемы) — у них нет полей, картировать в колонки нечего. MESSAGE + RAW достаточно, остальные колонки пустые и съедают место.

Сценарий, который мы оптимизируем (по уточнению):

1. **All-Logs tab** — основная вкладка, в которой пользователь смотрит все выбранные источники одновременно. Здесь форматы заведомо смешаны (pino + nginx + plain-text).
2. **Per-file tab** — drill-down вкладка по одному источнику/файлу, открывается по клику. Формат гомогенен → можно показать format-aware колонки.

Желаемое поведение для каждого формата:
- Structured (JSON и regex-based) — viewer сам может предложить набор колонок из полей.
- Unstructured — дефолт = `LN + текст лога`, плюс конструктор колонок (regex/template), чтобы пользователь сам мог извлекать поля.

## Популярные форматы логов (что встречается в дикой природе)

| Класс | Примеры | Как с ним работать |
|------|---------|--------------------|
| **JSON Lines** | pino, bunyan, generic `{...}\n` | `fields` доступны как key-value; колонки = key из payload'а. У нас закрыто [json-lines-parser.ts](../../src/core/parsers/json-lines-parser.ts) |
| **logfmt** | `level=info msg="..." key=value` | Парс как key-value, колонки = key. У нас **нет** парсера; можно добавить позже. |
| **Regex-extracted (semi-structured)** | nginx combined, Apache, syslog 3164/5424, app-text `[ISO] LEVEL [svc] msg k=v` | Named groups → fields. У нас [nginx-combined-parser.ts](../../src/core/parsers/nginx-combined-parser.ts), [syslog-parser.ts](../../src/core/parsers/syslog-parser.ts), [app-text-parser.ts](../../src/core/parsers/app-text-parser.ts) |
| **CSV/TSV-style** | docker container logs (`ts svc msg`), какие-то custom | Делиметер фиксированный, поля — позиционные. Решается user-defined parser (Phase 2.C). |
| **Unstructured** | произвольный `console.log`, `stderr`, output CLI-утилит | Нет полей. У нас [plain-text-parser.ts](../../src/core/parsers/plain-text-parser.ts) — catch-all. |
| **Multiline** | Java/Python stack traces, многострочные ошибки | Склейка на ingest через `continuationRegex` (см. [log-parser.ts:32](../../src/core/types/log-parser.ts)). После склейки — обычная запись с `fields.exception_type` и др. |

## Чужие подходы (краткая выжимка)

Полный обзор инструментов — в [whimsical-booping-feigenbaum-agent-a6a9c93d9d51cbcf3.md](./whimsical-booping-feigenbaum-agent-a6a9c93d9d51cbcf3.md). Пять универсальных паттернов из обзора:

1. **Raw всегда виден** — даже когда инструмент рендерит extracted fields, оригинальную строку можно увидеть одним кликом (Splunk `_raw`, Kibana JSON-tab, lnav default view).
2. **Two-zone layout** — компактная list-view (1–2 главные колонки) + detail-panel/expand-row с полным набором атрибутов и переключателем Table ↔ JSON.
3. **Колонки добавляются из field-sidebar** — discover полей с counts → клик/drag → колонка (Splunk selected/interesting, Kibana available, Datadog facets). У нас это **уже есть** в виде [LvColumnPicker](../../src/ui/components/filter/LvColumnPicker.tsx) с presenceRate.
4. **Heterogeneous payload → flat key-value bag** — JSON, logfmt, regexp-extracted поля попадают в один namespace атрибутов; UI не различает их по происхождению.
5. **Multiline — это ingest problem, не UI problem** — все инструменты склеивают multiline до показа. У нас тот же подход.

Конкретно интересные для нас:
- **lnav** — schema-driven, каждый format = JSON-описание с regex + value-полями. Близко к идее `parser.defaultColumns`.
- **Datadog** — одна Message колонка + side-panel с Content/JSON tab'ами. Близко к идее universal compact view для All-Logs.
- **Splunk** — Selected/Interesting fields в сайдбаре, и команда `| table foo bar` для жёсткой таблицы. Гибрид auto + manual.

## Что у нас уже есть (точка отсчёта)

- **Контракт парсера** в [log-parser.ts:21](../../src/core/types/log-parser.ts#L21) с опциональным полем `defaultColumns?: ReadonlyArray<string>` — **есть поле, но не используется в UI**.
- **Нормализованная запись** [LogEntry](../../src/core/types/log-entry.ts) с гарантированными `timestamp/level/message/raw` и расширяемым `fields`. Все форматы вписываются.
- **Field schema** — discovery полей с `presenceRate` и `occurrences` из `field_meta` в IndexedDB (см. [field-descriptor.ts](../../src/core/filter/field-descriptor.ts)).
- **Column picker** — [LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) сортирует поля по presenceRate, чекбоксы превращают их в колонки. Persist через [use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts) (`tweaks.columns`).
- **Row detail** — [LvRowDetail.tsx](../../src/ui/components/stream/LvRowDetail.tsx) с табами Fields / Pretty / Stack / Raw / Meta. Двухзонный layout (list + detail) уже реализован.

То есть: дефицит не в инструментах, а в **их связке** — viewer не знает о parserId записи, не использует `parser.defaultColumns`, и нет конструктора колонок для unstructured.

## Верхнеуровневые варианты

### Вариант A — Format profile per tab + `parser.defaultColumns`

**Суть:** каждая вкладка получает свой column profile, привязанный к dominant parser потока.

- **Per-file tab.** При открытии viewer смотрит `parser.id` единственного источника. Если у парсера есть `defaultColumns` — рендерим их (для pino: `level, msg, traceId, userId`; для nginx: `status, remote_addr, request`). Pользователь может править через тот же [LvColumnPicker](../../src/ui/components/filter/LvColumnPicker.tsx) — его правки переопределяют дефолт и сохраняются per-tab.
- **All-Logs tab.** Profile = "mixed": LN + TS + LEVEL + FILE + MESSAGE. Доп. колонки — только через ручной picker; они применяются ко всем строкам, пустые ячейки для тех, где поля нет (текущее поведение).
- **Unstructured формат.** `plain-text-parser.defaultColumns = []` → таблица показывает только LN + MESSAGE. Конструктор колонок — отдельная фича (см. ниже).

**Pro:** малое смещение от текущего состояния; `defaultColumns` уже задекларирован в контракте; UX предсказуем — формат → колонки.
**Con:** требует расширения [LvTweaks.columns](../../src/hooks/use-ui-prefs.ts#L41) до per-tab (сейчас глобальные). Per-tab persistence — отдельная подзадача.

### Вариант B — Adaptive smart picker для All-Logs + per-file как в варианте A

**Суть:** Per-file tab работает как в A. Для All-Logs tab viewer **сам** дополняет фиксированные колонки топ-N полей с presenceRate ≥ X% (например, 30%).

- Если в выборке доминирует один формат — поля этого формата автоматически появляются как колонки.
- Если форматы смешаны — auto-добавляются только "сквозные" поля (например, `traceId` встречается и в pino, и в nginx после нормализации).
- Пользователь может pin'нуть/unpin'нуть автоматическую колонку → она становится "ручной" и не пересчитывается.

**Pro:** All-Logs tab перестаёт быть "лысым"; экономит клики; уже есть presenceRate в field schema.
**Con:** "автомагия" может раздражать; column set прыгает при изменении выборки источников. Нужен явный feedback "эти колонки добавлены автоматически" и кнопка "Lock columns".

### Вариант C — Datadog-style universal compact + drill-down

**Суть:** All-Logs tab радикально упрощается до одной "Message" колонки. Per-file tab разворачивается в полноценную format-aware таблицу.

- **All-Logs tab.** Колонки: LN, TS, SOURCE (chip), MESSAGE. Внутри MESSAGE inline-рендерится level-bage + ключевые поля как chips (`traceId=abc · userId=42`). Side-panel при клике даёт полный набор полей (это уже есть в [LvRowDetail](../../src/ui/components/stream/LvRowDetail.tsx)).
- **Per-file tab.** Полноценная таблица с `parser.defaultColumns` (как в варианте A).
- Конструктор колонок — только в Per-file tab; в All-Logs его нет.

**Pro:** разница между tab'ами наглядна и имеет смысл; All-Logs становится "обзорным" видом, per-file — "рабочим". Меньше развилок в UI.
**Con:** ломает текущую таблицу для тех, кто привык работать в All-Logs с колонками. Inline-chips усложняют рендер строки и virtual scrolling.

### Вариант D — Column construction kit (универсальный конструктор)

**Суть:** независимо от формата, всё опционально. Дефолт — минимум (LN + MESSAGE для unstructured; LN + TS + LEVEL + MESSAGE для всего остального). Колонки строятся пользователем явно.

- Для **JSON-форматов**: discover через field schema (как сейчас), плюс новый action в [LvRowDetail Fields tab](../../src/ui/components/stream/LvRowDetail.tsx) — "Pin as column" на любом поле.
- Для **unstructured/plain-text**: **column builder** — модалка, в которой пользователь задаёт regex с named groups (`(?<status>\d{3})`) или подобный template. Каждый group → виртуальная колонка. Это buys нам поведение, эквивалентное Klogg highlighters, но в табличном виде.
- "Presets" — сохранённые наборы колонок (включая виртуальные с regex'ом), которыми можно поделиться между tab'ами.

**Pro:** покрывает все форматы единым механизмом; адресует unstructured без отдельной ветки в логике; presets ложатся в roadmap (export/import конфигурации).
**Con:** самый дорогой по реализации (column builder UI, парсинг и применение виртуальных regex-колонок, persist'енс presets). Скорее всего поэтапно.

### Сравнение по сценариям

| Сценарий | A | B | C | D |
|----------|---|---|---|---|
| Открыл pino-файл — сразу видит `traceId/userId` | ✅ defaultColumns | ✅ defaultColumns | ✅ в per-file | ⚠️ pin'нуть руками первый раз |
| Открыл nginx-файл — сразу видит `status/url` | ✅ | ✅ | ✅ | ⚠️ |
| Открыл plain-text — не пустая таблица | ⚪ только LN+msg | ⚪ только LN+msg | ⚪ только LN+msg | ✅ regex builder |
| All-Logs tab — смешанные источники | ⚪ minimal | ✅ smart fields | ✅ compact + chips | ⚪ minimal |
| Никаких сюрпризов в column set | ✅ | ❌ "прыгает" | ✅ | ✅ |
| Объём работы | S | M | L (rewrite строки) | XL (builder UI) |

## Рекомендация для обсуждения

**Базовый каркас — Вариант A**, на нём строим всё остальное:
- использует `parser.defaultColumns`, которое уже задекларировано но не использовано;
- даёт format-aware Per-file tab малой кровью;
- per-tab persist'енс колонок — отдельный, понятный кусок работы.

**Поверх A добавляем элементы D** для покрытия unstructured: column builder с regex'ом и виртуальные колонки. Это закрывает обещание "конструктор для тех форматов, где колонок нет".

**Вариант B (adaptive)** — соблазнительный, но рискует начать раздражать на смешанных выборках. Откладываем как Phase 2 поверх A — добавим опцию "Auto-fill columns from frequent fields" в [LvTableSettings](../../src/ui/components/filter/LvTableSettings.tsx) с явным toggle.

**Вариант C (Datadog-style)** — отказываемся как от main path, потому что он переписывает текущую таблицу. Но идея inline-chips в MESSAGE для All-Logs — годная, может пригодиться в Phase 3 как опциональная "Density: chips" в [LvTableSettings density](../../src/hooks/use-ui-prefs.ts#L27).

## Открытые вопросы

1. **Per-tab vs global columns.** Сейчас `tweaks.columns` глобальные через [use-ui-prefs](../../src/hooks/use-ui-prefs.ts). Per-tab column profile = расширить workspace store или продолжать жить в ui-prefs с ключом по tabId?
2. **Что считать "форматом" в All-Logs tab.** Когда смешаны pino + nginx, у нас два разных parser.id на разных строках. "Profile All-Logs" нужно строить как union или как minimal-intersection?
3. **Конструктор колонок (для unstructured).** Regex с named groups или что-то более user-friendly (template-string, JMESPath)? Regex минимально-сложен в реализации, но требует grep-уровня знаний у пользователя.
4. **Migration существующих `tweaks.columns`.** Сейчас одни колонки на всё. При переезде на per-tab — глобальные колонки становятся дефолтом для всех новых tab'ов или сохраняются как preset?

## Критические файлы (для следующей итерации, не сейчас)

Когда определимся с направлением, ключевые точки касания:
- [src/core/types/log-parser.ts](../../src/core/types/log-parser.ts) — поле `defaultColumns` уже есть, но требует прокидывания в UI.
- [src/hooks/use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts) — расширение модели `LvTweaks.columns` (per-tab profile или presets).
- [src/ui/components/stream/LvViewer.tsx](../../src/ui/components/stream/LvViewer.tsx) — рендер столбцов; источник `columns` нужно менять с глобального на tab-aware.
- [src/ui/components/filter/LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) — добавить секцию "Defaults for this format" (parser.defaultColumns).
- [src/ui/components/filter/LvTableSettings.tsx](../../src/ui/components/filter/LvTableSettings.tsx) — точка входа для column builder и presets.
- [src/core/filter/field-descriptor.ts](../../src/core/filter/field-descriptor.ts) — может потребоваться "virtual field" (extracted by user regex).

## Следующий шаг

Согласовать **направление** (A+D / A+B / другое) и **скоуп первой итерации** (per-file format-aware колонки vs конструктор для unstructured — что первое). После этого пишу узкий implementation plan только на выбранный путь.
