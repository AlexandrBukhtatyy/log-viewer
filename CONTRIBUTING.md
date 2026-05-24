# Contributing to Log Viewer

Спасибо за интерес. Этот документ — короткая навигация: куда писать идеи, как запустить проект локально, какие правила соблюдаются в коммитах, ADR и плагинах.

## Связаться

- **Баги, идеи, вопросы** — [GitHub Issues](https://github.com/aleksandrbuhtatyj/log-viewer/issues).
- **Roadmap** — [docs/ROADMAP.md](docs/ROADMAP.md).

## Запуск локально

Нужны:
- **pnpm** (требуется, см. [CLAUDE.md](CLAUDE.md)). Если нет: `corepack enable pnpm`.
- **Node 20+** (тестировалось на 24).

```bash
pnpm install                  # один раз после клона
pnpm dev                      # http://localhost:5173/log-viewer/
pnpm test                     # vitest run (один прогон)
pnpm lint                     # eslint flat config
pnpm build                    # prod-сборка → dist/
pnpm preview                  # проверка prod-сборки локально
pnpm gen:fixtures             # сгенерировать .tmp/demo_logs c sample-логами
```

## Структура

- `src/core/` — типы, парсеры, фильтр, storage; без React и worker'ов.
- `src/workers/` — coordinator, indexer, parser pool.
- `src/worker-client/` — Comlink-обёртка для main thread.
- `src/hooks/` — React-хуки (zustand stores, контейнерные хуки).
- `src/ui/` — React-компоненты (sidebar, stream, panels, modals).
- `src/app/` — провайдеры и контейнеры верхнего уровня.
- `app/index.html` — demo-страница (`/log-viewer/app/`).
- `index.html` — лендинг (`/log-viewer/`).
- `docs/adr/` — Architecture Decision Records.
- `docs/plans/` — планы реализации фич.

Подробный обзор — [CLAUDE.md](CLAUDE.md).

## Архитектурные решения (ADR)

Любое нетривиальное архитектурное решение (выбор библиотеки, схема хранения, контракт между модулями) фиксируется как **ADR** в [docs/adr/](docs/adr/). Полная политика — [docs/adr/README.md](docs/adr/README.md).

Как создать:
- Скопируй [docs/adr/0000-template.md](docs/adr/0000-template.md), назови `NNNN-<kebab-slug>.md`, дополни запись в `## Index` файла `docs/adr/README.md`.
- Используй `proposed` как статус по умолчанию.

## Планы для крупных задач

Большие фичи начинаются с маленького плана в [docs/plans/](docs/plans/) — пара экранов с разделами **Context / Design / Critical files / Verification**. Это позволяет обсудить подход до того, как набьются 800 строк кода. Готовые планы остаются как «как мы это делали»-документ.

## Стиль коммитов

С релиза 0.1.0 (2026-05-24) проект использует [Conventional Commits 1.0](https://www.conventionalcommits.org/) — на их основе [release-please](https://github.com/googleapis/release-please) автоматически бампит версию и наполняет [CHANGELOG.md](CHANGELOG.md). Все новые коммиты в `main` должны соответствовать формату.

Формат:

```
<type>(<scope>)?: <subject>

<body>

<footer>
```

- **Заголовок** — `≤ 70 символов`, императив, без точки в конце.
- **Типы** — `feat`, `fix`, `perf`, `refactor`, `docs`, `deps`, `build`, `ci`, `chore`, `test`, `style`, `revert`.
- **Scope** — опционально (модуль/подсистема: `sidebar`, `parsers/pino`, `worker`, `pwa`, ...).
- **BREAKING CHANGE** — либо `!` после типа (`feat(api)!: drop legacy filter shape`), либо футер `BREAKING CHANGE: <описание>`.
- **Тело** — почему, а не что. Объясняй мотивацию и неочевидные trade-off'ы.
- **Один логический change per commit.** Большие пачки несвязанных правок — нет.
- **Ссылки на ADR** — футером `Refs: ADR-0022` (или `Closes: #123` для issue).

## Релизы

- Версионирование — [semver](https://semver.org/).
- На каждый push в `main` release-please открывает PR `chore(main): release X.Y.Z` с обновлённым `package.json:version` и записями в `CHANGELOG.md`. Merge PR → создаётся тег `vX.Y.Z` и GitHub Release, после чего деплой на Pages запускается автоматически (см. [.github/workflows/](.github/workflows/)).
- На pre-1.0 (`0.x`) кадензa мягкая: `feat:` даёт patch (0.1.0 → 0.1.1), `feat!:`/`BREAKING CHANGE` — minor (0.1.0 → 0.2.0). После 1.0 заработает классический semver.
- **Никаких ручных тегов и ручной правки `package.json:version` или `CHANGELOG.md`.** Единственное исключение — seed-запись `[0.1.0]`, уже зафиксированная в `CHANGELOG.md`.

## Тесты

- Юнит-тесты — vitest, рядом с кодом (`*.test.ts`).
- Для UI-багов перед PR прогоняем dev-сервер и проверяем сценарий вручную (или Playwright-сценарием в `.tmp/`).
- В PR обязательно: `pnpm test && pnpm lint && pnpm build` — без новых ошибок.

## Диаграммы и документация

- Все схемы — **Mermaid** в fenced-блоке ` ```mermaid `. Никаких PNG/SVG-схем, никакого ASCII-арта.
- Скриншоты для PR/документации — в `docs/assets/` (проходят review).
- Ad-hoc дампы и времянки — в `.tmp/` (этот каталог в `.gitignore`).

## Pull request

1. Форк или ветка от `main`.
2. Маленькие коммиты по теме.
3. Описание PR: ссылка на issue / ADR / план (если применимо), сценарий проверки.
4. Жди review.

Если PR блокирует pre-commit hook (`adr-reminder.sh` напомнит про ADR при архитектурных правках) — поправь причину, не выключай хук флагом `--no-verify`.
