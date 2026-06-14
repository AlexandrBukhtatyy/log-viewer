# 0032. Quality tooling: Prettier, git-хуки, CI-gate, Dependabot

- Status: proposed
- Date: 2026-06-14

## Context and Problem Statement

В проекте были ESLint (с layer-границами, ADR 0002) и Vitest, но отсутствовали: единый
форматтер, авто-проверки перед коммитом, прогон проверок в CI и автообновление
зависимостей. Стиль держался вручную, lint/test/build не были gate'ом для PR
([deploy.yml](../../.github/workflows/deploy.yml) только собирал), Conventional Commits
не проверялись автоматически.

## Considered Options

- Option A — Полный набор: Prettier (+ eslint-config-prettier), husky + lint-staged +
  commitlint, CI-workflow с проверками, Dependabot.
- Option B — Точечно: только Prettier, без хуков и CI.
- Option C — do nothing: ручная дисциплина (CONTRIBUTING требует прогонять проверки перед
  PR вручную).

## Decision Outcome

Chosen option: **"Option A"**, because автоматизация качества дешевле ручной дисциплины и
не зависит от внимательности: формат единый и машинный, ошибки ловятся до merge, формат
коммитов гарантирован для release-please.

Состав:

- **Prettier** ([.prettierrc.json](../../.prettierrc.json)); `eslint-config-prettier`
  отключает форматные правила ESLint (стоит последним в
  [eslint.config.js](../../eslint.config.js)). Скрипты `format` / `format:check`.
- **husky** git-хуки: `pre-commit` → `lint-staged` (eslint --fix + prettier на
  staged-файлах); `commit-msg` → `commitlint`.
- **commitlint** ([commitlint.config.js](../../commitlint.config.js)): config-conventional
  - кастомный тип `deps` (есть в CONTRIBUTING.md, нет в пресете).
- **CI** ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) на PR/push:
  format:check → lint → test → build.
- **Dependabot** ([.github/dependabot.yml](../../.github/dependabot.yml)): weekly,
  npm + github-actions, CC-префиксы `deps` / `ci`.

Документация практик — в [docs/conventions/tooling.md](../conventions/tooling.md).

### Consequences

- Good: единый машинный стиль; ошибки ловятся до merge и до коммита; формат коммитов
  гарантирован; зависимости обновляются автоматически.
- Bad: чуть тяжелее локальный коммит (хуки); +6 devDependencies; разовый большой
  `style:`-diff от форматирования всей базы.
- Neutral: `strict: true` в TS сознательно не включали (отдельная задача); UI-юнит-тестов
  по-прежнему нет.

## Links

- Свод тулинга: [docs/conventions/tooling.md](../conventions/tooling.md)
- Процесс / коммиты: [CONTRIBUTING.md](../../CONTRIBUTING.md)
- Связанный ADR: [0026. Release Please + Conventional Commits](0026-release-please-and-conventional-commits.md)
