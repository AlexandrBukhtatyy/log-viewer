# Column sort — single-column sort with per-tab persistence

## 1. Context

Сейчас порядок строк таблицы задаётся через `LogFilter.orderBy: 'time' | 'physical'` (см. [src/core/filter/query.ts](../../src/core/filter/query.ts#L177)) с auto-infer для пустого значения: single-source-single-file → physical (стабильные line-numbers), всё остальное → time. Это closed-set из двух режимов, и пользователь не может явно отсортировать таблицу по конкретной колонке.

Реально нужное поведение: **click на header колонки → строки переупорядочиваются по этому полю, ↑/↓ показывает текущее направление, второй click меняет на desc, третий — снимает sort**. Так работают стандартные дата-таблицы (Excel, GitHub PR-list, Jira). Без этой фичи пользователь, например, не может разом увидеть «самые медленные HTTP-запросы» в nginx-логе (sort by `~http.status` desc или dynamic `latency_ms`).

**Outcome:** добавить single-column пользовательскую сортировку, per-tab persistence, поверх существующего ORDER BY pipeline. Без multi-column (Phase 4 территория), без context-menu, без global sort.

## 2. Архитектурное решение

- **Sort state** — новое поле в `LvTab`: `sortBy?: { key: FieldKey; dir: 'asc' | 'desc' }`. Per-tab автоматически persistится через `lv:workspace` (LvTab уже там).
- **Filter shape** — расширить `LogFilter.orderBy`. Текущий тип `'time' | 'physical'` остаётся для backward-compat (legacy саved-searches могут содержать), добавляется third variant — column sort. Альтернативно: новое поле `sortBy?: { key, dir }`. **Выбран второй** — отдельное поле yields cleaner model: `orderBy` остаётся как «shape hint» для auto-infer, `sortBy` (когда указан) выигрывает у всего.
- **SQL** — `orderByForFilter(filter)` получает приоритет: `sortBy` → custom ORDER BY → `orderBy` → fallback auto-infer.
- **UX cycle** — click на header: `none → asc → desc → none`. Visual indicator (↑/↓) рядом с label. Stable tie-breaker `source_id ASC, seq ASC` после основного sort'а, чтобы порядок одинаковых значений был детерминирован.
- **`@level` requires CASE** — лексикографический ASC (`debug, error, fatal, info, trace, warn`) бессмысленен; нужен severity-order через `CASE WHEN entry.level = 'trace' THEN 0 WHEN ... END`. Для остальных полей — generic ORDER BY через `fieldKeyToSql`.
- **Logical fields в sort** — `fieldKeyToSql('~name', ctx)` уже компилирует `~`-keys в COALESCE/JSON_EXTRACT (ADR-0030). Передаём тот же ctx в SQL builder.

## 3. Файлы — модификации

### Core / SQL
- [src/core/types/log-filter.ts](../../src/core/types/log-filter.ts) — добавить `LogFilterSort` type + поле `sortBy?: LogFilterSort` в `LogFilter`. Расширить `filtersEqual` и `EMPTY_FILTER` (нет default sortBy).
- [src/core/filter/query.ts](../../src/core/filter/query.ts) — переписать `orderByForFilter(filter, ctx?)` принимать `LogicalFieldsCtx`, ранее всех условий проверять `filter.sortBy`. Извлечь helper `sortBySql(sort, ctx)` который рендерит `<expr> ASC|DESC, source_id ASC, seq ASC` + special-case для `@level` (CASE WHEN). Существующие `ORDER_BY_TIME`/`ORDER_BY_PHYSICAL` оставить как fallback для auto-infer.
- [src/core/filter/query.test.ts](../../src/core/filter/query.test.ts) — добавить кейсы: sortBy по `@ts`, `@level` (CASE order), dynamic key, `~`-key, ASC/DESC, sortBy выигрывает у `orderBy: 'physical'`.

### Worker — нет changes
`buildClause` и `orderByForFilter` уже вызываются worker'ом из тех же мест ([indexer-api.ts](../../src/workers/indexer/indexer-api.ts) методы `search`, `exportFiltered`). Передача filter через RPC не меняется — `sortBy` сериализуется как часть filter. Расширения contract не нужно.

### UI
- [src/ui/contracts/lv-types.ts](../../src/ui/contracts/lv-types.ts) — поле `sortBy?: { readonly key: string; readonly dir: 'asc' | 'desc' }` в `LvTab`. Symmetрично существующим per-tab полям (`columns`).
- [src/ui/components/stream/LvViewer.tsx](../../src/ui/components/stream/LvViewer.tsx) — converter header `<span>` → `<button type="button">` (для accessibility), onClick → cycle. Visual: indicator `↑`/`↓` рядом с label через `<span>` с CSS-class. Опциональный prop `sortBy` (текущий) + `onSortByChange(next | null)`. Header chrome для `line`, `caret`, `message`, `act` — не sortable (без button-обёртки).
- [src/ui/components/layout/LvApp.tsx](../../src/ui/components/layout/LvApp.tsx) — прокинуть `sortBy` + `onSortByChange` props сквозь до LvViewer.
- [src/app/containers/LvAppContainer.tsx](../../src/app/containers/LvAppContainer.tsx) — взять `sortBy` из активного `LvTab`, при изменении писать обратно в openTabs. При формировании filter (там где собирается `coreFilter`/active filter): включить `sortBy` если не `null`.

### Hooks / workspace
- [src/hooks/use-workspace.ts](../../src/hooks/use-workspace.ts) — миграция `version` ↑1: legacy табы без `sortBy` остаются как есть (optional). Никаких структурных изменений.

## 4. UX-детали

- **Click cycle.** Click на header: если `sortBy.key !== c.key` → `{ key: c.key, dir: 'asc' }`. Если `sortBy.key === c.key && dir === 'asc'` → `dir: 'desc'`. Если `dir === 'desc'` → `sortBy = null` (вернуться к auto-infer).
- **Visual indicator.** Активная колонка показывает `↑` или `↓` в header. Inactive колонки могут показывать `⇅` opacity 0.3 на hover, чтобы намекнуть на интерактивность; без hover — ничего. Не тратим горизонтальное пространство.
- **Что не sortable.** Заголовки `line`, `caret`, `message`, `act` (action column). `@parser` (если вернётся) — sortable.
- **Group-by mode.** Когда group-by активна, sort применяется к bucket-рядам (после `expand`). Server-side `groupCounts` уже сортируется по `cnt DESC, gv ASC` — это independent; не трогаем. Внутри развернутой группы sort работает как обычно.

## 5. SQL: `@level` CASE

```sql
ORDER BY
  CASE entry.level
    WHEN 'trace' THEN 0
    WHEN 'debug' THEN 1
    WHEN 'info'  THEN 2
    WHEN 'warn'  THEN 3
    WHEN 'error' THEN 4
    WHEN 'fatal' THEN 5
    ELSE 99
  END ASC,                           -- main sort
  entry.source_id ASC, entry.seq ASC -- stable tie-breaker
```

Generic case (`@ts`, dynamic, `~`-logical):
```sql
ORDER BY <fieldKeyToSql(key).sql> ASC|DESC,
  entry.source_id ASC, entry.seq ASC
```

NULLs handling: для `@ts` — `entry.ts IS NULL` сначала (как в `ORDER_BY_TIME`). Для остальных — NULL last в ASC, first в DESC (SQLite default).

## 6. Verification

1. `pnpm gen:fixtures` ; `pnpm dev`.
2. Открыть `.tmp/nginx-access.log` → таблица должна иметь sortable headers (cursor pointer на hover).
3. Click на `status` header → строки переупорядочиваются по status ASC; indicator `↑`.
4. Второй click → desc; indicator `↓`.
5. Третий click → indicator пропадает, ordering возвращается к auto-infer.
6. Включить `@level` колонку → sort по ней даёт `trace < debug < info < warn < error < fatal`, не лексикографический.
7. Активировать `~http.status` (logical field) → sort работает через chain.
8. Переключиться между табами → sortBy у каждого таба свой (persisted через reload).
9. `pnpm lint && pnpm test && pnpm build` — зелёные.
10. Скриншот sort-by-status в `.tmp/screenshots/column-sort.png`.

## 7. Что НЕ делается

- **Multi-column sort** (shift+click → secondary). Отдельная фаза.
- **Global / per-source sort.** Только per-tab.
- **Context-menu sort** (right-click). Только header-click.
- **Sort через picker/UI button** отдельно от header. Header — единственная точка входа.
- **Backward-compat** — `LogFilter.orderBy` остаётся как есть, `sortBy` уходит в стейт независимо.
- **`@parser` namespace** — он не существует сейчас (отброшено в ADR-0030). Если когда-нибудь вернётся — будет sortable автоматически.

## 8. ADR

Не нужен. Это расширение существующей filter/SQL-машинерии в рамках уже принятых решений (ADR-0017 dynamic field schema, ADR-0028 unified column model). Новых архитектурных развилок нет: extractor pattern не меняется, column registry — расширяется опциональным sort flag, RPC contract — не трогается. Если по ходу всплывёт неочевидное решение — заведём ADR тогда.
