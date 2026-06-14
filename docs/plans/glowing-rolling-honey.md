# Persist UI workspace across reloads

## Context

Сейчас при перезагрузке страницы пользователь теряет всё, что нажимал и набирал в текущей сессии:

- открытые табы и активный таб ([LvAppContainer.tsx:94](src/app/containers/LvAppContainer.tsx#L94), [LvAppContainer.tsx:99](src/app/containers/LvAppContainer.tsx#L99));
- чекбоксы выделенных файлов в сайдбаре ([LvAppContainer.tsx:93](src/app/containers/LvAppContainer.tsx#L93));
- введённый фильтр со всеми атрибутами (query, levels, fieldFilters, timeRange, queryMode, caseSensitive, wholeWord) ([LvAppContainer.tsx:78](src/app/containers/LvAppContainer.tsx#L78));
- активный group-by и live-tail режим ([LvAppContainer.tsx:100-101](src/app/containers/LvAppContainer.tsx#L100));

Сами источники (SQLite + IndexedDB handles) переживают reload, и UI-tweaks (`lv:ui-prefs`), bookmarks, saved-searches, recent-files уже сидят за `persist`-middleware. Не хватает только перечисленного выше — это «рабочее место» пользователя.

Цель: завести один persisted store `lv:workspace`, который покрывает шесть полей выше, и подключить его к контейнеру вместо текущих `useState`. Без export/import, без per-source customization, без scroll position — это отдельные планы.

## Подход

Один zustand-store с `persist`-middleware (как [useBookmarks](src/hooks/use-bookmarks.ts), [useSavedSearches](src/hooks/use-saved-searches.ts), [useUiPrefs](src/hooks/use-ui-prefs.ts)). Ключ `lv:workspace`, версия `1`. `Set<string>` для `selectedIds` сериализуется через `partialize` в массив, гидрируется обратно в `Set` через `merge` (тот же паттерн что в [use-bookmarks.ts:46-49](src/hooks/use-bookmarks.ts#L46-L49)). Setters живут внутри store со стабильными ссылками — берутся из него селекторами без `useCallback` в контейнере.

### Контракт hook'а

```ts
// src/hooks/use-workspace.ts
interface WorkspacePersistedV1 {
  readonly version: 1;
  readonly openTabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string; // '__all__' если ничего/невалидно
  readonly selectedIds: ReadonlyArray<string>;
  readonly coreFilter: LogFilter; // sources/filePaths всегда null (derived)
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  readonly liveTail: boolean;
}

export interface UseWorkspace {
  readonly openTabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string;
  readonly selectedIds: ReadonlySet<string>;
  readonly coreFilter: LogFilter;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  readonly liveTail: boolean;
  /** False до завершения `persist().onFinishHydration` — нужен, чтобы не чистить
   *  табы/selection до того, как восстановится state из localStorage. */
  readonly hydrated: boolean;

  setOpenTabs(
    updater: (prev: ReadonlyArray<LvTab>) => ReadonlyArray<LvTab>,
  ): void;
  setActiveTabId(id: string): void;
  setSelectedIds(updater: (prev: Set<string>) => Set<string>): void; // сигнатура совместима с LvAppContainer.tsx:103
  setCoreFilter(updater: (prev: LogFilter) => LogFilter): void;
  setGroupBy(next: ReadonlyArray<LvGroupBy>): void;
  setLiveTail(v: boolean): void;
  /** Одной операцией: убрать source-id + все его компаунд-варианты (`<sid>::<path>`)
   *  из `selectedIds` и `openTabs`; сбросить `activeTabId` на `'__all__'`,
   *  если активный таб лежал на удалённом source. */
  removeSource(sourceId: string): void;
  /** Пройти `selectedIds`/`openTabs`, выкинуть всё, чей базовый source-id не в
   *  `liveSourceIds`. Вызывается ровно один раз после `sourcesHydrated && hydrated`. */
  pruneMissingSources(liveSourceIds: ReadonlySet<string>): void;
}
```

### Storage

```ts
persist(creator, {
  name: 'lv:workspace',
  version: 1,
  partialize: (s) => ({
    version: 1,
    openTabs: s.openTabs,
    activeTabId: s.activeTabId,
    selectedIds: [...s.selectedIds],
    coreFilter: { ...s.coreFilter, sources: null, filePaths: null },
    groupBy: s.groupBy,
    liveTail: s.liveTail,
  }),
  merge: (persisted, current) => {
    const p = persisted as Partial<WorkspacePersistedV1> | undefined;
    if (!p) return current;
    return {
      ...current,
      openTabs: p.openTabs ?? [],
      activeTabId: p.activeTabId ?? '__all__',
      selectedIds: new Set(p.selectedIds ?? []),
      coreFilter: {
        ...EMPTY_FILTER,
        ...p.coreFilter,
        sources: null,
        filePaths: null,
      },
      groupBy: p.groupBy ?? [],
      liveTail: p.liveTail ?? false,
    };
  },
  migrate: (state) => state, // stub под будущие миграции
});
```

`hydrated` ставится через `useWorkspaceStore.persist.onFinishHydration` — отдельный флаг в state, мигрирует в `true` при первом `onFinishHydration`. Если localStorage пуст или JSON битый, `merge(undefined, current)` отдаст дефолты, и `hydrated` всё равно станет `true`.

### Anti-staleness и hydration race

Существующий reset активного таба ([LvAppContainer.tsx:491-499](src/app/containers/LvAppContainer.tsx#L491-L499)) и фильтр ghost-табов ([LvAppContainer.tsx:478-489](src/app/containers/LvAppContainer.tsx#L478-L489)) срабатывают сразу как только `filesById` пуст (а это первый render). На холодном reload с восстановленным `activeTabId='abc::file.log'` это бы убило таб ещё до того, как `subscribeStatus` вторым emit'ом донёс sources.

Решение: гейтить любое сужение `tabs` и любой reset `activeTabId` через `canPrune = sourcesHydrated && workspace.hydrated`:

```ts
const tabs = useMemo<LvTab[]>(() => {
  const t: LvTab[] = [{ id: '__all__', ... }];
  for (const tab of ws.openTabs) {
    if (!canPrune) { t.push(tab); continue; }  // покажем как есть, пока всё не прогрузилось
    const sep = tab.id.indexOf('::');
    const baseSrc = sep === -1 ? tab.id : tab.id.slice(0, sep);
    if (filesById[baseSrc]) t.push(tab);
  }
  return t;
}, [ws.openTabs, ws.selectedIds, filesById, canPrune]);

// ...
if (canPrune && tabSig !== prevTabSig) { ... }  // existing reset logic
```

Одноразовая prune-проходка `selectedIds`/`openTabs` после обеих hydration делается в `useEffect` с ref-гейтом:

```ts
const prunedRef = useRef(false);
useEffect(() => {
  if (prunedRef.current || !sourcesHydrated || !ws.hydrated) return;
  prunedRef.current = true;
  ws.pruneMissingSources(new Set(sources.map((r) => r.source.id)));
}, [sourcesHydrated, ws.hydrated, sources, ws]);
```

`permission-required` и `error` источники остаются в `sources`, так что табы и selection на них переживают prune — пользователь в viewer'е увидит баннер «Grant access» и реабилитирует.

### Removal cleanup

Сейчас [LvAppContainer.tsx:719-738](src/app/containers/LvAppContainer.tsx#L719-L738) сам вычищает `selectedIds` префиксом при удалении источника. После миграции это становится `ws.removeSource(rootId)` — store знает про оба места (`selectedIds` + `openTabs`) и заодно роняет `activeTabId` на `'__all__'`, если активный таб ушёл:

```ts
const onRemoveRoot = useCallback(
  (rootId: string) => {
    void sourceCtrl.removeSource(rootId as SourceId);
    ws.removeSource(rootId);
  },
  [sourceCtrl, ws],
);
```

## Файлы

| Файл                                                                                   | Что                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/hooks/use-workspace.ts](src/hooks/use-workspace.ts)                               | NEW. Store + `useWorkspace` hook. Использовать паттерн set-from-store как в [use-bookmarks.ts](src/hooks/use-bookmarks.ts).                                                                                                                                                                                                                                             |
| [src/hooks/index.ts](src/hooks/index.ts)                                               | Re-export `useWorkspace`, тип `UseWorkspace`.                                                                                                                                                                                                                                                                                                                           |
| [src/app/containers/LvAppContainer.tsx](src/app/containers/LvAppContainer.tsx)         | Удалить шесть `useState` ([:78,93,99,100,101](src/app/containers/LvAppContainer.tsx#L78)). Удалить локальный `setSelectedIds` useCallback ([:103-108](src/app/containers/LvAppContainer.tsx#L103-L108)) — теперь setter из store. Гейтить `tabs` useMemo и reset `activeTabId` через `canPrune`. Добавить prune-effect. `onRemoveRoot` свести к `ws.removeSource(...)`. |
| [src/app/clear-app-data.ts](src/app/clear-app-data.ts)                                 | Дописать `'lv:workspace'` в `UI_STATE_LOCAL_STORAGE_KEYS` ([:20-26](src/app/clear-app-data.ts#L20)).                                                                                                                                                                                                                                                                    |
| [src/hooks/**tests**/use-workspace.test.ts](src/hooks/__tests__/use-workspace.test.ts) | NEW. Юнит-тесты на сериализацию/гидрацию/prune (см. ниже).                                                                                                                                                                                                                                                                                                              |
| [docs/adr/NNNN-persist-ui-workspace.md](docs/adr/)                                     | NEW. ADR через `/adr` — фиксирует выбор localStorage, `Set→Array` сериализация, hydration-gating и контракт `removeSource`/`pruneMissingSources`.                                                                                                                                                                                                                       |

Никаких изменений в воркерах, контрактах RPC, индексере и сорс-адаптерах: всё чисто UI-side.

## Out of scope

- Export/Import workspace в JSON.
- Per-source customization (alias, accent, fileOverrides) — отдельный план.
- Scroll position, expand/collapse директорий в дереве, expanded-detail строки.
- Cross-tab синхронизация (через `BroadcastChannel`) — пока last-writer-wins на уровне localStorage.
- Миграции версий — `version: 1` baseline, `migrate` пустой stub.

## Verification

**Unit (`use-workspace.test.ts`, через `pnpm test --run`):**

- `partialize` стрипит `sources`/`filePaths` в `null`, конвертит Set→массив (сортированно для детерминизма теста).
- `merge` восстанавливает Set, дозаполняет дефолтами при отсутствующих полях (forward-compat).
- `merge` поверх битого/пустого localStorage не кидает, отдаёт initial defaults.
- `removeSource(sid)` чистит plain id и компаундные `<sid>::<path>` из `selectedIds` и `openTabs`; если `activeTabId` начинался с `sid` или `${sid}::`, оно становится `'__all__'`.
- `pruneMissingSources(liveSet)` оставляет только записи, чей базовый source-id ∈ liveSet; не трогает `'__all__'`.
- `setCoreFilter(prev => ...)` отдаёт updater'у текущий фильтр, записывает обратно с `sources/filePaths: null`.

**End-to-end (Playwright, `pnpm dev` уже запущен на 5183):**

1. Загрузить два source'а через `pnpm gen:fixtures` → `pino.jsonl` + `bunyan.jsonl` (или OPFS-папку из существующего теста).
2. Открыть `pino.jsonl` как таб, выставить чекбоксы на обоих, ввести `query="error"`, поднять level filter, переключить group-by на `level`, включить live-tail.
3. Снапшот `localStorage['lv:workspace']` через `browser_evaluate` — проверить структуру (`Set` → массив, фильтр без `sources`).
4. `location.reload()`, дождаться `ws.hydrated && sourcesHydrated` через `browser_evaluate(() => window.__lvStore?.getState()?.sourcesHydrated)` (debug-hook на время теста).
5. Assert: чекбоксы 2/2, активный таб = `pino.jsonl`, query в filter-баре `error`, group-by chip `level`, live-tail кнопка «on».
6. Удалить `pino.jsonl` → таб исчезает, `activeTabId = '__all__'`, чекбокс на нём пропадает, в localStorage больше нет ссылок на этот source. Reload подтверждает.
7. Вручную записать битый JSON `localStorage.setItem('lv:workspace', '{"selectedIds":42}')` → reload → приложение поднимается с дефолтами, никаких uncaught errors в console.

**Smoke:** `pnpm lint`, `pnpm exec tsc -b`, `pnpm build` — зелёные.

Скриншоты до/после ключевых шагов сохранять в [.tmp/screenshots/](.tmp/screenshots/) согласно [CLAUDE.md](CLAUDE.md#L60).
