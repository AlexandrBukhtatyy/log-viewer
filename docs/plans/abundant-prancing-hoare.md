# bfcache-safe shutdown/restart воркеров

## Context

**Симптом.** При навигации `/log-viewer/` → `/log-viewer/app/` → back → app на GitHub Pages app встречает `OPFS lock conflict: SQLite index is still held by another worker` (см. [open-db.ts:189-202](../../src/workers/indexer/db/open-db.ts#L189-L202)). `hydratePersisted`, `useFieldSchema`, `refreshAll` падают каскадом — БД не открылась → sources не появляются. `Ctrl+R` чинит, обычный переход — нет.

**Причина.** Браузерный bfcache. При back-навигации `/app/` сохраняется в кэше живой со всеми Web Workers — indexer-worker продолжает держать эксклюзивный `createSyncAccessHandle` на `/logs.sqlite` в OPFS. Новая инстанция `/app/` не может зарегистрировать SAH Pool VFS. Retry в [open-db.ts:90](../../src/workers/indexer/db/open-db.ts#L90) рассчитан на ~3 с (HMR cycle), bfcache живёт минутами.

**Цель.** При `pagehide(persisted=true)` отпустить SAH-handle; при `pageshow(persisted=true)` пересоздать клиент без `location.reload()`, чтобы UX не моргал.

**Что уже готово (переиспользуем как есть).**

- `CoordinatorApi.shutdownIndexer()` — [coordinator.contract.ts:213-223](../../src/core/rpc/coordinator.contract.ts#L213-L223).
- Реализация shutdown в [coordinator/index.ts:68-82](../../src/workers/coordinator/index.ts#L68-L82): close-RPC к indexer → terminate child worker → reset state; lazy `getIndexer()` ([index.ts:34-60](../../src/workers/coordinator/index.ts#L34-L60)) re-spawn'ит при следующем RPC.
- `IndexerApi.close()` — [indexer-api.ts:327-335](../../src/workers/indexer/indexer-api.ts#L327-L335): finalize prepared statements + `db.close()`.
- `ViewStore.destroy()` — [log-client.ts:498-524](../../src/worker-client/log-client.ts#L498-L524): unsubscribe → `shutdownIndexer()` → `coordinatorWorker.terminate()` → обнулить локалы.
- HMR cleanup в [log-client.ts:174-181](../../src/worker-client/log-client.ts#L174-L181) уже дёргает `destroy()` + `singletonStore = null` — точный паттерн bfcache pagehide.

Чего нет: `pagehide`/`pageshow` listener'ов и способа уведомить React-провайдер о reset singleton'а, чтобы свопнуть store без перезагрузки страницы.

## Approach

Два module-level экспорта в `log-client.ts` (рядом с HMR-блоком, та же семантика «pipeline invalidated, release SAH lock»):

- `shutdownViewStore()` — публичная версия HMR dispose: `await singletonStore?.getState().destroy(); singletonStore = null;`.
- `subscribeStoreReset(cb)` — простой module-level список callback'ов, вызываемых ПОСЛЕ reset.

Module-level `pagehide`/`pageshow` listener'ы там же:

- `pagehide(persisted=true)`: `void shutdownViewStore()` (fire-and-forget — `pagehide` не ждёт promise, см. trade-off ниже).
- `pageshow(persisted=true)`: `shutdownViewStore()` (если ещё жив) → создать новый store через `getOrCreateViewStore()` → нотифицировать подписчиков.
- `persisted=false` — ранний return.

React-сторона ([WorkerClientProvider.tsx:18](../../src/app/providers/WorkerClientProvider.tsx#L18)): подписка на `subscribeStoreReset` + key-bump `<ViewStoreContext.Provider key={epoch}>`. Полный re-mount поддерева чище `setStore`-варианта — consumer'ы держат zustand-subscriptions через `useViewStore` ([view-store-context.ts:6](../../src/app/providers/view-store-context.ts#L6)) и локальные `useState/useRef` с `SourceId`/`EntryId`, переподписать всё атомарно надёжнее.

**Async race в pagehide (acceptable trade-off).** Браузер не ждёт promise, страница может freeze'нуться до завершения shutdown-RPC. Принимаем как best-effort: `shutdownIndexer` отсылает RPC через `postMessage` синхронно — успевает до freeze. Indexer-worker заморозится с in-flight `close()`, но при unfreeze микрозадачи воркера выполнятся; плюс на pageshow мы повторно дёргаем reset, который terminate'ит coordinator → indexer теряет parent и собирается GC'ом, SAH handle отдаётся через ≤1 frame.

## Implementation

### 1. `src/worker-client/log-client.ts`

После HMR-блока (после строки 181):

- Экспорт `shutdownViewStore(): Promise<void>` — извлечь тело из `import.meta.hot.dispose` callback'а и переиспользовать как из HMR, так и из bfcache. Сам HMR блок переписать на `await shutdownViewStore()`.
- Экспорт `subscribeStoreReset(cb: () => void): () => void` — `Set<() => void>` на module-level, add/delete.
- Под `if (typeof window !== 'undefined')` зарегистрировать `pagehide`/`pageshow` listener'ы. `pagehide(persisted)`: `void shutdownViewStore()`. `pageshow(persisted)`: `void shutdownViewStore().then(() => { getOrCreateViewStore(); resetListeners.forEach(cb => cb()); })`. Module-level — listener'ы НЕ снимаются (нет cleanup hook'а; для случая HMR это OK, listener'ы пересоздаются вместе с модулем).

### 2. `src/app/providers/WorkerClientProvider.tsx`

- `useState<ViewStore>` оставить как есть.
- Добавить `const [epoch, setEpoch] = useState(0)`.
- В `useEffect` (рядом с persisted-resume hook'ом, новый отдельный useEffect): `subscribeStoreReset(() => { setStore(getOrCreateViewStore()); setEpoch(e => e + 1); })`, вернуть unsubscribe.
- JSX: `<ViewStoreContext.Provider value={store} key={epoch}>{children}</ViewStoreContext.Provider>` — key на провайдере re-mount'ит всё дерево. `persisted-resume` useEffect ([WorkerClientProvider.tsx:25-27](../../src/app/providers/WorkerClientProvider.tsx#L25-L27)) сработает заново благодаря deps `[store]`.

### 3. `src/worker-client/log-client.test.ts` (новый)

Vitest unit-тесты (моки `Worker`/`Comlink.wrap` по образцу [parser-pool.test.ts:17](../../src/workers/coordinator/pool/parser-pool.test.ts#L17)):

- `getOrCreateViewStore()` дважды подряд → один и тот же instance.
- `shutdownViewStore()` → spy на `shutdownIndexer` и `terminate` вызваны; следующий `getOrCreateViewStore()` возвращает другой instance.
- `subscribeStoreReset` callback вызван после reset; unsubscribe останавливает оповещение.
- `window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))` → shutdown вызван; с `persisted: false` — нет.
- `pageshow(persisted: true)` → singleton пересоздан и callback'и оповещены.

### 4. ADR (`/adr bfcache worker reset`)

Обязателен по политике CLAUDE.md («контракт между модулями, на который будем ссылаться»). Мотивация: ADR-0014 явно фиксирует «ViewStore singleton не destroy'ится» ([0014-worker-lifecycle.md:54](../adr/0014-worker-lifecycle.md#L54)) — новый ADR вводит исключение для bfcache, ссылается на 0014 и дополняет его. Содержание:

- Проблема (SAH lock + bfcache).
- Решение (pagehide → fire-and-forget shutdown, pageshow → reset + notify subscribers, провайдер делает key-bump).
- Контракт `shutdownViewStore` + `subscribeStoreReset` как новых публичных module-level API в log-client.ts.
- Acceptable trade-off: нет hard guarantee, что close-RPC выполнится до freeze.
- Отвергнутые альтернативы (одна строка каждая): `location.reload()` — UX-регресс, `addEventListener('unload', ...)` — отключает bfcache целиком, SharedWorker — Safari/iOS, увеличить retry до 60s — не покрывает bfcache.

## Verification

1. **Unit-тесты:** `pnpm test src/worker-client/log-client.test.ts` — все кейсы зелёные.
2. **Build/lint:** `pnpm build && pnpm lint` — без ошибок.
3. **Manual smoke (prod-сборка локально):**
   - `pnpm build && pnpm preview` → `http://localhost:4173/log-viewer/`.
   - Открыть DevTools → Application → Back/forward cache → Test back/forward cache (Chrome подскажет, eligible ли страница).
   - Кликнуть «Open the app», дождаться загрузки (можно добавить fixture-source через `pnpm gen:fixtures` + drag-drop `.tmp/`).
   - Browser back → лендинг.
   - Клик «Open the app» снова.
   - **Ожидаемое:** sources появляются без ошибок в Console; нет `OPFS lock conflict`, нет `hydratePersisted failed`.
   - Повторить ≥3 раза.
4. **Negative path:** `Ctrl+R` на app — поведение не изменилось, sources подтягиваются.
5. **GitHub Pages:** после merge — проверить тот же сценарий на `https://alexandrbukhtatyy.github.io/log-viewer/`.

## Critical Files

- [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts) — добавить `shutdownViewStore`, `subscribeStoreReset`, listener'ы; переписать HMR dispose через `shutdownViewStore`.
- [src/app/providers/WorkerClientProvider.tsx](../../src/app/providers/WorkerClientProvider.tsx) — подписка + key-bump.
- [src/worker-client/log-client.test.ts](../../src/worker-client/log-client.test.ts) — новый файл с unit-тестами.
- [docs/adr/NNNN-bfcache-worker-reset.md](../adr/) — новый ADR, ссылается на 0014.
- [docs/adr/README.md](../adr/README.md) — добавить запись в `## Index` (автоматически через `/adr`).
