# 0010. LvApp поверх ViewStore: core-типы — единственный источник, UI без адаптеров

- Status: proposed
- Date: 2026-05-03
- Supersedes: [ADR-0009](0009-mock-default-app.md)

## Context and Problem Statement

После [ADR-0009](0009-mock-default-app.md) дефолтный entry приложения был
mock-driven `LvApp` — UI работал, но не использовал реальный
worker-pipeline, индексер OPFS+FTS5, парсеры, источники. Headless-слой
существовал параллельно, но не был подключён.

Параллельно UI после декомпозиции из Claude Design (см.
[docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md))
имел собственные дублирующие типы (`LvFilters`, `LvLogEntry`,
`LvLogLevel`, `LvLogKind`, `LvFieldFilter`, `LvFieldFilterOp`),
расходящиеся с `LogFilter`/`LogEntry`/`LogLevel`/`FieldFilter` из
[src/core/types/](../../src/core/types/). Между формами лежал бы естественный
адаптерный слой — но это лишняя индирекция и второй источник истины.

Цель — подключить `LvApp` к реальному ViewStore и при этом устранить
дублирование форм данных, не добавляя адаптерного слоя для конверсии.

## Considered Options

- **A. Адаптеры между UI и core.** UI продолжает использовать `LvFilters`/`LvLogEntry`,
  контейнер конвертирует двусторонне. Соответствует букве ADR-0002 §Adapter-слой.
- **B. Выровнять core под UI.** Core получает недостающие поля (`wholeWord`,
  `services`, расширенные `FieldFilterOp`), новые варианты `LogSource`. UI
  удаляет дубликаты, потребляет core-типы напрямую через `import type`
  (ESLint `allowTypeImports: true` в `ui/components/` уже разрешает).
- **C. Параллельные стеки.** Оставить mock-default; добавить отдельный
  путь `?wired=1` для боевого. Не решает гэп.

## Decision Outcome

Chosen option: **«B. Выровнять core под UI, без конверсий»**.

Это **уточнение** трактовки [ADR-0002 §Adapter-слой](0002-headless-architecture.md), а не отказ
от него. Прямая цитата из ADR-0002: _«Если шейпы совпадают — adapter =
re-export. Если adapter растёт за ~30 строк — переделываем промпт под
контракт.»_ После выравнивания core шейпы совпадают, и адаптеры
вырождаются до пустоты — `src/ui/adapters/` остаётся опциональной папкой
для починки props при будущих регенерациях UI (renamed prop'ы и т.п.).

### Что сделано

**Core расширен** (форма-paritet с UI):

- [src/core/types/log-filter.ts](../../src/core/types/log-filter.ts):
  - `wholeWord: boolean` — отдельный флаг (substring/regex с `\b`-обёрткой,
    FTS с phrase-quoting).
  - `services: ReadonlyArray<string> | null` — `IN`-clause через
    `JSON_EXTRACT(fields_json, '$.service')`.
  - `FieldFilterOp = '=' | '!=' | '~' | '>' | '<'` — символьный набор;
    операторы `>`/`<` через `CAST AS REAL`.
  - Обновлён `EMPTY_FILTER`.
- [src/core/filter/query.ts](../../src/core/filter/query.ts):
  - `services` → `IN`-clause.
  - `fieldFilters` через `JSON_EXTRACT(fields_json, '$.<key>')` со всеми
    пятью операторами; для `>`/`<` — `CAST AS REAL`.
  - `wholeWord`: для substring — обёртка `' ' || message || ' ' LIKE '% word %'`
    (Phase-1 fallback; полноценный `\b…\b` через REGEXP UDF — Phase 2).
    Для FTS — phrase quotes.
  - regex queryMode остаётся silently-dropped до Phase 2.
- Расширены тесты в [query.test.ts](../../src/core/filter/query.test.ts) (12 → 21).

**Core source-kinds расширены** под полный UI-набор `LvAddSourceMenu`:

- [src/core/types/log-source.ts](../../src/core/types/log-source.ts) — добавлены
  `RemoteSshLogSource`, `CloudLogSource`, `K8sLogSource`, `BusLogSource`,
  `DbLogSource`, `SnapshotLogSource` + соответствующие `LogSourceInput` варианты.
- [src/core/sources/stub-adapters.ts](../../src/core/sources/stub-adapters.ts) — фабрики-заглушки
  для каждого нового kind: `open()` сразу throw `not implemented` с
  пояснением, `close()` no-op. Регистрация в `defaultAdapterFactories` —
  координатор маршрутизирует, источник переходит в
  `SourceStatus.kind === 'error'`. Реальные адаптеры приходят отдельными
  ADR (см. план §3, §5).
- Соответствующие методы в [worker-client/log-client.ts](../../src/worker-client/log-client.ts) и
  [hooks/use-source-controller.ts](../../src/hooks/use-source-controller.ts):
  `addRemoteSsh`, `addCloud`, `addK8s`, `addBus`, `addDb`, `addSnapshot`.

**UI удалил дубликаты типов.** `src/ui/contracts/lv-types.ts` теперь
содержит только UI-only сущности (`LvCatalogRoot`, `LvFolderNode`,
`LvFileNode`, `LvNode`, `LvSourceKind`, `LvRail`, `LvGroupBy`, `LvGroup`,
`LvTab`, `LvLogKind`). `LvSavedSearch`, `LvTweaks*` живут рядом со своими
персистентными хуками (см. ниже) и реэкспортируются. Все `Lv*`-компоненты
работают напрямую с `LogEntry`/`LogFilter`/`LogLevel`/`FieldFilter` из core
через `import type`. UI визуально не изменился; renamed только обращения
к полям (`entry.message` вместо `entry.msg`, `entry.timestamp` вместо
`entry.ts`, `entry.seq` вместо `entry.line`); `file/path/kind` для рендера
строки берутся через prop `fileMeta` (lookup `filesById[entry.sourceId]`).

**Виртуализация в `LvViewer`.** [@tanstack/react-virtual](https://www.npmjs.com/package/@tanstack/react-virtual)
(уже в deps) портирован внутрь — LvViewer теперь принимает
`rowCount`/`getRow(i)`/`onVisibleRangeChange(from, to)` от `useLogWindow`
вместо полного массива. Это однократно меняет props-контракт (ADR-0002
gate: пометить регенерируемым по этому контракту).

**5 новых UI-only хуков** в [src/hooks/](../../src/hooks/) с
`localStorage`-persist'ом:

- [use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts) — tweaks
  (theme/density/accent/wrap/showDate/timelineOn).
- [use-bookmarks.ts](../../src/hooks/use-bookmarks.ts) — `Set<EntryId>`.
  Caveat: `EntryId` нестабилен между ре-ингестами; стабильный fingerprint
  переедет в Phase 4.
- [use-recent-files.ts](../../src/hooks/use-recent-files.ts) — top-10 selected.
- [use-saved-searches.ts](../../src/hooks/use-saved-searches.ts).

**[`LvAppContainer`](../../src/app/containers/LvAppContainer.tsx)** —
единственный шов хуков и UI. Хранит `coreFilter` (без `sources`) +
`selectedIds`/`activeTabId`/`closedTabs` локально, выводит эффективный
`filter` через `useMemo` (sources подмешаны из selection +
`activeTabId === '__all__'`), пушит в ViewStore через
`useLogFilter().setFilter` (write в zustand вне React-render-цикла, не
React-setState). Каталог дерева — синтетический через
[buildCatalogTree](../../src/ui/utils/build-catalog.ts) поверх
`useSourceStatus().sources`.

**[src/App.tsx](../../src/App.tsx)** — тонкая обёртка
`<WorkerClientProvider><LvAppContainer/></WorkerClientProvider>`. Mock в
`src/dev/log-data-mock.ts` удалён. ADR-0009 помечен superseded.

### Consequences

- Good: одна форма данных между UI и core. Никаких конверсий ↔ никакой
  второй источник истины ↔ никакого drift'а между LvFilters и LogFilter.
- Good: реальный pipeline под UI — open file через `+ file` парсит,
  индексирует в OPFS, фильтрует SQL-ом, отдаёт через виртуализованное
  окно.
- Good: bundle снова содержит sqlite-wasm + workers — потому что `LvApp`
  теперь реально их использует.
- Good: 9 source kinds в UI работают «честно»: для file/directory/text/url/stream
  — реальные адаптеры; для остальных — stub'ы, которые роняются с
  внятным сообщением. Это лучше, чем скрывать UI-меню.
- Bad: `Lv*`-компоненты теперь импортят `LogEntry`/`LogFilter` напрямую
  из core. При регенерации Claude Design нужно убедиться, что новый JSX
  тоже импортит из core (через type-imports). Альтернатива — ловить
  drift через адаптер; лечится при первой проблемной регенерации (см.
  ADR-0002 §Adapter-слой).
- Bad: контейнер удерживает значительно больше state'а, чем минимум —
  selection, tabs, groupBy, liveTail плюс persisted-через-хуки. Проверять
  компактность по мере роста.
- Neutral: Phase-2 SQL-доделки (regex queryMode, server-side
  group/histogram) — отдельный план, тут только parity по форме.

### Снятие mock'а

- [src/dev/log-data-mock.ts](../../src/dev/log-data-mock.ts) удалён.
- [src/App.tsx](../../src/App.tsx) больше не fallback'ает на mock-фикстуру.
- [docs/adr/0009-mock-default-app.md](0009-mock-default-app.md) — статус
  обновлён на `superseded by ADR-0010`.

## Links

- [ADR-0002](0002-headless-architecture.md) — headless-слои; уточнение
  трактовки §Adapter-слой.
- [ADR-0007](0007-state-management-zustand.md) — ViewStore-контракт.
- [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md)
  — план gap-инвентаризации; этот ADR закрывает Phase 1.
