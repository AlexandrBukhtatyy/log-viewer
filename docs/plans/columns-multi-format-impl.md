# Format-aware колонки + column builder (Implementation plan для A+D)

## Context

Discovery-документ — [whimsical-booping-feigenbaum.md](./whimsical-booping-feigenbaum.md). Выбрано направление **A + D** в полном объёме:

- **A** = per-tab column profile + использование `parser.defaultColumns` для авто-инициализации колонок при открытии per-file tab.
- **D** = column builder с regex'ом для unstructured-форматов (виртуальные поля, извлекаемые из `raw` по запросу).

Объём — три phase, ~17 шагов. Каждый phase оставляет систему рабочей и проходит lint+test+build.

## Phase 1 — Per-tab column profile + `parser.defaultColumns`

**Цель:** при открытии per-file tab колонки автоматически подбираются под формат (parser.defaultColumns); пользователь может править — изменения сохраняются per-tab. All-Logs tab продолжает работать с глобальными `tweaks.columns`.

### 1.1 Резолюция parserId по sourceId

Нужно убедиться, что `SourceRecord` (или эквивалент) несёт `parserId`. Если несёт — используем; если нет — добавляем.

- Проверить тип `SourceRecord` в [src/core/types/](../../src/core/types/) и storage layer.
- Если `parserId` отсутствует — поднять его через ingest path (detector уже определяет parser, см. [src/core/parsers/index.ts](../../src/core/parsers/index.ts)).

### 1.2 Расширить `LvTab`

В [src/ui/contracts/lv-types.ts:146](../../src/ui/contracts/lv-types.ts#L146):

```ts
export interface LvTab {
  id: string;
  name: string;
  path?: string;
  kind?: LvLogKind;
  isPinned?: boolean;
  // NEW:
  columns?: ReadonlyArray<LvColumnPref>;
  // NEW (Phase 2):
  // virtualFields?: ReadonlyArray<LvVirtualField>;
}
```

Persisted через [use-workspace.ts partializeWorkspace](../../src/hooks/use-workspace.ts#L102). Поскольку поле опциональное и tabs serializable JSON — миграция не требуется (старые tab'ы просто без поля).

### 1.3 `defaultColumns` во встроенных парсерах

Заполнить в каждом парсере поле `defaultColumns: ReadonlyArray<string>`:

- [json-lines-parser.ts](../../src/core/parsers/json-lines-parser.ts) — `[]` (зависит от payload'а, пусть viewer добивает топом из field schema).
- [nginx-combined-parser.ts](../../src/core/parsers/nginx-combined-parser.ts) — `['status', 'remote_addr', 'request_method', 'request_uri']`.
- [syslog-parser.ts](../../src/core/parsers/syslog-parser.ts) — `['hostname', 'app_name']`.
- [app-text-parser.ts](../../src/core/parsers/app-text-parser.ts) — `['service']`.
- [plain-text-parser.ts](../../src/core/parsers/plain-text-parser.ts) — `[]`.

Для JSON-форматов с пустым `defaultColumns` viewer fallback'ится на топ-3 поля из field schema по `presenceRate` (≥30%).

### 1.4 Резолвер активных колонок в LvAppContainer

В [LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) появляется `activeColumns: ReadonlyArray<LvColumnPref>`:

```ts
const activeColumns = useMemo<ReadonlyArray<LvColumnPref>>(() => {
  if (activeTabId === '__all__') return tweaks.columns;
  const tab = openTabs.find((t) => t.id === activeTabId);
  return tab?.columns ?? tweaks.columns;
}, [activeTabId, openTabs, tweaks.columns]);
```

Передаётся в [LvViewer](../../src/ui/components/stream/LvViewer.tsx) вместо `tweaks.columns`.

### 1.5 Инициализация tab.columns при openTab

В callback'е `openTab` (LvAppContainer строка ~387):

```ts
const parserId = resolveParserId(rawId, sourceRecordsById); // see 1.1
const parser = parserRegistry.get(parserId);
const initialColumns: LvColumnPref[] = (parser?.defaultColumns ?? [])
  .map((key) => ({ key, widthPx: 140 }));
// ... затем suggesting через field schema, если initialColumns пуст:
const fallback = pickTopFieldsByPresence(parserId, fieldSchema, 3);
const newTab: LvTab = {
  id: rawId,
  name: resolved.name,
  path: resolved.path,
  kind: resolved.kind,
  isPinned: false,
  columns: initialColumns.length > 0 ? initialColumns : fallback,
};
```

### 1.6 LvColumnPicker пишет в активный tab

Текущий [LvColumnPicker onChange](../../src/ui/components/filter/LvColumnPicker.tsx) → новый колбэк `onColumnsChange(next)`:

- Если активный tab = `'__all__'` → пишем в `setTweak('columns', next)`.
- Иначе → `setOpenTabs(prev => prev.map(t => t.id === activeTabId ? {...t, columns: next} : t))`.

Контейнер передаёт ровно тот колбэк, который нужен.

### 1.7 Тесты

В [src/hooks/__tests__/use-workspace.test.ts](../../src/hooks/__tests__/use-workspace.test.ts):
- Tab с `columns` сериализуется и восстанавливается.
- Tab без `columns` — поле просто отсутствует после rehydrate.

Новый файл `src/app/containers/__tests__/active-columns-resolver.test.ts`:
- `__all__` → берёт `tweaks.columns`.
- Per-file tab без `columns` → `tweaks.columns`.
- Per-file tab с `columns` → tab.columns.

### 1.8 Verification

```bash
pnpm lint && pnpm test && pnpm build
pnpm gen:fixtures && pnpm dev
# - Открыть .tmp/nginx-access.log → колонки status/remote_addr/... сразу видны.
# - Открыть .tmp/pino.jsonl → топ-3 поля из field schema видны.
# - Открыть .tmp/app.log → только фиксированные колонки.
# - В All-Logs tab колонки остаются прежними (глобальные tweaks).
# - Изменения в picker'е per-file не влияют на All-Logs и наоборот.
# - Reload браузера: per-tab columns восстанавливаются.
```

---

## Phase 2 — Column builder (виртуальные regex-поля)

**Цель:** для unstructured-форматов пользователь задаёт regex с named groups и каждая группа становится колонкой. Применяется к `raw`-полю строки.

### 2.1 Модель `LvVirtualField`

В [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts):

```ts
export interface LvVirtualField {
  /** Уникальный ключ колонки (e.g. `vf:status`). */
  readonly key: string;
  /** User-facing label, по умолчанию = named group name. */
  readonly label?: string;
  /** Regex source string (structured-cloneable, как continuationRegex). */
  readonly pattern: string;
  /** Имя named group в pattern, значение которой попадает в колонку. */
  readonly group: string;
  /** Источник: 'raw' (по умолчанию) или 'message'. */
  readonly target?: 'raw' | 'message';
}
```

В `LvTab`:
```ts
virtualFields?: ReadonlyArray<LvVirtualField>;
```

### 2.2 Column builder UI

Модалка из [LvTableSettings](../../src/ui/components/filter/LvTableSettings.tsx), кнопка "+ regex column":

- Textarea с regex'ом.
- Live preview: первые 10 строк из текущего window, извлечённые значения по группам подсвечиваются.
- Список named groups → пользователь выбирает, какая становится колонкой (можно несколько за раз → несколько virtualFields).
- Save → добавить в `tab.virtualFields` и `tab.columns` (или global, аналогично 1.6).

### 2.3 Применение в LvRow

В [src/core/filter/field-key.ts](../../src/core/filter/field-key.ts), функция `getEntryFieldValue`:

- Если ключ начинается с префикса `vf:` → ищем `LvVirtualField` в активном контексте (через новый параметр или через kontext объект), применяем regex к `entry.raw`/`entry.message`, возвращаем capture group.
- Кэширование compiled regex per-key, чтобы не парсить regex на каждую ячейку (вокруг WeakMap по `LvVirtualField`).

### 2.4 Тесты

- Unit на virtual field resolver: матч/мисс/группа отсутствует.
- Снимок persist'енса tab с virtualFields.
- Регрессия: ячейки без virtualFields ведут себя как раньше.

---

## Phase 3 — Presets

**Цель:** сохранять/применять именованные комбинации `{columns, virtualFields}`. Глобальные `tweaks.columns` мигрируют в дефолтный preset "Custom".

### 3.1 Модель `LvColumnPreset`

В [use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts):

```ts
export interface LvColumnPreset {
  readonly id: string;          // 'pino-default', 'nginx-access', 'custom-1', …
  readonly name: string;
  readonly columns: ReadonlyArray<LvColumnPref>;
  readonly virtualFields?: ReadonlyArray<LvVirtualField>;
  /** Built-in presets read-only, user presets editable/deletable. */
  readonly origin: 'builtin' | 'user';
}
```

В `LvTweaks` появляется `presets: ReadonlyArray<LvColumnPreset>`. Built-in presets хардкодятся в коде и не сохраняются в localStorage; user presets — да.

### 3.2 UI

В [LvTableSettings](../../src/ui/components/filter/LvTableSettings.tsx):
- Dropdown "Apply preset" → список builtins + user presets.
- Кнопка "Save current as preset" → запрос имени → push в `tweaks.presets`.
- Apply preset: записывает columns+virtualFields в активный tab (или в global, если active = `'__all__'`).

### 3.3 Миграция глобальных tweaks.columns

При первом запуске после деплоя Phase 3:
- Если `tweaks.columns` непуст и нет user-preset'а с этим набором → создаём preset "My columns" из них.
- `tweaks.columns` сохраняется как есть (используется для `'__all__'`), просто становится доступен как preset.

Версия `lv:ui-prefs` бампается до 2, в migrate-блоке делается описанное выше.

### 3.4 Тесты + smoke

- Built-in presets отображаются, применяются.
- User preset сохраняется, восстанавливается после reload.
- Миграция v1 → v2: глобальные columns превращаются в named preset.
- Smoke: apply Pino preset → колонки сменились; reload → preset остался; delete preset → корректно удалён.

---

## Phase 4 — Unified column model (refactor)

**Контекст.** После Phase 1–3 в таблице остались две несимметричных модели колонок:
- "Chrome data" — захардкоженные `<span>` для timestamp/level/service/file (через классы `lv-row-ts/lvl/svc/file`), с фиксированными ширинами `178/58/120/150 px` прямо в `gridTemplateForColumns`. Видимость управляется четырьмя boolean'ами `tweaks.showTimestamp/Level/Service/File`.
- "Data columns" — массив `LvColumnPref[]` с произвольным `widthPx`, ячейки рисуются через `cellValueOf`.

Это вытекает в захардкоженный header (4 span'а вместо `.map`), boolean-визуализацию вместо унифицированной "в layout или нет", и дубликат логики между chrome- и data-ячейками. Концептуально `@ts/@level/@source.name/@file` — это **тоже** descriptors из field schema (см. [BUILT_IN_FIELD_DESCRIPTORS](../../src/core/filter/field-descriptor.ts)); им нужен только custom-renderer, а не отдельный страт.

**Цель Phase 4.** Один реестр `LvColumnDescriptor` со всеми колонками. Layout таб = плоский массив `{ key, widthPx }`. `gridTemplateForColumns` и header — единый цикл по `activeColumns`. Boolean'ы `showTimestamp/Level/Service/File` исчезают (их семантика = "key present").

### Скоуп

**Chrome остаётся** (всегда виден):
- LN gutter (52px)
- CARET (16px)
- MESSAGE — last, `1fr`, без wrap, single-line. Никаких переносов строки в message — `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`. `tweaks.wrap` удаляется.
- ACTIONS (52px)

**Data колонки** — всё остальное через единый descriptor:
- `@ts` → renderCell = `lvFmtTime(entry.timestamp, showDate)`, cellClass `lv-row-ts`.
- `@level` → renderCell = level-tag span, cellClass `lv-row-lvl`.
- `@source.name` → renderCell = service (с fileMeta fallback), cellClass `lv-row-svc`.
- `@file` → renderCell = basename(filePath), cellClass `lv-row-file`.
- dynamic JSON keys → default renderer.
- `vf:*` → default renderer (resolveVirtualField).

### Шаги

1. **`LvColumnDescriptor` + builtin registry** — [src/ui/contracts/lv-column-registry.ts](../../src/ui/contracts/lv-column-registry.ts) (новый).
2. **Удалить boolean'ы** `showTimestamp/Level/Service/File` из `LvTweaks` и из `LvTableSettings`.
3. **`gridTemplateForColumns`** — упростить до `[LN, CARET, ...data, MESSAGE, ACTIONS]`.
4. **LvViewer header** — `activeColumns.map(...)` вместо захардкоженных span'ов.
5. **LvRow** — `activeColumns.map(...)` с применением `descriptor.renderCell ?? defaultRender`.
6. **LvColumnPicker** — built-in descriptors теперь в одном списке с dynamic; при выключении из layout — удаление key.
7. **wrap** — удалить `tweaks.wrap`, удалить класс `.lv-row-msg.wrap` логику, CSS message всегда `white-space: nowrap`.
8. **Migration v2 → v3** — удалить `showTimestamp/showLevel/showService/showFile` и `wrap` из persisted state.

### Где может быть боль

- Подсчёт ширин в CSS — текущие правила `.lv-sh-ts` и т.п. ожидают порядок. После refactor cellClass даётся через descriptor → CSS-стилизация остаётся, но без зависимостей от порядка.
- `parser.defaultColumns` сейчас возвращает динамические ключи (`status, method, ...`). После refactor они могут жить рядом с `@ts`/`@level`. Для каждого парсера решить: что инжектится при openTab.
- Migration: удалять поля — безопасно, Zustand merge заполнит дефолтами.

## Из-под радара (будущие фичи, не в скоупе сейчас)

- **B вариант** (auto-fill columns from frequent fields) — опциональный toggle поверх готовой связки A+D. Реализуется позже, когда станет понятно поведение presetов на смешанных tab'ах.
- **Inline-chips в MESSAGE** (вариант C) — опциональный density mode. Не сейчас.
- **logfmt parser** — отдельная задача, ортогональная этому плану.

## Открытые вопросы → решения

Заметки из discovery-документа:

1. **Per-tab vs global columns** → решено: per-tab (с fallback на `tweaks.columns` для `'__all__'`).
2. **Что считать форматом в All-Logs** → не пытаемся; All-Logs использует глобальный set.
3. **Конструктор колонок** → regex с named groups (минимум сложности; mirror'ит Klogg highlighters).
4. **Миграция `tweaks.columns`** → остаётся для `'__all__'`, плюс копия как user preset.

## Критические файлы

- [src/core/types/log-parser.ts](../../src/core/types/log-parser.ts) — `defaultColumns` уже задекларирован.
- [src/core/parsers/*.ts](../../src/core/parsers/) — заполнить `defaultColumns`.
- [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts) — `LvTab.columns`, `LvVirtualField`, `LvColumnPreset`.
- [src/hooks/use-workspace.ts](../../src/hooks/use-workspace.ts) — persist расширенного LvTab.
- [src/hooks/use-ui-prefs.ts](../../src/hooks/use-ui-prefs.ts) — `presets` + migrate v1→v2.
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — activeColumns resolver, init tab.columns, onColumnsChange dispatch.
- [src/ui/components/stream/LvViewer.tsx](../../src/ui/components/stream/LvViewer.tsx) — потребитель `activeColumns`.
- [src/ui/components/filter/LvColumnPicker.tsx](../../src/ui/components/filter/LvColumnPicker.tsx) — `onColumnsChange` через контейнер.
- [src/ui/components/filter/LvTableSettings.tsx](../../src/ui/components/filter/LvTableSettings.tsx) — column builder, preset UI.
- [src/core/filter/field-key.ts](../../src/core/filter/field-key.ts) — резолвер `vf:*` ключей.

## Стратегия итераций

- Phase 1, 2, 3 — независимые merge'абельные куски.
- Внутри Phase — атомарные коммиты (один шаг = один смысловой коммит), но **commit'ы делаются только по явной команде** (см. memory `feedback_no_commit_without_request.md`).
- После каждого phase: `pnpm lint && pnpm test && pnpm build` обязательны.

## ADR-кандидаты

Из текущего плана как минимум одно решение тянет на ADR:
- **Per-tab column profile** (нарушает текущее "колонки глобальные") — стоит зафиксировать ADR после Phase 1.
- **Virtual fields через regex** (новая концепция в field schema) — ADR после Phase 2.
