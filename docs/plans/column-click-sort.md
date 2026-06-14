# Column-click sort в стриме логов

## Context

Сейчас порядок строк в стриме фиксированный: индексер всегда применяет
один из двух дефолтных `ORDER BY` ([core/filter/query.ts:147-160](src/core/filter/query.ts#L147-L160)) — `time` (по `entry.ts` asc, мульти-источник) или `physical` (`source_id, seq`, один источник). Переключение между ними делает effect в LvApp по числу источников ([LvApp.tsx:331-334](src/ui/components/layout/LvApp.tsx#L331-L334)). Пользовательской возможности отсортировать по другому полю — нет.

Цель: дать кликом по заголовку колонки задать сортировку по любому
известному полю. UX: 3-фазный цикл `asc → desc → reset`, стрелка-индикатор
рядом с активной колонкой. Колонка `message` не сортируется. Группировка
не блокирует сортировку, но влияет только на содержимое **раскрытых
групп** (порядок самих бакетов остаётся серверным count desc).

## Design

### Контракт

Добавляется новое опциональное поле в `LogFilter`:

```ts
export interface LogSort {
  readonly key: FieldKey;          // '@ts' | '@level' | '@seq' | '@file' | 'service' | …
  readonly dir: 'asc' | 'desc';
}
// в LogFilter
readonly sort?: LogSort | null;
```

Файл: [src/core/types/log-filter.ts](src/core/types/log-filter.ts).

Прецедент: если `filter.sort` задан → он выигрывает над `orderBy`. Иначе fall-through на текущую логику (`time`/`physical`). Существующее автотоггл-поведение `orderBy` не меняем — оно безвредно пока `sort` присутствует.

### SQL

Расширяется `orderByForFilter()` в [src/core/filter/query.ts](src/core/filter/query.ts):

```ts
export const orderByForFilter = (filter: LogFilter): string => {
  if (filter.sort) {
    const { sql } = fieldKeyToSql(filter.sort.key); // reuse existing translator
    const dir = filter.sort.dir === 'desc' ? 'DESC' : 'ASC';
    // Nulls last, stable tiebreaker by (source_id, seq).
    return `ORDER BY ${sql} IS NULL, ${sql} ${dir}, entry.source_id ASC, entry.seq ASC`;
  }
  return filter.orderBy === 'physical' ? ORDER_BY_PHYSICAL : ORDER_BY_DEFAULT;
};
```

- Динамические JSON-поля (типа `service`, `trace_id`) приходят через `JSON_EXTRACT(entry.fields_json, '$.<key>')` — `fieldKeyToSql` это уже умеет.
- v1 ограничивается полями с `needsSourceJoin: false` (т.е. без `@source.name`/`@source.kind`). Запрещаем такие ключи в UI (они не выставляются как клик-сортируемые заголовки).

### UI: заголовки

Файл: [src/ui/components/stream/LvViewer.tsx](src/ui/components/stream/LvViewer.tsx) (блок `.lv-stream-hd` на строках 573-587).

Создаём небольшой helper-компонент `<SortableHeader>` прямо внутри `LvViewer.tsx`:

```tsx
type SortableHeaderProps = {
  readonly className: string;
  readonly sortKey: FieldKey | null; // null = неактивная (message, caret)
  readonly label: string;
  readonly sort: LogSort | null | undefined;
  readonly onCycle: (key: FieldKey) => void;
};
```

- Если `sortKey === null` — рендер плоского `<span>`, как сейчас.
- Иначе рендер интерактивного `<button>` без `border/background`, `cursor: pointer`, `padding/font-size: inherit`. Внутри label + индикатор (▲/▼) для активной колонки.

Заголовки переводятся на `SortableHeader`:

| header                     | sortKey                            |
| -------------------------- | ---------------------------------- |
| `@seq`                     | `@seq`                             |
| caret                      | `null`                             |
| `timestamp`                | `@ts`                              |
| `level`                    | `@level`                           |
| `service`                  | `service` (динамическое JSON-поле) |
| `@file`                    | `@file`                            |
| dynamic columns (each `c`) | `c.key`                            |
| `message`                  | `null`                             |
| actions                    | `null`                             |

### Цикл и обработчик

```ts
const onSortCycle = useCallback(
  (key: FieldKey) => {
    setFilter((prev) => {
      const cur = prev.sort;
      let next: LogSort | null;
      if (!cur || cur.key !== key) next = { key, dir: 'asc' };
      else if (cur.dir === 'asc') next = { key, dir: 'desc' };
      else next = null; // 3-я фаза — сброс
      return { ...prev, sort: next };
    });
  },
  [setFilter],
);
```

### Group-by

Когда `groupBy.length > 0`, top-level рендер — бакеты, их порядок остаётся серверным (`getGroupCounts` отдаёт уже отсортированные по count). Заголовки же по-прежнему кликабельны: `setFilter({ ..., sort })` обновляет фильтр, и при drill-down `fetchEntries(scopedFilter, …)` получит filter с уже выставленным `sort` — порядок строк внутри развёрнутой группы будет соответствовать.

Никакого специального кода для этого не надо: `scopedFilter` уже основан на пропсе `filter`. Достаточно убедиться, что drill-down при добавлении `fieldFilter` сохраняет `sort` ([LvAppContainer.onGroupDrillDown](src/app/containers/LvAppContainer.tsx) — проверить).

### Стили

Минимум в [src/ui/styles/lv.css](src/ui/styles/lv.css):

```css
.lv-sh-sortable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.lv-sh-sortable:hover {
  color: var(--lv-fg);
}
.lv-sh-sort-icon {
  width: 10px;
  opacity: 0.7;
}
```

### Persistence

`LogFilter` живёт в `coreFilter` контейнера (хук `useLogFilter`). Если он уже сохраняется (saved-searches / ui-prefs), `sort` автоматически попадёт туда же. Проверить: `useLogFilter` сериализует/restore `filter` целиком — поле `sort` добавится без правок.

## Critical files

Переименование (первый шаг реализации):

- `docs/plans/binary-baking-clover.md` → `docs/plans/column-click-sort.md` (`mv`, файл untracked).

Изменяются:

- [src/core/types/log-filter.ts](src/core/types/log-filter.ts) — `LogSort`, `LogFilter.sort`.
- [src/core/filter/query.ts](src/core/filter/query.ts) — `orderByForFilter` с веткой `filter.sort`.
- [src/core/filter/query.test.ts](src/core/filter/query.test.ts) — новые юнит-тесты.
- [src/ui/components/stream/LvViewer.tsx](src/ui/components/stream/LvViewer.tsx) — `<SortableHeader>`, замена заголовков (строки 573-587), `onSortCycle`.
- [src/ui/styles/lv.css](src/ui/styles/lv.css) — `.lv-sh-sortable`, `.lv-sh-sort-icon`.

Не меняются, но переиспользуются:

- [`fieldKeyToSql`](src/core/filter/field-key.ts) — построение SQL-выражения по FieldKey (built-in и dynamic).
- [`useLogFilter` / `setFilter`](src/hooks/use-log-filter.ts) — пушим `sort` через тот же канал.
- Существующий `ORDER_BY_DEFAULT` / `ORDER_BY_PHYSICAL` — остаются в fallback-ветке.

## Verification

1. **Юнит**: `pnpm test src/core/filter/query.test.ts` (после добавления новых кейсов):
   - `sort = { key: '@ts', dir: 'asc' }` → `ORDER BY entry.ts IS NULL, entry.ts ASC, source_id ASC, seq ASC`.
   - `sort = { key: '@level', dir: 'desc' }` → правильный SQL.
   - `sort = { key: 'trace_id', dir: 'asc' }` → `JSON_EXTRACT(...)` в ORDER BY.
   - При `sort` пустом — поведение `orderBy` не меняется (регрессия дефолтов).

2. **E2E через Playwright** на dev-сервере:
   - Открыть `pino.jsonl` (из `.tmp/demo_logs/json_logs/`).
   - Клик `timestamp` → стрелка ▲, строки сверху — самые ранние.
   - Клик ещё раз → ▼, сверху — самые поздние.
   - Третий клик → стрелка снята, дефолт восстановлен.
   - Клик `level` → строки сгруппированы по уровню (INFO выше DEBUG, например). При desc — наоборот.
   - Клик динамической колонки (например `service`) — сортировка работает.
   - Клик `message` или caret — ничего не происходит (не sortable).

3. **Group-by + sort**: включить group-by по `service`, развернуть бакет → клик `timestamp` внутри открытого — строки сортируются. Бакеты сверху не меняют порядок.

4. **`pnpm lint && pnpm build`** — без новых ошибок.
