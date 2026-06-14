# CSS

Единый файл [src/ui/styles/lv.css](../../src/ui/styles/lv.css); Tailwind подключён через
`@import "tailwindcss"`. Своя система классов с префиксом `lv-`.

## Дизайн-токены и темы

CSS-переменные `--lv-*` — в `:root` (дефолты) и `html[data-theme="dark"]` /
`html[data-theme="light"]` (переопределения). Компоненты используют `var(--lv-bg)`,
`var(--lv-fg)` и т.п.; смена темы — переключением `data-theme`, без условного CSS.

## Классы и модификаторы

- Префикс `lv-`, kebab-case, иерархично: `lv-sidebar`, `lv-form-row`, `lv-modal-hd`.
- **Состояние** — модификатор `is-*`, добавляется к базовому классу:
  ``className={`lv-tree-check${selected ? ' is-on' : ''}`}``.
- **Вариант** компонента — модификатор `--`: `lv-form-row--col`, `lv-form-row--top`
  (см. [ui-conventions.md](ui-conventions.md), ADR
  [0031](../adr/0031-form-field-layout-contract.md)).

## Inline-стили

Допустимы **только для динамических** значений, не выразимых классом: позиции меню
(`top`/`left`), отступ по глубине дерева (`paddingLeft: 6 + depth * 12`), трансформации
(`transform: rotate(...)`). Вся статика — в `lv.css`.

## Формы / визуал

Раскладка полей и прочие визуальные договорённости — в
[docs/ui-conventions.md](ui-conventions.md) (раздел Forms), реализованы компонентом
`LvFormField`.
