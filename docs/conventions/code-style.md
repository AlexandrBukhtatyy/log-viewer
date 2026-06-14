# Code style

## Именование

| Что                   | Правило                     | Пример                                     |
| --------------------- | --------------------------- | ------------------------------------------ |
| Файлы компонентов     | PascalCase с префиксом `Lv` | `LvSidebar.tsx`                            |
| Файлы хуков           | kebab-case с `use-`         | `use-log-window.ts`                        |
| Прочие модули/утилиты | kebab-case                  | `json-lines-parser.ts`, `build-catalog.ts` |
| Компоненты            | стрелочные, префикс `Lv`    | `export const LvSidebar = (...) => {}`     |
| Хуки                  | `useXxx`                    | `useLogWindow`                             |
| Типы/интерфейсы       | PascalCase                  | `LogEntry`, `LvSidebarProps`               |
| Константы-литералы    | UPPER_SNAKE_CASE            | `TS_KEYS`, `EMPTY_FILTER`                  |
| Переменные/функции    | camelCase                   | `selectedIds`, `toggleFolder`              |
| CSS-классы            | kebab-case с `lv-`          | `lv-sidebar`, `lv-form-row`                |

Образцы: [LvSidebar.tsx](../../src/ui/components/sidebar/LvSidebar.tsx),
[use-log-window.ts](../../src/hooks/use-log-window.ts).

## Импорты

- **Явные расширения** `.ts` / `.tsx` в относительных импортах (bundler-resolution +
  `verbatimModuleSyntax`): `import { LvTreeNode } from './LvTreeNode.tsx'`.
- **`import type`** для всего, что используется только как тип:
  `import type { LogEntry } from '../../core/types/index.ts'`.
- **Только относительные пути** — алиасы (`@/...`) не настроены.
- Порядок: внешние пакеты → локальные модули; типы часто отдельной группой.

## Barrel-файлы

Каждый слой реэкспортирует публичную поверхность через `index.ts`:

- [src/core/types/index.ts](../../src/core/types/index.ts) — доменные типы
- [src/core/parsers/index.ts](../../src/core/parsers/index.ts) — парсеры + `createDefaultRegistry()`
- [src/hooks/index.ts](../../src/hooks/index.ts) — хуки с их `UseXxx`-типами

Потребители импортируют из barrel, а не из под-модулей.

## Комментарии

- Объясняют **почему**, а не что. Образец — `SourceEntry` в
  [coordinator.ts](../../src/workers/coordinator/coordinator.ts) (rationale на каждое поле).
- Ссылки на ADR прямо в коде у нетривиальных мест: `// ADR-0017`, `// см. ADR-0002`.
- JSDoc-блок над экспортируемыми компонентами/функциями/интерфейсами (образец —
  [LvSearchInput.tsx](../../src/ui/components/common/LvSearchInput.tsx)).

## Обработка ошибок и async

- **async/await** везде; `Promise.all` для параллельных операций.
- **Возврат `null`** для «не получилось, но это не исключение» (`ParserRegistry.pickById`).
- **try/catch + throw** для синхронной валидации (`compileCustomParser`).
- **`void fn()`** для fire-and-forget, где результат не нужен, а отказ не критичен:
  `void chooseFolder()` ([LvAddSourceModal.tsx](../../src/ui/components/sidebar/LvAddSourceModal.tsx)).
- **`AbortError`** — не ошибка (отмена пользователем): проверяется по
  `err.name === 'AbortError'` и проглатывается.
- Ошибки доносятся до UI как состояние (`pickerError`, `form.error`) или через
  `SourceStatus { kind: 'error' }`, не через глобальные исключения.
