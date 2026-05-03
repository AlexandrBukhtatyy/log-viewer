## 0013. Directory persistence resume и стабильный fingerprint для bookmarks

- Status: proposed
- Date: 2026-05-02

## Context and Problem Statement

После [ADR-0006](0006-persistence-strategy.md) directory-источники
сохраняли свои `FileSystemDirectoryHandle` в IndexedDB, но в координаторе
методы `resumePersistedSources` и `grantPermission` оставались
`notImplemented`. После reload'а UI видел persisted-источник в дереве
(статус `done` с историческим `entryCount`), но не мог re-attach'нуться
к свежим данным — хэндл в браузере мог требовать повторного permission
prompt (Chromium делает это после ~24h или при определённых
конфигурациях user-settings).

Параллельно в Phase 1/2 bookmarks хранили `EntryId` (UUID, генерируется
свежий при каждом insertBatch). Любой re-ingest того же файла
выбрасывал старые bookmark'и: id поменялся, `bookmarks.has(entry.id)`
вернул false на той же строке.

## Considered Options

- **A. Резюм через user-prompt + fingerprint = `<sourceId>:<fnv1a(raw)>`.**
  Координатор сам зовёт `handle.queryPermission`/`requestPermission`;
  fingerprint считается в core-util и используется UI'ом как bookmark
  ключ.
- **B. Auto-grant через persisted permission API.** В Chromium есть
  `persisted` опция, но она требует PWA install + `getInstalledRelatedApps`,
  плюс не работает в Firefox/Safari. Слишком хрупко.
- **C. Bookmarks по `<sourceId>:<seq>`.** Проще, но `seq` сдвигается, если
  в файл добавилась строка в начало.
- **D. Bookmarks по entry.id, но генерировать id в indexer как
  fingerprint.** Чище в долгосрочной перспективе, но требует schema
  миграции в SQLite и затрагивает UNIQUE-семантику (две одинаковых
  raw-строки → конфликт). Phase 5+ — отложено.

## Decision Outcome

Выбрано **«A»**.

### resumePersistedSources / grantPermission

[src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts)
получил helper `startIngest(source)` (вынесен из `addSource`) — общая
точка для запуска ingest'а живого источника. Использует тот же
`AbortController`, тот же `onStatus`/`onChange`-roundtrip.

`resumePersistedSources()`:

1. await `hydratePersisted()` — список persisted directory records уже
   собран при инициализации.
2. Для каждого `directory` рекорда — `handle.queryPermission({mode:'read'})`:
   - `'granted'` → `startIngest(...)`, добавляем id в `resumed`.
   - `'prompt'` / `'denied'` → `markPermissionRequired(...)`,
     добавляем в `needsPermission`. Status источника становится
     `{kind: 'permission-required'}`.
3. Возвращает `ResumeReport`. Идемпотентен — повторный вызов после
   grant'а ничего не сломает.

`grantPermission(id)`:

1. Поднимает handle из handle-store по id.
2. `handle.requestPermission({mode:'read'})` — должен быть **внутри
   user-gesture'а** (UI «Grant access» click). Comlink-RPC сохраняет
   gesture'овую активность через цепочку promise'ов в Chromium.
3. Если `'granted'` → `startIngest(...)`, return true. Иначе false.

[log-client.ts](../../src/worker-client/log-client.ts) после initial
refresh вызывает `api.resumePersistedSources()` автоматически — UI не
обязан явно дёргать. Granted-источники сразу видны как `loading →
indexing → done`; prompt-источники — как chip с кнопкой.

### Permission-required UI affordance

[LvFileNode](../../src/ui/contracts/lv-types.ts) получил
`needsPermission?: boolean` + `errorMessage?: string`.
[buildCatalogTree](../../src/ui/utils/build-catalog.ts) маппит
`SourceStatus.kind === 'permission-required'` → `needsPermission: true`,
а `'error'` → читаемое сообщение во tooltip.

[LvTreeNode](../../src/ui/components/sidebar/LvTreeNode.tsx) теперь
рендерит inline-кнопку «Grant access» рядом с именем файла; клик
вызывает `useSourceController().grantPermission(id)` (через
[LvAppContainer](../../src/app/containers/LvAppContainer.tsx)). Дополнительно
показывает `⚠`-индикатор для error-статуса с `title=errorMessage`.

Стили в [lv.css](../../src/ui/styles/lv.css) — компактный чип с
warn-цветом, маленький по визуальному весу (это нормальное состояние
для рестора).

### Bookmark fingerprint

[src/core/util/fingerprint.ts](../../src/core/util/fingerprint.ts):

```ts
export const entryFingerprint = (entry: LogEntry): string =>
  `${entry.sourceId}:${fnv1aHex(entry.raw)}`;
```

FNV-1a: 32-bit, ~5 LOC, нет deps, ~150 ns на короткую строку. Hex
8 chars. Не криптография — collision'ы означают только «два entries
светятся как bookmark одновременно», что приемлемо в UI (две одинаковых
строки в логе обычно — copy-paste error или периодическая
healthcheck-запись, и пользователь не различил бы их и без bookmark'а).

[LvAppContainer](../../src/app/containers/LvAppContainer.tsx) теперь:

- `bookmarkKeyOf = entryFingerprint` пробрасывается через `LvApp →
  LvViewer → LvRow`.
- `LvRow.bookmarked` = `bookmarks.has(bookmarkKeyOf(entry))`.
- `LvRow.onBookmark` фолдит `bookmarkKeyOf(entry)` перед вызовом.
- `bookmarkEntries` lookup'ит `LogEntry`-резолверы по fingerprint, не
  по entry.id.

Хук [useBookmarks](../../src/hooks/use-bookmarks.ts) под капотом не
изменился — он по-прежнему хранит `string[]` в localStorage, просто
теперь эти строки имеют форму `<sourceId>:<8-hex>` вместо UUID.
Существующие bookmark'и пользователей **с UUID'ами всё ещё работают**
до первого re-ingest'а — после чего станут «зависшими» (никогда не
матчатся), и пользователь сможет снять старый bookmark вручную через
панель Bookmarks. Полную миграцию старых bookmark'ов в новый формат
делать нельзя без access'а к raw — это отдельный data-cleanup job
(`useBookmarks().clear()` или ручное удаление в panel).

### Tests

[fingerprint.test.ts](../../src/core/util/fingerprint.test.ts) (7
кейсов): детерминизм fnv1aHex, форма результата, стабильность
fingerprint'а между разными `EntryId`/`seq` для того же
`sourceId+raw`, чувствительность к sourceId/raw, regex-форма.

Полный цикл `resumePersistedSources/grantPermission` тестируется
ручным smoke в браузере — потребовался бы full Chromium с FSA + IDB
mock'ом, ROI слишком низкий для unit-уровня.

### Consequences

- Good: открытые ранее папки автоматически re-attach'аются после
  reload'а. Granted — без user-action; prompt — клик «Grant access».
- Good: bookmark'и переживают close/open-цикл одного и того же файла —
  то самое user-видимое поведение, которое в Phase 1 было каведом.
- Good: API чистое — координатор владеет permission flow, UI владеет
  affordance, container — клеем.
- Bad: пользователи с bookmark'ами от Phase 1/2/3 увидят, что часть
  старых отметок «потерялись» после первого re-ingest'а. Mitigation —
  release-note: «Bookmarks теперь стабильны между ре-ингестами;
  старые bookmark'и могут потребоваться переотметить один раз».
- Bad: FNV-1a 32-bit collision rate ~ 1 / 4 млрд для случайных строк.
  В лог-фикстуре с 100k entries это means одна-две коллизии на
  source. Acceptable для UI; для крипто-важных данных понадобится
  SHA-256.
- Neutral: handle-store schema без изменений — мы переиспользуем
  существующие записи.

## Links

- [ADR-0006](0006-persistence-strategy.md) — handle-store и стратегия
  persisten-источников; этот ADR закрывает Phase 4 (плюс bookmark
  fingerprint, тоже было в Phase 4 plan'a).
- [ADR-0010](0010-lv-on-viewstore-core-types.md) — context'ный bookmark
  caveat задокументирован тут как «нестабилен между ре-ингестами».
- [docs/plans/replicated-cooking-muffin.md §Phase 4](../plans/replicated-cooking-muffin.md#phase-4--persistence-directory-источников-p2)
  — план, по которому шла работа.
