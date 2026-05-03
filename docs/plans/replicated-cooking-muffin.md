# Add-source: модалка вместо `prompt`-цепочки (scope: local folder)

## Context

Сейчас «+ Add source» в [LvSidebar](../../src/ui/components/sidebar/LvSidebar.tsx) открывает popover-меню [LvAddSourceMenu](../../src/ui/components/sidebar/LvAddSourceMenu.tsx) с 9 типами; клик по элементу делает «split» вызов в [LvAppContainer.onAddRoot](../../src/app/containers/LvAppContainer.tsx) → серия `window.prompt` для каждого поля (host, broker, query…) или сразу нативный picker. Это:

- ломает UX (модальные окна браузера, нельзя отменить/исправить введённое значение, нет валидации, нет defaults);
- даёт неоднородный flow (для directory — picker без расспроса, для остальных — prompt'ы);
- не позволяет настроить «дополнительные поля» одного источника (glob, watch, name override).

Пользователь хочет единое модальное окно с формой:
- тип ресурса,
- наименование (default — путь/имя каталога),
- путь к каталогу (через FSA picker),
- переключатель «следить за изменениями»,
- доп. поля (для directory — `glob`).

**Текущий scope:** только local folder (static + live). Остальные kind'ы (snapshot, stream, ssh, cloud, k8s, bus, db) — продолжают идти через существующий prompt-flow и trogают этот план только косвенно (модалка должна быть готова к расширению, но не реализует их). 

## Recommended approach

### 1. Расширить core под `watch`-флаг

[src/core/types/log-source.ts](../../src/core/types/log-source.ts):

- `DirectoryLogSource` + соответствующий `LogSourceInput`-вариант получают опциональное `watch?: boolean` рядом с `glob?: string`.
- Адаптер [createDirectoryAdapter](../../src/core/sources/directory-adapter.ts) сейчас не делает live-tail — флаг записывается, но пока что не влияет на ingest. Это согласовано с [плана Phase 4](../adr/0006-persistence-strategy.md): полноценный watcher живёт в отдельном ADR. Здесь мы фиксируем намерение в shape данных, чтобы UI и дерево источников (Watched folders vs Local files) корректно различали два варианта.

[src/workers/coordinator/coordinator.ts:40-51](../../src/workers/coordinator/coordinator.ts#L40-L51) (`buildLogSource`) — пробрасываем `watch`.

[src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) (`serializeSourceMeta` для `directory`) — добавляем `watch` в JSON метаданных, чтобы `placeholderFromIndexed` после reload'а знал, в какую секцию дерева положить.

### 2. Сделать `addDirectory` параметризуемой

[src/worker-client/log-client.ts](../../src/worker-client/log-client.ts) — текущая сигнатура `addDirectory(): Promise<SourceId | null>` сама поднимает picker. Меняем на:

```ts
addDirectory: (opts?: {
  handle?: FileSystemDirectoryHandle;
  name?: string;
  watch?: boolean;
  glob?: string;
}) => Promise<SourceId | null>;
```

- `opts.handle` отсутствует → показываем picker (текущее поведение, для backwards-compat и для File-меню «Open Folder…»).
- `opts.handle` передан → используем его напрямую (новая ветка для модалки).

[src/hooks/use-source-controller.ts](../../src/hooks/use-source-controller.ts) — синхронизируем сигнатуру.

### 3. Новый компонент `LvAddSourceModal`

`src/ui/components/sidebar/LvAddSourceModal.tsx` — UI-only, props-driven:

```ts
interface LvAddSourceModalProps {
  readonly open: boolean;
  /** Initial source kind (currently only 'local-folder' supported). */
  readonly kind: 'local-folder';
  onClose: () => void;
  onSubmit: (data: {
    handle: FileSystemDirectoryHandle;
    name: string;
    watch: boolean;
    glob: string | null;
  }) => void;
}
```

Layout (по дизайну, монохром, под существующий стиль `lv-modal`):

```
┌── Add log source ───────────────────── ✕ ──┐
│                                            │
│  Type     [Local folder ▾]                 │  // single-option select (locked); placeholder for future kinds
│                                            │
│  Folder   [ Choose folder… ]   <name>      │  // FSA picker; shows handle.name when chosen
│                                            │
│  Name     [_______________________________]│  // default = handle.name; editable
│                                            │
│  ☐ Watch for changes                       │  // toggle → DirectoryLogSource.watch
│                                            │
│  Glob     [_______________________________]│  // optional, placeholder "*.log"
│                                            │
│                          [Cancel] [Add]    │
└────────────────────────────────────────────┘
```

Поведение:

- При open=true рендерится поверх (re-use паттерна `LvShortcutsModal`/`LvCommandPalette`: backdrop + центрированный диалог, Esc и клик по backdrop = Cancel).
- «Choose folder…» вызывает `window.showDirectoryPicker({ mode: 'read' })`; на success — заполняет handle, и `name` автоматически становится `handle.name` если пользователь его ещё не правил.
- Кнопка «Add» disabled пока `handle === null`.
- Submit вызывает `onSubmit({ handle, name, watch, glob: glob.trim() || null })`. Модалка не делает RPC сама — это делает контейнер.

CSS — в `src/ui/styles/lv.css`, классы `lv-modal-backdrop`, `lv-modal`, `lv-form-row`, `lv-form-label`, `lv-form-input`, `lv-form-toggle` (часть уже есть из `LvSettingsPopover`/`LvShortcutsModal` — переиспользуем).

### 4. Подключить модалку к LvApp + контейнер

[src/ui/components/layout/LvApp.tsx](../../src/ui/components/layout/LvApp.tsx) — держит `addSourceModal: { open: boolean; kind: 'local-folder' } | null` в локальном state (по аналогии с `cmdOpen`, `settingsOpen`). Открытие триггерит `runCommand('open-add-source')` или прямо из обработчика клика по «+ Add source».

LvAddSourceMenu клик — сегодня вызывает `onAddRoot(kind)`. Поведение перепрошиваем в LvApp:
- Для `kind ∈ {'local-static', 'local-live'}` — открываем модалку (с предвыбранным watch-флагом: `local-static` → false, `local-live` → true).
- Для остальных kind'ов — пропускаем дальше в `onAddRoot` (старый prompt-flow остаётся как был).

В `LvSidebar` основная кнопка «+ Add source» (split-button main click) сейчас сразу вызывает `pick('local-static')`. После изменения — открывает модалку (через тот же путь).

[LvAppContainer.onAddRoot](../../src/app/containers/LvAppContainer.tsx) — для `local-static`/`local-live` остаётся пустой default (модалка делает submit, контейнер ловит через новый callback `onSubmitAddSource`):

```ts
const onSubmitAddSource = useCallback(
  async (data: { handle, name, watch, glob }) => {
    await sourceCtrl.addDirectory({
      handle: data.handle,
      name: data.name,
      watch: data.watch,
      glob: data.glob ?? undefined,
    });
  },
  [sourceCtrl],
);
```

### 5. Дерево источников: `local-live` ↔ `directory.watch`

[src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts) — `CORE_TO_LV` сейчас маппит `directory → 'local-static'` для всех. Меняем на функцию:

```ts
const lvKindOf = (source: LogSource): LvSourceKind => {
  if (source.kind === 'directory' && source.watch) return 'local-live';
  return CORE_TO_LV[source.kind];
};
```

После reload'а `placeholderFromIndexed` восстанавливает source из metaJson — туда и приедет `watch`.

### 6. Тесты

- `build-catalog.test.ts` — добавить кейс «directory with `watch:true` лежит в `Watched folders`-корне».
- `LvAddSourceModal.test.tsx` (новый, vitest + @testing-library) — тест на open/close, default name = handle.name, disabled до выбора folder, submit-payload форма. FSA picker — мокаем глобально.
- Smoke в браузере: клик «+ Add source» открывает модалку; «Choose folder…» открывает picker; sample-папка добавляется и индексируется; повторное открытие через Watched folders работает.

## Critical files

**Modify:**
- [src/core/types/log-source.ts](../../src/core/types/log-source.ts) — `watch?: boolean` в DirectoryLogSource + DirectoryLogSourceInput.
- [src/workers/coordinator/coordinator.ts](../../src/workers/coordinator/coordinator.ts) — пробросить watch в `buildLogSource` и `placeholderFromIndexed`.
- [src/workers/indexer/indexer-api.ts](../../src/workers/indexer/indexer-api.ts) — `watch` в `serializeSourceMeta`.
- [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts) — расширенный `addDirectory(opts?)`.
- [src/hooks/use-source-controller.ts](../../src/hooks/use-source-controller.ts) — sync signature.
- [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts) — `lvKindOf` с веткой `directory.watch`.
- [src/ui/utils/build-catalog.test.ts](../../src/ui/utils/build-catalog.test.ts) — кейс watch.
- [src/ui/components/sidebar/LvSidebar.tsx](../../src/ui/components/sidebar/LvSidebar.tsx) — onAddRoot перенаправляет local-* в модалку.
- [src/ui/components/layout/LvApp.tsx](../../src/ui/components/layout/LvApp.tsx) — state модалки + render.
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — onSubmitAddSource callback.
- [src/ui/styles/lv.css](../../src/ui/styles/lv.css) — стили формы.

**Create:**
- `src/ui/components/sidebar/LvAddSourceModal.tsx`.
- `src/ui/components/sidebar/LvAddSourceModal.test.tsx`.

**Out of scope (отложено отдельным ADR/планом):**
- Реальный watcher для `directory.watch` (полный live-tail на изменения файлов в каталоге).
- Перевод остальных source-kinds (snapshot, stream, ssh, cloud, k8s, bus, db) на эту модалку — модалка спроектирована расширяемой, но реализуется только local-folder сейчас.
- ADR на `watch`-семантику адаптера — опционально, если поведение разъедется со static-веткой; в текущей итерации флаг хранится без эффекта на ingest.

## Verification

1. `npx tsc -b`, `pnpm lint`, `pnpm test --run` — все зелёные (новый модал-тест + обновлённый build-catalog тест).
2. `pnpm build` — bundle растёт незначительно (новый компонент ~3-4 KiB gz).
3. Browser smoke (Playwright):
   - открыть `/`, кликнуть «+ Add source» → модалка открыта.
   - кликнуть «Choose folder…» → нативный FSA picker (моком в тесте; вручную — выбрать `public/`).
   - после выбора имя автозаполняется, кнопка «Add» становится active.
   - Submit → каталог появляется в дереве под «Local files».
   - Повторно: тот же flow с галочкой «Watch for changes» → каталог попадает под «Watched folders», `directory.watch === true`.
   - 0 console errors.
