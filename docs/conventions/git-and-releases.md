# Git и релизы

Источник истины по процессу — [CONTRIBUTING.md](../../CONTRIBUTING.md). Здесь — выжимка.

## Conventional Commits

Формат: `<type>(<scope>)?: <subject>`. Типы: `feat`, `fix`, `perf`, `refactor`, `docs`,
`deps`, `build`, `ci`, `chore`, `test`, `style`, `revert`. Заголовок ≤ 70, императив, без
точки. Тело объясняет _почему_. BREAKING — `feat!:` или футер `BREAKING CHANGE:`.

Формат проверяется автоматически (commitlint в `commit-msg`-хуке — см.
[tooling.md](tooling.md)).

## Ветки и PR

- Ветка/форк от `main`.
- Перед PR локально зелёные: `pnpm format:check && pnpm lint && pnpm test && pnpm build`
  (то же гоняет [CI](../../.github/workflows/ci.yml)).

## Релизы (release-please)

- На push в `main` release-please открывает PR `chore(main): release X.Y.Z` с бампом
  версии и CHANGELOG. Merge → тег `vX.Y.Z` + деплой.
- **Не править вручную** `package.json:version`, `CHANGELOG.md`,
  `.release-please-manifest.json`.
- 0.x semver: `feat:` → patch, BREAKING → minor. ADR
  [0026](../adr/0026-release-please-and-conventional-commits.md).

## ADR

Архитектурные решения — в [docs/adr/](../adr/) (`/adr <описание>` создаёт следующий
номер). Когда заводить — см. [docs/adr/README.md](../adr/README.md).
