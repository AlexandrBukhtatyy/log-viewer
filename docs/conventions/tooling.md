# Тулинг и качество

## ESLint

Flat config [eslint.config.js](../../eslint.config.js): пресеты `@eslint/js`,
`typescript-eslint`, `eslint-plugin-react-hooks`, `react-refresh`. `eslint-config-prettier`
стоит **последним** (форматирование — за Prettier).

Ключевое: **границы слоёв** (ADR 0002/0003/0004) закодированы как
`@typescript-eslint/no-restricted-imports` по слоям — нельзя, например, импортнуть `hooks`
в `ui/components`. Запуск: `pnpm lint`.

## Prettier

Конфиг [.prettierrc.json](../../.prettierrc.json) (`singleQuote`, `semi`,
`trailingComma: all`, `printWidth: 80`); исключения —
[.prettierignore](../../.prettierignore). `pnpm format` форматирует, `pnpm format:check`
проверяет (в CI).

## Git-хуки (husky)

- `pre-commit` → `lint-staged`: на staged-файлах `eslint --fix` + `prettier --write`.
- `commit-msg` → `commitlint` (config-conventional + тип `deps`, см.
  [commitlint.config.js](../../commitlint.config.js)).

## Типы

`pnpm typecheck` (`tsc -b`) и внутри `pnpm build`. Project references: `tsconfig.json` →
`tsconfig.app.json` + `tsconfig.node.json`.

## CI

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) на PR и push в `main`:
install → `format:check` → `lint` → `test` → `build`. Деплой — отдельный
[deploy.yml](../../.github/workflows/deploy.yml).

## Зависимости

pnpm (`packageManager` в package.json, `corepack enable pnpm`), Node ≥ 20. Обновления —
[Dependabot](../../.github/dependabot.yml) (weekly; npm + github-actions; CC-префиксы
`deps` / `ci`).

## Прочее

- PWA — `vite-plugin-pwa` ([vite.config.ts](../../vite.config.ts)).
- Fixtures — `pnpm gen:fixtures` → `.tmp/`. Debug-артефакты — в `.tmp/` (CLAUDE.md).

## Осознанные пробелы

- **`strict: true` в tsconfig не включён** — есть `noUnusedLocals/Parameters` +
  `verbatimModuleSyntax`; полный strict можно включить отдельной задачей (потребует
  правок типов).
- **Нет UI-юнит-тестов** — компоненты/хуки проверяются вручную / Playwright.
