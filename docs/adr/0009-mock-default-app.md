# 0009. Mock-default app: переходное состояние UI без worker-привязки

- Status: proposed
- Date: 2026-05-03

## Context and Problem Statement

После декомпозиции Claude Design dump'а (см. [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md)) у нас два независимых стека UI:

1. Старый default — `src/App.tsx → src/app/AppShell.tsx → 3 контейнера (FilterBar/LogList/SourcePicker)`, прокинутые через `WorkerClientProvider` и хуки в реальный `coordinator-worker` (sqlite-wasm + parser pool, см. [ADR-0003](0003-worker-centric-topology.md), [ADR-0005](0005-sqlite-fts5-opfs-index.md), [ADR-0007](0007-state-management-zustand.md)).
2. Новый `LvApp` (~35 компонентов в `src/ui/components/<region>/`) — полностью props-driven, не подключён к хукам, потребляет данные из mock-фикстуры [src/dev/log-data-mock.ts](../../src/dev/log-data-mock.ts).

Пользователь решил: новый UI становится единственным дефолтом, старый удаляется. Дилемма:

- Оставить хуки/ядро/воркеры/worker-client как есть (без потребителя) — нарушение принципа «никакого dead code», но соблюдение headless-контракта ([ADR-0002](0002-headless-architecture.md)) под будущее переподключение.
- Удалить и слой headless-контракта целиком — UI лишается даже потенциальной опоры на ядро; следующая итерация wiring'а потребует восстановления из git.

## Considered Options

- **A. Удалить только UI-обвязку (`src/App.tsx`, `src/app/`, старые dump-компоненты), оставить headless-слой.** Прод-сборка временно показывает UI-демо на mock-данных; ядро/воркеры/хуки/worker-client скомпилированы, но не имеют потребителя в main thread. Юнит-тесты в `src/core/` и `src/workers/` остаются зелёными — они не зависят от UI.
- **B. Удалить всё, включая headless-слой.** Радикально — фактически возврат к чистому статическому демо. Чтобы вернуться к рабочему лог-вьюверу, нужно восстановить из git и заново подключать.
- **C. Оставить `?preview=lv`-гейт, держать оба стека параллельно.** Не делаем — пользователь явно попросил один дефолт.
- **D. Прямо сейчас написать недостающие хуки (`useTabs`, `useGroupBy`, `useBookmarks`, `useTweaks`, `useTreeSelection`) и завести `LvApp` на реальный ViewStore.** По размеру это отдельная итерация, в текущем плане out-of-scope.

## Decision Outcome

Chosen option: **«A. Удалить UI-обвязку, оставить headless-слой».**

Обоснование: headless-контракт уже стабилизирован (return-типы хуков, протоколы worker-client, ADR-0007 для ViewStore), и переподключение `LvApp` к нему — известная задача, которой назначен отдельный план. Удалить ядро ради сиюминутной чистоты — потерять амортизацию работы по [ADR-0003..0007](0003-worker-centric-topology.md). Принятые потери от A — компиляция «висящих» экспортов и временно нерелевантный bundle-вес — приемлемы и обратимы.

### Что удалено

- `src/App.tsx` — рендерил `<AppShell/>`, переписан под `<LvApp/>` + mock.
- `src/app/AppShell.tsx`, `src/app/containers/{FilterBarContainer,LogListContainer,SourcePickerContainer}.tsx`, `src/app/providers/{WorkerClientProvider,view-store-context}.{ts,tsx}` — целиком, каталог `src/app/` исчез.
- `src/ui/components/{FilterBar,LogList,SourcePicker}.tsx` — старые dump-компоненты, заменены `Lv*` версиями в подкаталогах `src/ui/components/<region>/`.
- `src/App.css` — был осиротевшим со времён vite-template'а.
- `src/main.tsx` — потерял `?preview=lv`-гейт; единственный entry — `<App/>`.

### Что сохранено

- `src/core/`, `src/workers/`, `src/worker-client/`, `src/hooks/`, `src/types/` — headless-контракт под будущую перепривязку. Юнит-тесты в `src/core/parsers/`, `src/core/sources/`, `src/core/filter/`, `src/workers/indexer/db/` продолжают исполняться через `pnpm test`.
- `src/dev/log-data-mock.ts` — данные приложения. В текущем состоянии это product-runtime fixture, в будущем (после wiring'а) снова станет dev-only mock'ом для `LvApp`-storybook'а.
- `src/ui/log-monaco.jsx` — отложено до отдельного ADR Monaco-интеграции.

### Consequences

- Good: один дефолтный путь, никакого `?preview` гейта; проще онбординг, проще skills/cron агентам ориентироваться.
- Good: дефолт стабильно стартует из mock-фикстуры — ничего не падает, если worker-pipeline дрогнет.
- Good: headless-слой остаётся валидным контрактом, готовым принять `LvApp` в следующей итерации.
- Bad: прод-сборка отдаёт UI-демо. Любой пользователь, открывший live-сайт, видит mock'и, не свои логи. До реальной wiring-итерации это нужно явно коммуницировать в `README.md` или баннером в UI (вне scope этого ADR).
- Bad: bundle всё ещё включает sqlite-wasm и worker-код. Tree-shaking их не выкидывает, потому что `worker-client/log-client.ts` импортируется… wait — он больше **не** импортируется. Vite tree-shake'ит TS-модули, но воркеры подгружаются через `new Worker(new URL('...', import.meta.url))` — без вызова из main кода эти URL'ы не резолвятся. Реально bundle уменьшится: смотри размеры в `pnpm build` после ADR.
- Neutral: `pnpm test` остаётся зелёным — тесты в `core/`/`workers/` независимы от UI.

### План возврата к рабочему лог-вьюверу

1. Написать недостающие UI-хуки (`useTabs`, `useGroupBy`, `useBookmarks`, `useTreeSelection`, `useTweaks`) поверх существующего ViewStore — отдельный ADR в духе [ADR-0007](0007-state-management-zustand.md).
2. Создать `src/app/containers/LvAppContainer.tsx`, который собирает `LvApp` props из этих хуков плюс `useLogWindow`/`useLogFilter`/`useSelectedEntry`/`useSourceController`/`useSourceStatus`.
3. Переключить `src/App.tsx` на `<LvAppContainer/>`, удалить `src/dev/log-data-mock.ts`.
4. Согласовать уровни логов (5 в дизайне vs 7 в core, см. [docs/plans/replicated-cooking-muffin.md §7](../plans/replicated-cooking-muffin.md)).

## Links

- [docs/adr/0002-headless-architecture.md](0002-headless-architecture.md) — контракт слоёв, под который шла декомпозиция.
- [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md) — план декомпозиции, §7 «Out of scope».
- [docs/adr/0007-state-management-zustand.md](0007-state-management-zustand.md) — ViewStore, к которому LvApp будет подключён.
