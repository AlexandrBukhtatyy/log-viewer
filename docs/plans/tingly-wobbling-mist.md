# Правила оформления задач в GitHub Projects (человеко-ориентированный свод)

## Context

Прошлым шагом введён единый формат тела Issue: шаблон [.github/ISSUE_TEMPLATE/task.md](../../.github/ISSUE_TEMPLATE/task.md), [config.yml](../../.github/ISSUE_TEMPLATE/config.yml) и канон в [CLAUDE.md](../../CLAUDE.md) (раздел «Управление задачами» → «Формат тела Issue»). Но всё это **AI-facing**: правила оформления задач лежат в CLAUDE.md, которую контрибьюторы-люди не читают. В своде [docs/conventions/](../conventions/) темы «управление задачами» нет вообще — её нет ни в «Разделах», ни в таблице «Граница ответственности», хотя по смыслу это «процесс», как коммиты/релизы.

Цель: завести человеко-ориентированный свод правил оформления задач в нужном месте (`docs/conventions/`), встроить его в индекс конвенций и дать указатель из CONTRIBUTING.md — чтобы контрибьютор нашёл правила, не заглядывая в CLAUDE.md.

Согласованные решения:

- **Размещение** — новый `docs/conventions/task-management.md` (канон) + короткий указатель из CONTRIBUTING.md («Оба: канон + выжимка»).
- **Глубина** — это **выжимка**, указывающая на источники истины, как [git-and-releases.md](../conventions/git-and-releases.md) → CONTRIBUTING.md. Полные операционные детали (gh/GraphQL, точный скелет тела) остаются в CLAUDE.md и `task.md`; новый файл на них ссылается, не дублируя.

## Critical files

**Новый:**

- `docs/conventions/task-management.md` — в стиле остальных конвенций (краткий, со ссылками на источник истины). Структура секций:
  - вводный абзац: задачи ведутся в [GitHub Projects → Log Viewer](https://github.com/users/AlexandrBukhtatyy/projects/1); источники истины по формату — `task.md` и CLAUDE.md.
  - **GitHub Issues как единица** — реальные Issues (не draft), label `enhancement` для фич, связь с PR/коммитами `closes #N`.
  - **Lifecycle и поля доски** — `Status` (`Backlog → Planned → In progress → Done / Dropped`), `Area` (perf, ui, parsing, storage, dx, formats, ai), `Priority` (low, med, high).
  - **Оформление Issue** — заголовок (императив без точки; эпик — `[Epic]:`), тело (1–2 абзаца «что и зачем»; опц. `## Объём`, `## Ветки работ`); метаданные Area/Priority/Status — **только полями доски**. Точный скелет — в [task.md](../../.github/ISSUE_TEMPLATE/task.md), не повторяем.
  - **Связь с планами** — крупная задача → [docs/plans/](../plans/)`<slug>.md`, футер `Plan: …`; часть эпика → `Часть эпика #N`.
  - **Откуда задачи** — мейнтейнер заводит напрямую; созревшие треды из [Discussions](https://github.com/AlexandrBukhtatyy/log-viewer/discussions) конвертируются в Issue.
  - **Источники истины / ссылки** — `task.md` (формат), CLAUDE.md «Управление задачами» (операционка gh/GraphQL), [ROADMAP.md](../ROADMAP.md), Discussions.

**Изменяемые:**

- [docs/conventions/README.md](../conventions/README.md):
  - в таблицу «Граница ответственности» добавить строку про управление задачами (источник — `task-management.md`);
  - в список «Разделы» добавить пункт `[task-management.md](task-management.md) — оформление задач в GitHub Projects`.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — рядом с уже имеющимся упоминанием Projects/трекера добавить одну строку-указатель на `docs/conventions/task-management.md` («как оформлять задачи»).
- [CLAUDE.md](../../CLAUDE.md) — в раздел «Управление задачами» добавить один cross-link: человеческая выжимка — `docs/conventions/task-management.md` (двунаправленный discovery; CLAUDE.md остаётся операционным источником истины).

## Не делаем

- Не переписываем CLAUDE.md «Управление задачами» — он остаётся источником истины, дублирования избегаем ссылками.
- Не трогаем `docs/plans/roadmap-process.md` (черновик процесса) — отдельная тема.
- Backfill существующих Issues не входит.

## Verification

1. `docs/conventions/task-management.md` рендерится; все относительные ссылки (`task.md`, CLAUDE.md, ROADMAP.md, plans/, Discussions) валидны.
2. В [docs/conventions/README.md](../conventions/README.md) новый файл виден в «Разделах» и в таблице ответственности.
3. Из CONTRIBUTING.md есть переход к своду; из CLAUDE.md — обратный cross-link.
4. Нет дублирования метаданных/скелета тела: детали формата только в `task.md`, операционка только в CLAUDE.md — свод ссылается.
5. Коммит в Conventional Commits (`docs: …`), только релевантные файлы (без `docs/plans/`). Push — по явной команде.
