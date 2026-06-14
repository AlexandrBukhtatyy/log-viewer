## 0014. Worker lifecycle: lazy singletons + dynamic parser pool

- Status: proposed
- Date: 2026-05-05

## Context and Problem Statement

[ADR-0003](0003-worker-centric-topology.md) зафиксировал topology
«coordinator → indexer + parser pool», но lifecycle оставался не
прописанным. На старте проекта это привело к двум багам:

1. **Дубликат всей цепочки в dev из-за React 19 StrictMode.** `WorkerClientProvider`
   создавал ViewStore через `useState(() => createLogClient())`, а
   `createLogClient()` сразу спавнил coordinator-воркер, indexer-воркер и
   фикс-размер parser pool. StrictMode invoke'ит factory дважды → два
   набора воркеров → коллизия на OPFS SAH-pool VFS у двух indexer'ов →
   `NoModificationAllowedError` cascade → `addSource` RPC висит навсегда,
   потому что React subscribed на одного coordinator'а, а половина пула
   занята другим. Симптом для пользователя — «нажал Add, ничего не
   происходит, в консоли тишина».
2. **Воркеры платят за себя независимо от загрузки.** Открыли страницу,
   но никаких источников нет — coordinator-, indexer- и N parser-воркеров
   уже запущены. SQLite-WASM держит OPFS-лок, parser-воркеры висят с
   `recommendedPoolSize()` инстансами в memory.

Нужен явный контракт жизненного цикла каждой воркер-сущности.

## Considered Options

- **A. Lazy-spawn singletons + dynamic parser pool** — coordinator,
  indexer, handle-store создаются по первому RPC и живут до выгрузки
  страницы; parser-воркеры спавнятся on-demand до cap'а и убиваются по
  idle timeout. ViewStore сам — module-level singleton.
- **B. Eager singletons.** Spawn'имся при mount provider'а, но через
  module-singleton, чтобы StrictMode не дублировал. Платим за idle всё
  время сессии.
- **C. Per-mount instances + `destroy()` cleanup.** Лидеры устаревших
  React-туториалов. С StrictMode unmount/remount цикл уничтожает воркер
  до того, как новый mount его подхватит — race условие, которое мы и
  словили.
- **D. Worker-pool inversion.** Отказ от трёх отдельных воркеров в
  пользу единого «системного» воркера, который сам внутри запускает
  parser-задачи. Уменьшит handle-conflict'ы, но переписывает Phase 1-5.
  Out of scope.

## Decision Outcome

Выбрано **«A. Lazy-spawn singletons + dynamic parser pool»**.

Lifecycle инварианты:

| Сущность               | Жизненный цикл                                                                                                                                                                                           | Где                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **ViewStore**          | Module-level singleton. Создаётся при первом `getOrCreateViewStore()`, не destroy'ится.                                                                                                                  | [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts) `getOrCreateViewStore`  |
| **Coordinator worker** | Singleton **per ViewStore**. Spawn — при первом `api()` (т.е. первом RPC из main thread). Не убивается.                                                                                                  | log-client.ts `api()` getter                                                                     |
| **Indexer worker**     | Singleton **per coordinator**. Spawn — при первом `getIndexer()` внутри координатор-воркера. Не убивается.                                                                                               | [src/workers/coordinator/index.ts](../../src/workers/coordinator/index.ts) `getIndexer`          |
| **HandleStore (IDB)**  | Singleton, открывается через `HandleStore.open()` на init coordinator-воркера. Не закрывается явно.                                                                                                      | coordinator/index.ts                                                                             |
| **Parser-pool worker** | **Динамический.** Spawn — при `acquire()` если все занятые и pool < cap. Despawn — после `idleTtlMs` (30 s по умолчанию) простоя. Min size 0. Cap = `recommendedPoolSize()` (1–4 в зависимости от ядер). | [src/workers/coordinator/pool/parser-pool.ts](../../src/workers/coordinator/pool/parser-pool.ts) |

Почему так:

- **Coordinator/indexer — singleton'ы по smart-обоснованию.** OPFS
  SAH-pool VFS предполагает один writer; два indexer-инстанса ломают
  друг другу locks. Coordinator же держит state (sources Map, listeners)
  — двое сразу = противоречивая правда о том, что добавлено.
- **Lazy — в пользу cold UI.** Открытая страница без источников не
  должна занимать ни SAH-pool, ни 4 parser-воркера. Первый
  `addSource`/`getCount`/`subscribeStatus` запускает цепочку.
- **Parser pool — workload-bound, а не сессия-bound.** Между
  ingest-задачами parser-воркеры просто висят в memory без работы. Idle
  reaper их выкидывает после 30 s; если вторая задача приходит
  немедленно — реюзаем существующий слот. Cold-start parser-воркера
  ~tens of ms, заметно только при первой задаче после долгой паузы.

### Реализация

**Lazy ViewStore singleton** ([log-client.ts](../../src/worker-client/log-client.ts)):

```ts
let singletonStore: ViewStore | null = null;
export const getOrCreateViewStore = (): ViewStore => {
  if (singletonStore !== null) return singletonStore;
  singletonStore = createLogClient();
  return singletonStore;
};
```

[WorkerClientProvider](../../src/app/providers/WorkerClientProvider.tsx)
вызывает `getOrCreateViewStore()` через `useState`-initializer и **не**
делает destroy на unmount — иначе StrictMode unmount/remount уничтожит
worker pool до возвращения второго mount.

**Lazy coordinator worker** (внутри `createLogClient`):

```ts
let coordinatorApi: Comlink.Remote<CoordinatorApi> | null = null;
const api = (): Comlink.Remote<CoordinatorApi> => {
  if (coordinatorApi === null) {
    coordinatorWorker = new Worker(
      new URL('...coordinator/index.ts', import.meta.url),
      { type: 'module' },
    );
    coordinatorApi = Comlink.wrap<CoordinatorApi>(coordinatorWorker);
    armSubscriptions(coordinatorApi); // subscribeStatus + subscribeChanges + resumePersistedSources
  }
  return coordinatorApi;
};
```

Все ViewStore-actions используют `api()` вместо ранее-инлайн-построенного
`api`. Подписки и `resumePersistedSources` поднимаются в `armSubscriptions()`
exactly-once при первом RPC.

**Lazy indexer worker** ([coordinator/index.ts](../../src/workers/coordinator/index.ts)):

```ts
let indexerProxy: Comlink.Remote<IndexerApi> | null = null;
let indexerOpeningPromise: Promise<OpenReport> | null = null;
const getIndexer = () => {
  if (indexerProxy === null) {
    indexerWorker = new Worker(...);
    indexerProxy = Comlink.wrap<IndexerApi>(indexerWorker);
    indexerOpeningPromise = indexerProxy.open();
  }
  return { proxy: indexerProxy, opening: indexerOpeningPromise! };
};
```

Передаётся в [CoordinatorDeps.getIndexer](../../src/workers/coordinator/coordinator.ts)
вместо двух отдельных полей `indexer` + `indexerOpening`. Все 30+
обращений в coordinator.ts мигрировали на `deps.getIndexer().proxy.X` /
`.opening`.

**Dynamic parser pool** ([parser-pool.ts](../../src/workers/coordinator/pool/parser-pool.ts)):

- `withWorker(fn)` — единственный способ получить proxy. acquire+release
  через try/finally.
- Slots: `{worker, proxy, busy, lastUsedAt, reapTimer}`. Очередь FIFO для
  ожидания при cap-достигнут.
- `armReap` ставит `setTimeout(idleTtlMs)`; на reuse — `clearTimeout`.
  Idle reaper terminate'ит воркера и удаляет слот из pool.
- API `next()` (round-robin) удалён. [ingest-orchestrator](../../src/workers/coordinator/ingest/ingest-orchestrator.ts)
  переписан на `parserPool.withWorker(p => p.detectParser(sample))` /
  `.parse(...)`.

### Tests

[parser-pool.test.ts](../../src/workers/coordinator/pool/parser-pool.test.ts) — 6 кейсов с моком Comlink:

- Pool starts empty (no spawn on construction).
- First acquire spawns; second reuses idle slot.
- Concurrent acquires spawn до cap'а; busy-counter точен.
- Cap-достигнут → callers queue; release wakes them FIFO.
- Idle reaper terminate'ит worker после `idleTtlMs` (vi.useFakeTimers).
- Reuse before TTL отменяет reap; следующий релиз arms свежий timer.

Smoke в браузере: open page → нет worker-логов; click "+ Add source" →
модалка → folder pick → submit → coord+indexer спавнятся, parser pool
spawn'ит 1 worker для detectParser+parse, источник появляется в дереве,
все 3 entry проиндексированы. 0 ошибок в консоли.

### Consequences

- Good: open-and-do-nothing scenario не тратит ни OPFS SAH-pool лок, ни
  4 parser-воркеров. Cold UI остаётся cold.
- Good: StrictMode-двойной-spawn багу больше не случиться: factory
  `createLogClient` вызывается один раз module-singleton'ом, дубликаты
  возвращают тот же instance.
- Good: parser pool автоматически адаптируется к workload — между
  ingest'ами сжимается до 0, при пиковой нагрузке расширяется до
  `recommendedPoolSize()`.
- Bad: первая `+ Add source` теперь платит за coord cold-start (~tens of
  ms) и indexer SQLite open (~100 ms). На быстрых машинах незаметно.
- Bad: `coordinator.cancel(taskId)` ломает invariant'ы парсера если
  задача уже acquire'нула worker — abort пишется через signal, и
  `withWorker` всё равно проходит через finally. Edge-кейс: parser
  worker может остаться busy=true до завершения текущего `parse(...)`
  даже после abort. Это не проблема для текущего API, но если когда-то
  понадобится hard-cancel parse — нужно termin'ировать worker и
  переспавнить.
- Neutral: bundle размер не вырос. Code, наоборот, чуть меньше —
  отвалилась `recommendedPoolSize()` mass-spawn в конструкторе пула.

### Откат / эскалация

Если `idleTtlMs=30s` окажется неудобным — вынесем в setting (UI
Tweaks). Если spawn-cost окажется заметным — pre-warm 1 parser worker
сразу после первого RPC (но не на open page). Решения косметические,
без смены invariant'а.

## Links

- [ADR-0003](0003-worker-centric-topology.md) — оригинальный дизайн
  topology без явного lifecycle.
- [ADR-0007](0007-state-management-zustand.md) — ViewStore-контракт; ADR
  фиксирует module-singleton как имплементацию.
- React 19 StrictMode invariants — https://react.dev/reference/react/StrictMode
- File System Access OPFS-SAH-pool — https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool
