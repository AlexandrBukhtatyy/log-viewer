# 0034. Read-path FTS grammar + search autocomplete

- Status: proposed
- Date: 2026-06-15

## Context and Problem Statement

Строка поиска имеет тоггл `queryMode='fts'`, но он был **заглушкой**: FTS-режим
сводился к подстрочному поиску (`compileFts` → `compileSubstring` в
[query-match.ts](../../src/core/filter/query-match.ts)). Автодополнения в поиске не было.

Архитектурное ограничение: после [ADR-0016](0016-offset-pointer-index-lazy-body.md)
(миграция v3 активна) тело `raw`/`message` **не хранится** в SQLite, виртуальная таблица
`entry_fts` удалена. Свободный поиск выполняется **post-resolve в JS** в координаторе
(`compileFreeTextQuery` / `matchesFreeText`). Значит SQL-уровневый FTS5 недоступен без
повторного индекса.

## Considered Options

- **FTS-движок:**
  - A. Грамматика на read-path — парсим запрос в булев AST, матчим против токенов записи.
  - B. Вернуть SQL FTS5 (`entry_fts`) — противоречит ADR-0016, требует ре-материализации тела.
  - C. Contentless FTS5 / собственный inverted index — большой отдельный movement.
- **Автокомплит — источники подсказок:** значения полей (field-schema `topValues`),
  сохранённые/недавние запросы, подсказки FTS-синтаксиса.

## Decision Outcome

Chosen: **A + автокомплит из трёх источников**, потому что A согласуется с ADR-0016
(поиск на read-path), не требует изменений схемы/индекса и даёт пользователю настоящую
FTS-семантику немедленно. B отвергнут (противоречит курсу), C — будущий отдельный ADR,
если read-path станет узким местом по перформансу.

**Грамматика FTS (контракт)** — подмножество FTS5, реализованное в
[query-match.ts](../../src/core/filter/query-match.ts):

- неявный **AND** между терминами: `out of memory`;
- **фразы** в кавычках: `"out of memory"` (непрерывная последовательность токенов);
- **OR** (ниже приоритетом, чем AND): `error OR warn`;
- **исключение**: `-debug` или `NOT debug`;
- **префикс**: `time*`;
- токенизация по `\p{L}\p{N}_`, регистронезависимо по умолчанию (`caseSensitive` honored);
  `wholeWord` в FTS-режиме не применяется (матч уже пословный).

Невалидный/пустой парс → «matches nothing» (как и для regex), пустой запрос → нет фильтра.

**Автокомплит** — чистый построитель `buildSearchSuggestions`
([search-suggest.ts](../../src/ui/utils/search-suggest.ts)) + презентационный
`LvSearchSuggest`, общий для строки фильтров и панели Search:

- **Values** — `FieldDescriptor.topValues` (ADR-0017), заменяют последний токен;
- **Recent/Saved** — недавние ([use-search-history.ts](../../src/hooks/use-search-history.ts),
  ключ `lv:search-history`) и сохранённые, заменяют весь запрос;
- **Syntax** — операторы FTS (фраза/префикс/исключение/OR), только в `fts`-режиме.

### Consequences

- Good: FTS-тоггл реально полнотекстовый (boolean/phrase/prefix); согласовано с ADR-0016.
- Good: единый автокомплит на обеих поверхностях; новые пропсы `LvSearchInput` опциональны —
  прочие использования (sidebar, find-bar) не затронуты.
- Bad: FTS-матч линейный по видимому окну (тот же post-resolve путь, что substring/regex) —
  не SQL-ускорен. Быстрый индекс — будущий ADR (C).
- Neutral: значения-подсказки появляются только когда field-schema наполнена (после индексации).

## Links

- [ADR-0016](0016-offset-pointer-index-lazy-body.md) — α (без SQL-FTS), read-path поиск.
- [ADR-0017](0017-dynamic-field-schema.md) — field-schema / `topValues` для подсказок значений.
- [ADR-0005](0005-sqlite-fts5-opfs-index.md) — исходный SQLite+FTS5 (FTS-часть заменена ADR-0016).
