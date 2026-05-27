# Research: UI-паттерны разнородных форматов в одной ленте логов

> **Caveat по источникам**: в этой сессии WebSearch/WebFetch оказались недоступны (deferred tools не загрузились через доступный механизм Skill, а Plan mode запрещает запуск non-readonly mechanizmов поиска). Ссылки ниже — это канонические doc-URL'ы инструментов, которые я знаю по тренировочным данным; их стоит верифицировать ручной проверкой перед финальной фиксацией решения. Описания UI-паттернов опираются на актуальные на момент cutoff'а (январь 2026) версии интерфейсов.

## 1. Grafana Loki — LogQL UI (Explore)

Источник: <https://grafana.com/docs/grafana/latest/explore/logs-integration/> и <https://grafana.com/docs/loki/latest/query/log_queries/#parser-expressions>

- "Колонки" в строгом смысле отсутствуют: дефолтный вид — таблица из двух колонок, **Time** и **Line** (raw-строка как есть). Над ней — отдельная панель **Labels** (индексированные ключ-значения из стрима).
- JSON-сообщения остаются raw до момента, пока пользователь не добавит в LogQL парсер (`| json`, `| logfmt`). После парсера в Explore появляется панель **Detected fields** — список ключей с counts; клик по полю добавляет ad-hoc фильтр, но не отдельную колонку в таблице.
- Развёрнутая строка показывает **Fields** (extracted) и **Links** двумя секциями; raw-line всегда виден сверху. Stack traces и multiline склеиваются на этапе ingestion (promtail multiline stage) — UI их не группирует.

## 2. Datadog Logs Explorer

Источник: <https://docs.datadoghq.com/logs/explorer/> и <https://docs.datadoghq.com/logs/explorer/facets/>

- UI чётко разделяет **Message** (одна "главная" колонка, всегда видна) и **Attributes** (всё, что pipeline вытащил). Колонки выбираются через шестерёнку **Options → Columns**, либо right-click по значению атрибута → **Add column for @attr**.
- В строке списка: severity-иконка слева, источник/service бейджами, потом render'ится Message с inline-highlighting известных полей. Heterogeneous JSON-объекты внутри Message сворачиваются, expand'ятся отдельным кликом.
- Side-panel при клике на строку даёт три таба: **Content** (table-view атрибутов), **JSON** (raw event), **Trace/Host/Network**. Переключение format-aware ↔ raw — это переключение Content/JSON в side-panel'е.
- Pattern Inspector группирует похожие строки в один pattern с placeholder'ами — отдельный UI-приём для нестратурированной части.

## 3. Splunk

Источник: <https://docs.splunk.com/Documentation/Splunk/latest/Search/Aboutfields> и <https://docs.splunk.com/Documentation/Splunk/latest/Search/Aboutthesearchapp>

- Дефолт — **Events list** с `_raw` как основной payload. Слева sidebar делит поля на **Selected fields** (вверху каждой строки рядом с raw) и **Interesting fields** (>=20% coverage). Клик на поле → "Add to selected" → оно появляется inline под `_raw`.
- Переключатель **Events / Patterns / Statistics / Visualization** в верхней панели — это переключение format-aware ↔ raw. **Table view** (через `| table`) превращает события в строгие колонки.
- Каждое событие можно раскрыть в **Event Actions → Show Source / Show as raw text / Show as table** — три способа смотреть одну и ту же запись.
- Field discovery работает поверх heterogeneous payload'а — поля из JSON и kv-pairs появляются в одном sidebar'е независимо от формата строки.

## 4. Elastic Kibana Discover

Источник: <https://www.elastic.co/guide/en/kibana/current/discover.html> и <https://www.elastic.co/guide/en/kibana/current/document-explorer.html>

- Дефолтная "Document table" — две колонки: **Time** + **\_source** (склеенное `key:value key:value …`). Левый sidebar — **Available fields** с галочками; галочка → колонка в таблице (`\_source` исчезает).
- Раскрытие строки даёт два под-таба: **Table** (поля построчно с типами и actions) и **JSON** (raw \_source pretty-printed). Это и есть основной toggle format-aware ↔ raw.
- Field types подсвечены иконкой (`t` string, `#` number, `{}` object). Nested objects в \_source показываются flattened (`a.b.c`), но в JSON-табе — как настоящее дерево.
- "Unified Field List" (Kibana 8+) добавил drag-and-drop полей в таблицу и **Popular fields** на основе usage.

## 5. lnav (terminal log navigator)

Источник: <https://docs.lnav.org/en/latest/formats.html> и <https://lnav.org/features>

- Schema-driven: каждый format — JSON-описание с регекспом `line-format` и списком `value`-полей. lnav сам определяет формат **per file** (или per-line при mixed) и применяет color-coding + level-detection.
- Внутри pager'а строка всегда показана в **оригинальном виде** (formatting не теряется), но `;`-команды (`:switch-view pretty`) дают pretty-print JSON inline. `:` команда `filter-expr`/`hide-fields` работает по извлечённым полям.
- Несколько форматов в одном файле — нормальный кейс: lnav для каждой строки независимо выбирает matching format. Stack traces описываются как `multiline` через `body-field` + continuation regex.
- Колонок в UI как таковых нет — "колонки" видны только в SQL-режиме (`;SELECT log_time, sc_status FROM access_log`), который рендерит результат как настоящую таблицу.

## 6. Klogg / glogg

Источник: <https://klogg.filimonov.dev/docs/> и <https://github.com/variar/klogg>

- Чисто текстовый просмотрщик: одно главное окно с raw-строками, отдельное окно для filtered-view (по regexp). "Колонок" в UI нет.
- Extracted columns делаются через **Highlighters** (regexp с named groups) — но это про подсветку, а не про переключение в табличный вид. Klogg сознательно не пытается понимать форматы.
- Multi-format в одном файле: пользователь сам пишет regexp'ы под каждый "тип" строк и добавляет их как отдельные highlighter sets. Stack traces не группируются.
- Format-aware/raw toggle отсутствует as a feature — это и есть позиционирование "fast, dumb, reliable".

## 7. Web-просмотрщики (Mezmo/LogDNA, Better Stack/Logtail, Papertrail, Vector tap)

Источники: <https://docs.mezmo.com/log-analysis/views-and-graphs>, <https://betterstack.com/docs/logs/>, <https://www.papertrail.com/help/permanent-log-archives/>, <https://vector.dev/docs/reference/cli/#tap>

- **Mezmo/LogDNA**: одна строка = render'нутое `_line` + chip'ы с host/app/level. Side-panel с раскрытым JSON; **"Pin field"** добавляет поле inline под каждую строку (не как настоящую колонку — как badge).
- **Better Stack/Logtail**: похожий side-panel + Live Tail. Поддерживает "structured search" по `field:value` поверх heterogeneous payload'а; в UI поля показываются как key-value пары в expanded-view, raw остаётся отдельной вкладкой.
- **Papertrail**: радикально минималистичен — почти только raw-строки + system/program бейджи слева. Никаких extracted fields в UI.
- **Vector tap** / `vector top`: CLI, JSON-payload рендерится pretty-printed в потоке; никакой колоночной структуры.

## Общие UI-паттерны (5 пунктов)

1. **Raw-строка всегда первоисточник истины.** Даже когда инструмент показывает extracted fields, под рукой есть способ увидеть оригинал (Splunk `_raw`, Kibana JSON-таб, Datadog JSON-таб, lnav default view). Format-aware вид — это always "additionally to" raw, не "instead of".
2. **Две зоны: компактная list-view + богатый detail panel.** List = одна-две главные колонки (Time + Message/\_raw/\_source). Detail = side-panel или expanded row с full attributes, обычно с переключателем Table ↔ JSON.
3. **Колонки добавляются из field-sidebar'а, не из настроек.** Универсальный паттерн: discover fields (counts/usage) → click/drag → колонка в list-view. Splunk "selected/interesting", Kibana "available", Datadog "facets", Loki "detected fields" — одна и та же ментальная модель.
4. **Heterogeneous payload унифицируется через "flat key-value bag".** JSON, logfmt, regexp-extracted поля попадают в один namespace атрибутов (часто с префиксом типа `@` в Datadog или `.` в LogQL). Пользователь не различает "это из JSON" vs "это из regexp" в UI.
5. **Multiline/stack-traces — это ingestion problem, не UI problem.** Все инструменты решают склейку multiline ДО показа (Loki promtail stages, lnav `body-field`, Splunk `LINE_BREAKER`/`SHOULD_LINEMERGE`). В UI stack trace — это одна "строка" с раскрытием по клику, а не отдельный режим отображения.

---

## Применимость к log-viewer (наш проект)

Свободная заметка для последующего обсуждения, не часть research'а:

- Из общих паттернов наиболее ценные для PWA-просмотрщика без backend'а: (а) "raw-строка всегда видна", (б) field-sidebar с counts, (в) toggle Table/JSON в expanded row.
- Klogg-style "просто текст + regexp highlighters" — резервный fallback на случай, когда `parseAny` не справился; стоит держать как degraded-mode, а не как главный UI.
- lnav schema-driven подход концептуально ближе всего к тому, что уже есть в `src/core/parsers/registry.ts` — стоит посмотреть, как lnav решает priority parser'ов и UI-индикацию "этот формат не распознан".
