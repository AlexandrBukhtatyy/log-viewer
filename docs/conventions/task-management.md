# Управление задачами

Задачи ведутся в [GitHub Projects → Log Viewer](https://github.com/users/AlexandrBukhtatyy/projects/1). Здесь — выжимка для контрибьюторов. Источник истины по формату тела — шаблон [.github/ISSUE_TEMPLATE/task.md](../../.github/ISSUE_TEMPLATE/task.md); операционные детали (gh CLI, GraphQL для полей доски) — в [CLAUDE.md](../../CLAUDE.md), раздел «Управление задачами».

## GitHub Issues как единица

- Каждая задача — реальный GitHub Issue (не draft): линкуется с PR/коммитами через `closes #N` и виден в репозитории.
- Label `enhancement` — для фич. Баги/идеи собираются в [Discussions](https://github.com/AlexandrBukhtatyy/log-viewer/discussions) и при созревании конвертируются в Issue.

## Поля доски

Метаданные живут **полями Project**, не в теле Issue:

- **Status:** `Backlog → Planned → In progress → Done / Dropped`
- **Area:** `perf`, `ui`, `parsing`, `storage`, `dx`, `formats`, `ai`
- **Priority:** `low`, `med`, `high`

## Оформление Issue

Бери шаблон ([`gh issue create --template task.md`](../../.github/ISSUE_TEMPLATE/task.md)) или заполняй по канону:

- **Заголовок** — императив без точки в конце (как commit subject): `Filter import/export`, `Column-click sort`. Эпик — префикс `[Epic]: <название>`.
- **Тело** — 1–2 абзаца «что и зачем» (суть, проблема, ожидаемый результат). По применимости:
  - `## Объём` — для крупных задач, список «Входит / Не входит».
  - `## Ветки работ` — только для эпиков, подзадачи каждая со своей строкой `Plan:`.
- **Метаданные (Area / Priority / Status) в тело не пишем** — только полями доски.

## Связь с планами

Крупная задача → детальный план в [docs/plans/](../plans/)`<slug>.md` (разделы Context / Design / Critical files / Verification). Ссылка из тела Issue — футер-строкой `Plan: docs/plans/<slug>.md`; часть эпика — строкой `Часть эпика #N`.

## Откуда задачи

- Мейнтейнер заводит Issue напрямую.
- Созревший тред из [Discussions](https://github.com/AlexandrBukhtatyy/log-viewer/discussions) → «Create issue from discussion» → на доску (Projects v2 не принимает Discussion как элемент).

## Ссылки

- Трекер: [GitHub Projects](https://github.com/users/AlexandrBukhtatyy/projects/1) · публичный обзор — [docs/ROADMAP.md](../ROADMAP.md)
- Формат тела (источник истины): [.github/ISSUE_TEMPLATE/task.md](../../.github/ISSUE_TEMPLATE/task.md)
- Операционка (gh/GraphQL): [CLAUDE.md](../../CLAUDE.md) → «Управление задачами»
