# Импорт и экспорт фильтров

## Context

`LogFilter` сейчас живёт в браузерной памяти (zustand stores `lv:saved-searches`, текущий `coreFilter` в контейнере). Поделиться набором сложных условий с коллегой можно только через скриншот формы или вручную пересоздать. Между устройствами того же пользователя — нет переноса (только если он явно бэкапит LocalStorage).

Цель: добавить импорт/экспорт фильтров и сохранённых поисков в виде JSON-файла. Открыл — получил всё; экспортировал — отправил коллеге одним вложением.

## Scope

**Экспорт:**

- Активный `LogFilter` (поля `query`, `queryMode`, `caseSensitive`, `wholeWord`, `levels`, `services`, `timeRange`, `sources`, `filePaths`, `fieldFilters`, `orderBy`, `sort` если реализована).
- Список `LvSavedSearch[]` из `lv:saved-searches`.
- Опционально: глобальные `tweaks.columns` и `groupBy`.
- Формат: один JSON-файл, имя по дефолту `lv-filters-YYYY-MM-DD.json`.

**Импорт:**

- File-picker (через `<input type="file" accept=".json">`).
- Валидация: схема + версия (внутри файла поле `version: "lv-filter-v1"`).
- Поведение: показать диалог «Заменить текущий фильтр / Добавить saved-searches» с чекбоксами по категориям.

**Структура файла:**

```json
{
  "version": "lv-filter-v1",
  "exportedAt": "2026-05-21T12:00:00Z",
  "filter": { /* LogFilter, без поля 'sources' и 'filePaths' если не хотим переносить ссылки на конкретные source-ids */ },
  "savedSearches": [{ "id": "...", "name": "...", "query": {...} }],
  "columns": [{ "key": "trace_id", "widthPx": 140 }],
  "groupBy": ["service"]
}
```

Решения для обсуждения:

- Переносить ли `sources`/`filePaths` (привязка к конкретным id-шникам не имеет смысла на чужой машине → по умолчанию **исключаем**, есть чекбокс «включить ссылки на источники»).
- Что делать с конфликтом ids в saved-searches при импорте: добавить с новыми id, заменить, спросить.

## Подход

Куда повесить пункты:

- File menu → новые пункты:
  - «Export Filters…» → выгружает JSON, скачивается через `Blob` + `<a download>`.
  - «Import Filters…» → открывает скрытый `<input type="file">`, парсит, валидирует, открывает `<LvFilterImportModal>` с чекбоксами и предпросмотром.
- Command-palette повторяет те же два пункта.

Контракт:

```ts
interface LvFilterExportV1 {
  readonly version: 'lv-filter-v1';
  readonly exportedAt: string;
  readonly filter?: LogFilter;
  readonly savedSearches?: ReadonlyArray<LvSavedSearch>;
  readonly columns?: ReadonlyArray<LvColumnPref>;
  readonly groupBy?: ReadonlyArray<LvGroupBy>;
}
```

Helpers:

- `serialize(filter, options): LvFilterExportV1`
- `parse(json: unknown): LvFilterExportV1 | { error }` — runtime guard, без сторонних схем.

## Critical files (предварительно)

Новые:

- `src/app/filter-export.ts` — `serialize`/`parse` + download/upload helpers.
- `src/ui/components/modals/LvFilterImportModal.tsx` — попап с чекбоксами + preview.

Изменяются:

- `src/ui/components/topbar/LvMenuBar.tsx` — два новых пункта в File menu.
- `src/ui/components/layout/LvApp.tsx` — обработка команд `export-filters` / `import-filters`, рендер модалки.
- `src/app/containers/LvAppContainer.tsx` — wiring: чтение текущего filter/savedSearches, применение импортированных.

Не меняются, но переиспользуются:

- `useSavedSearches` ([src/hooks/use-saved-searches.ts](src/hooks/use-saved-searches.ts)) — добавить action `setAll(list)`.
- `useUiPrefs.setColumns` / `setGroupBy`.

## Verification

1. **Экспорт.** Установить сложный фильтр + 2 saved-searches → File → Export Filters → скачивается JSON. Открыть его в текстовом редакторе — структура валидная.
2. **Импорт чужого файла.** Открыть File → Import Filters → выбрать сохранённый JSON → модалка с чекбоксами → подтвердить → фильтр применился, saved-searches появились в боковой панели Search.
3. **Версионирование.** Изменить вручную `version` на неподдерживаемую → импорт показывает ошибку «Unsupported file version» в модалке, ничего не меняет.
4. **Конфликт ids.** Импорт saved-search с тем же `id` что уже есть → по умолчанию заменяется (или добавляется с новым id — обсуждаемое поведение).
5. **Clear data integration.** В диалоге `Clear Application Data` чекбокс UI-state продолжает чистить saved-searches.
6. `pnpm test && pnpm lint && pnpm build` — без новых ошибок.
