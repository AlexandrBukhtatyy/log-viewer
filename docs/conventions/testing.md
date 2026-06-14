# Тестирование

Фреймворк — **Vitest** ([vitest.config.ts](../../vitest.config.ts)):
`environment: 'node'`, `globals: false`, `include: ['src/**/*.{test,spec}.ts']`.

## Где и как

- Тесты лежат **рядом с кодом**: `foo.ts` → `foo.test.ts` в той же папке.
- `describe` / `it` / `expect` импортируются явно (globals выключены).
- Хелперы контекста (`makeCtx()`) и fixture-объекты — внутри тест-файла.

Образцы: [registry.test.ts](../../src/core/parsers/registry.test.ts),
[fingerprint.test.ts](../../src/core/util/fingerprint.test.ts),
[active-columns.test.ts](../../src/ui/utils/active-columns.test.ts).

## Команды

- `pnpm test` — однократный прогон (CI и локально).
- `pnpm test:watch` — интерактивно.
- `pnpm gen:fixtures` — sample-логи в `.tmp/` (детерминированный seed) для ручной
  проверки парсеров и виртуального скролла.

## Что покрываем

- ✅ core: парсеры, фильтры, утилиты, fingerprint, RPC-контракты.
- ❌ React-компоненты и хуки юнит-тестами **не покрыты** — осознанный пробел; UI
  проверяется вручную / через Playwright (см. [CLAUDE.md](../../CLAUDE.md) →
  Debug-артефакты).

Тесты гоняются в CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) — см.
[tooling.md](tooling.md).
