# Чекбокс на каталог + фикс «Select all»

## Context

Две связанные задачи в sidebar:

1. **Баг «Select all».** Кнопка не выбирает файлы внутри директорий-источников. Источник: [LvSidebar.tsx:73](../../src/ui/components/sidebar/LvSidebar.tsx#L73) — `setSelectedIds(() => new Set(Object.keys(filesById)))`, а `filesById` (из [build-catalog.ts:193-199](../../src/ui/utils/build-catalog.ts#L193-L199)) — это **flat-карта top-level sources** (`rec.source.id → LvFileNode`), куда **не попадают** файлы внутри `DirectoryLogSource`. Реальные file id'шки в дереве — compound `<sourceId>::<relPath>` (см. [LvTreeNode.tsx:33-36](../../src/ui/components/sidebar/LvTreeNode.tsx#L33-L36) `collectFileIds`). Тот же баг в счётчике toolbar'а `{selectedIds.size}/{Object.keys(filesById).length}` ([LvSidebar.tsx:140-142](../../src/ui/components/sidebar/LvSidebar.tsx#L140-L142)) — знаменатель занижен.

2. **Чекбокс на folder-узел.** Сейчас на папках вместо чекбокса — декоративный индикатор `●`/`◐` ([LvTreeNode.tsx:126-130](../../src/ui/components/sidebar/LvTreeNode.tsx#L126-L130)), без клика. На файлах — кликабельный `lv-tree-check` ([LvTreeNode.tsx:207-229](../../src/ui/components/sidebar/LvTreeNode.tsx#L207-L229)). Нужно превратить декоративный индикатор в полноценный tristate-чекбокс: all/some/none, клик выбирает или снимает всех потомков-файлов.

Обе задачи требуют одной функции «собрать все file id'шки из catalog tree», которая уже существует как локальный helper в LvTreeNode.

## Approach

### 1. Утилита `collectAllFileIds`

В [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts) добавить:

```ts
export const collectAllFileIds = (nodes: ReadonlyArray<LvNode>): string[] => {
  /* DFS, push node.id if type==='file', else recurse children */
};
```

Текущий локальный `collectFileIds` в LvTreeNode останется (он принимает один узел и accumulator), но мы переименуем его или импортируем новую обёртку — пусть LvTreeNode тоже использует утилиту, чтобы исключить расхождение логики.

### 2. Фикс Select all и счётчика

В [LvSidebar.tsx](../../src/ui/components/sidebar/LvSidebar.tsx):

- Удалить prop `filesById` (его больше негде в `LvSidebar` использовать — после фикса toolbar'а и selectAll). Если он используется внешним consumer'ом для других целей — оставить, но **не** использовать его для select-all. Проверю через grep перед удалением; скорее всего сейчас он используется только в Sidebar.
- Импортировать `collectAllFileIds`.
- `const allFileIds = useMemo(() => collectAllFileIds(catalog), [catalog]);` — мемо по catalog.
- `selectAll = () => setSelectedIds(() => new Set(allFileIds));`
- Счётчик: `{selectedIds.size}/{allFileIds.length}`.

Прим. **filesById НЕ удаляем из props** — он ещё используется в [LvAppContainer.tsx:371](../../src/app/containers/LvAppContainer.tsx#L371), [534](../../src/app/containers/LvAppContainer.tsx#L534), [569](../../src/app/containers/LvAppContainer.tsx#L569) для tab-open lookup, и проход через LvSidebar там не идёт — это отдельная переменная в контейнере. Внутри LvSidebar prop `filesById` можно убрать. Проверю grep'ом по `<LvSidebar` перед правкой.

### 3. Кликабельный folder-checkbox в LvTreeNode

В [LvTreeNode.tsx](../../src/ui/components/sidebar/LvTreeNode.tsx):

- Заменить `collectFileIds` local helper на импорт `collectAllFileIds([node])` (единая утилита).
- На месте декоративного `lv-tree-pick` ([line 126-130](../../src/ui/components/sidebar/LvTreeNode.tsx#L126-L130)) рендерить тот же `lv-tree-check`-checkbox, что и для файлов, но в трёх состояниях: `all` (✓), `some` (─ indeterminate), `none` (пусто).
- Новый prop `toggleFolderSelect: (fileIds: ReadonlyArray<string>, shouldSelect: boolean) => void` — родитель решает, что делать.
- Обработчик клика: `e.stopPropagation()`, потом `toggleFolderSelect(descendants, folderState !== 'all')` — конвенция Gmail/VSCode: indeterminate click → select all, all click → clear.

### 4. Передача `toggleFolderSelect` из LvSidebar

В LvSidebar:

```ts
const toggleFolderSelect = (fileIds, shouldSelect) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (shouldSelect) fileIds.forEach((id) => next.add(id));
    else fileIds.forEach((id) => next.delete(id));
    return next;
  });
};
```

Пробросить в `<LvTreeNode ... toggleFolderSelect={toggleFolderSelect}>` и рекурсивно во вложенные `LvTreeNode`.

### 5. Стили indeterminate-checkbox

В sidebar CSS (вероятно [src/ui/styles/lv.css](../../src/ui/styles/lv.css), но grep'нуть `.lv-tree-check`):

- Добавить вариант `.lv-tree-check.is-indeterminate` — рендерим горизонтальную полоску (─) либо SVG `<line>` вместо галочки. По дизайну: тот же accent-цвет, что и `is-on`.
- Декоративные классы `.lv-tree-pick`, `.lv-tree-pick-all`, `.lv-tree-pick-some` — **больше не используются** в JSX, удалить из CSS если не ссылаются ниоткуда (grep подтвердит).

### 6. Тесты

В [src/ui/utils/build-catalog.test.ts](../../src/ui/utils/build-catalog.test.ts) добавить новую describe-секцию `collectAllFileIds`:

- Empty catalog → `[]`.
- Flat source (file kind) → `[sourceId]`.
- Directory с 2 файлами внутри → `[<sourceId>::file1, <sourceId>::file2]`.
- Смешанный catalog (flat + directory) → union из обоих, порядок сохраняется по DFS.

UI-component тестов не пишем — vitest config `include: ['src/**/*.{test,spec}.ts']` (не `.tsx`) и нет jsdom. Tristate-checkbox-логика проверяется вручную.

## Verification

1. `pnpm test src/ui/utils/build-catalog.test.ts` — новые кейсы зелёные.
2. `pnpm test` — все 309+ тестов проходят.
3. `pnpm lint` — без новых ошибок.
4. `pnpm build` — OK.
5. Manual smoke на dev-сервере `pnpm dev`:
   - `pnpm gen:fixtures` → drag-drop папку `.tmp/` в sidebar (директорию с pino.jsonl, app.log и др.).
   - Папка раскроется, файлы внутри видимы.
   - Клик «Select all» в toolbar'е → все файлы под директорией и flat-источники получают галочку. Toolbar counter показывает `N/N`.
   - Клик «Clear» → все галочки сняты, `0/N`.
   - Выбрать вручную 1 файл внутри директории → на папке `is-indeterminate` checkbox (─), у корня директории тоже indeterminate. На самом флажке папки кликнуть — все файлы выбраны (`✓` checkbox).
   - Кликнуть ещё раз на папке — все сняты.
   - Выбрать вручную все файлы внутри папки → папка автоматически `is-on` (✓).
6. Verify в Sources Filter: `selectedIds` корректно становится `{<sourceId>::file1, <sourceId>::file2, ...}`, `splitSelection` ([LvAppContainer.tsx:121-146](../../src/app/containers/LvAppContainer.tsx#L121-L146)) корректно разбирает на `filePaths`, лог-стрим в правой панели отфильтрован по выбранным файлам.

## Critical Files

- [src/ui/utils/build-catalog.ts](../../src/ui/utils/build-catalog.ts) — добавить `collectAllFileIds`.
- [src/ui/utils/build-catalog.test.ts](../../src/ui/utils/build-catalog.test.ts) — тесты на утилиту.
- [src/ui/components/sidebar/LvSidebar.tsx](../../src/ui/components/sidebar/LvSidebar.tsx) — фикс `selectAll` + счётчик + проброс `toggleFolderSelect`.
- [src/ui/components/sidebar/LvTreeNode.tsx](../../src/ui/components/sidebar/LvTreeNode.tsx) — заменить декоративный индикатор на кликабельный tristate-checkbox; вынести `collectFileIds` в утилиту.
- [src/ui/styles/lv.css](../../src/ui/styles/lv.css) — стиль `.lv-tree-check.is-indeterminate`; cleanup `.lv-tree-pick*`.
