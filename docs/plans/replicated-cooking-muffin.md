# Group-by picker — searchable combobox + Add button

## Context

Текущий dropdown `LvGroupBySelect` (после ADR-0017 Phase 6) показывает плоский список **всех** доступных полей через `lv-pop-item` checkbox-style строки. На pino/nginx источниках это уже 16+ полей и продолжит расти, что делает popover длинным и неудобным.

Цель — заменить длинный список на **компактный combobox**:
- сверху popover — input для поиска по подстроке + кнопка `Add`,
- результаты поиска показываются маленьким dropdown'ом под input'ом и сужаются по мере ввода,
- активные группировки (chips с up/down/×) остаются ниже, как сейчас.

UX-приоритеты: меньше визуального шума, быстрее найти редкое поле, keyboard-friendly (`Enter` добавляет, `↑/↓` — навигация).

Никакой новой логики backend / SQL / RPC — только переработка popover'а внутри одного компонента. Тесты не нужны (UI-only, нет unit-coverage'а у picker'ов сейчас).

## Approach

Один файл, изменения целиком локальны в `LvGroupBySelect`. Native `<datalist>` отвергаю — стиль не контролируется, нет hover-highlight, нет визуальной индикации выбранного элемента. Делаю свой filtered-list под input.

### Layout (внутри `lv-pop`, top → bottom)

```
┌─────────────────────────────────┐
│ Group by               [Clear]  │  ← lv-pop-hd (как сейчас)
├─────────────────────────────────┤
│ [search input………………] [+ Add]   │  ← новое: поиск + Add (top, как просил юзер)
│ ┌───────────────────────────┐   │
│ │ traceId          dynamic  │ ← │  filtered dropdown,
│ │ trace_id         dynamic  │   │  highlighted row = выбранный
│ │ @source.kind     enum     │   │  (max-height ~200px, scroll)
│ └───────────────────────────┘   │
├─────────────────────────────────┤
│ ① service           ↑ ↓ ×       │  ← lv-group-order (активные chips,
│ ② @source.kind      ↑ ↓ ×       │     остаётся как сейчас)
└─────────────────────────────────┘
```

### State

- `query: string` — текст в input.
- `highlightedIdx: number` — индекс highlighted строки в filtered-list (default 0).

Сбрасываются при close popover'а.

### Filtering

Подстрочный case-insensitive match по `key` И `label`. Сортировка остаётся прежней (dynamic по presenceRate DESC, builtin в catalog order). Уже выбранные ключи **не** скрываются — просто отображаются с `is-on` и игнорируются на Add (или toggle off — пусть будет toggle, как сейчас).

### Keyboard

- `↑` / `↓` — двигают `highlightedIdx`, прокрутка `scrollIntoView({ block: 'nearest' })`.
- `Enter` — toggle highlighted ключ (если он in active — снимает, иначе добавляет). Input не очищается, чтобы можно было добавить серию `req_*`/`trace_*` подряд.
- `Esc` — очищает input. Если уже пуст — закрывает popover.

### Add button

Дублирует `Enter` — toggle highlighted. Disabled когда filtered-list пуст. Нужен потому что сценарий "нашёл, потом мышкой добавил" более явный, чем `Enter`-only.

### Что удалить

- Блок `<div className="lv-pop-sub">Add level</div>`.
- Большой `options.map(...)` с `lv-pop-item` checkbox'ами.

### Что сохранить

- Кнопка-trigger (chevron + Group: label).
- `.lv-pop-hd` с Clear.
- `lv-group-order` chips с up/down/× (без изменений).
- Empty-state "No fields yet — pick a source.".
- Outside-click закрытие popover.

## Files to modify

- [src/ui/components/filter/LvGroupBySelect.tsx](../../src/ui/components/filter/LvGroupBySelect.tsx) — единственный TS/TSX файл. Переписывается тело popover'а; props (`value`, `descriptors`, `onChange`) и `LvGroupBySelectProps` остаются без изменений — никакие callers не трогаются.
- [src/ui/styles/lv.css](../../src/ui/styles/lv.css) — добавить блок `.lv-group-search-row` / `.lv-group-search-list` / `.lv-group-search-item.is-active`. Перeиспользую `.lv-field-input` (height 26px, та же типографика) и `.lv-btn-primary` для Add.

## Reuse from existing

- Сортировка descriptors — копия логики из [LvColumnPicker.tsx:41-54](../../src/ui/components/filter/LvColumnPicker.tsx#L41-L54). Дублирую (3-я копия — DRY-рефакторинг отдельной задачей; см. Out of scope).
- `.lv-pop` / `.lv-pop-hd` / `.lv-pop-clear` / `.lv-pop-empty` уже стилизованы.
- `.lv-field-input` для search input'а ([lv.css:1008](../../src/ui/styles/lv.css#L1008)).
- `.lv-btn` / `.lv-btn-primary` для Add.

## Verification

1. `npx tsc -b && pnpm lint && pnpm test --run` — все зелёные (тестов на picker нет, regression-проверка статической части).
2. Browser smoke (Playwright):
   - Открыть pino-source.
   - Кликнуть кнопку `Group: …` → popover открыт, input в фокусе, dropdown показывает все descriptors отсортированными.
   - Ввести `req` → dropdown сужается до `reqId`/`req_id` (если есть).
   - `↓` → highlight перемещается; `Enter` → ключ добавлен в `lv-group-order`; группа применилась (видны bucket'ы).
   - Click по `+ Add` → toggle того же ключа (снят).
   - `Clear` → активные ключи сброшены.
   - Click вне popover → popover закрылся.
   - 0 console errors.

## Out of scope

- DRY рефакторинг сортировки descriptors (есть в `LvColumnPicker`, `LvAddFieldFilter`, текущем `LvGroupBySelect` — три копии). Вынести в `src/ui/utils/sort-descriptors.ts` отдельной задачей; сейчас держу in-place чтобы изменение оставалось локальным.
- Применение того же combobox-паттерна к `LvColumnPicker` / `LvAddFieldFilter` — у них другой UX (column picker нужен полный список с галочками для toggle нескольких; field filter уже использует datalist). Если позже захочется унифицировать — отдельная задача.
- Multi-select keyboard через `Shift+Enter` или подобное — пока scope один-за-раз через Enter.
