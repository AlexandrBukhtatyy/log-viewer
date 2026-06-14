# Backlog для хотелок — гибрид `docs/backlog/` + GitHub Issues с явным lifecycle

## Context

В проекте уже есть две формы фиксации работы — **ADR** (`docs/adr/`) для архитектурных решений и **plans** (`docs/plans/`) для конкретных реализаций. Между ними и «голым» CLAUDE.md/коммитами зияет дыра: куда писать «хорошо бы когда-нибудь сделать X»? Сейчас идеи теряются в чатах с Claude'ом и пользовательских заметках.

Цель: маленький лёгкий процесс, чтобы (1) идею можно было записать в репозиторий за минуту, (2) видеть прогресс по каждой идее (`proposed → planned → in-progress → done/dropped`), (3) поднимать «созревшую» идею в GitHub Issue для обсуждения / отслеживания работы. Канон — markdown-файл в репо; Issue — overlay для трекинга.

Выбраны (через AskUserQuestion): **гибрид backlog-файлы + GitHub Issues**, **lifecycle proposed → planned → in-progress → done/dropped**.

## Design

### `docs/backlog/` — структура

Папка зеркалит `docs/adr/`:

```
docs/backlog/
  0000-template.md         # шаблон, не учитывается в индексе
  README.md                # INDEX, секции по статусу
  NNNN-<kebab-slug>.md     # один файл = одна идея
```

Нумерация — 4-значная, монотонная, **не переиспользуется** (как в ADR). Slug — kebab-case, 3–6 английских слов сути идеи.

### Frontmatter и тело

```markdown
---
title: <one-line summary>
status: proposed # proposed | planned | in-progress | done | dropped
area: <freeform tag> # e.g. perf, ui, parsing, storage, dx — опционально
priority: med # low | med | high — опционально
created: YYYY-MM-DD
updated: YYYY-MM-DD
issue: <github-issue-url или пусто>
---

# NNNN. <Title>

## Context

Зачем это. Что сейчас неудобно/невозможно. 2–5 строк, не пиши историю мира.

## Outcome

Что считается «сделано». Чек-листом или нарративом. Чем конкретнее — тем
проще потом перейти из proposed в planned без переобсуждения.

## Notes

Ссылки на ADR, plans, related backlog, обсуждения в чате (важные цитаты),
PR'ы, причины дроп'а — всё, что не вписалось в Context/Outcome.
```

`status` — единственное обязательное поле lifecycle. Остальные (area/priority/issue) — best-effort, можно проставлять по мере созревания.

### Lifecycle

| Status        | Когда                                                          | Что обновляется                                               |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `proposed`    | Файл только что создан (через `/wish` или вручную)             | `status: proposed`, `created`, `updated`                      |
| `planned`     | Решено делать; обычно совпадает с заведением GitHub Issue      | `status: planned`, `issue: <url>`, `updated`                  |
| `in-progress` | Работа реально пошла (открыт PR / создан Plan в `docs/plans/`) | `status: in-progress`, `updated`, в Notes — ссылка на PR/plan |
| `done`        | Поставлено, PR merged                                          | `status: done`, `updated`, в Notes — ссылка на merged PR      |
| `dropped`     | Решили не делать                                               | `status: dropped`, `updated`, в Notes — короткое «почему»     |

Файлы со статусами `done` / `dropped` **остаются в `docs/backlog/`** — это история решений, искать «делали ли мы X» проще одним grep'ом по одной папке, чем перебором архивов.

### `docs/backlog/README.md` (INDEX)

Секционирован по статусу (как ADR README, но не плоским списком, а:):

```markdown
## In progress

- [NNNN. Title](NNNN-slug.md) — area, prio · [issue](https://github.com/…)

## Planned

- …

## Proposed

- …

## Done

- …

## Dropped

- …
```

Поддерживается вручную (как ADR). При записи через `/wish` команда добавляет запись в секцию `## Proposed`. При смене статуса пользователь (или `/wish-move`, если когда-нибудь напишем) переносит строку в нужную секцию.

### Slash-команда `/wish`

Новый файл `.github/.claude/commands/wish.md` (фактический путь — `.claude/commands/wish.md`), зеркалит `.claude/commands/adr.md`:

```
---
description: Создать новую запись в docs/backlog/ из контекста разговора
---
Создай новую запись-хотелку на основе текущего разговора и аргументов: $ARGUMENTS

1. Прочитай docs/backlog/0000-template.md.
2. Найди max NNNN среди docs/backlog/NNNN-*.md (исключая template). Следующий = max + 1, 4 знака.
3. Сгенерируй kebab-slug (3–6 слов английского).
4. Создай docs/backlog/NNNN-<slug>.md по шаблону с frontmatter:
   status: proposed, created/updated = сегодня (date +%Y-%m-%d), issue: пусто.
5. Заполни Context / Outcome / Notes из контекста разговора. Кратко.
6. Допиши запись в секцию `## Proposed` файла docs/backlog/README.md.
7. Сообщи путь markdown-ссылкой.

Важно: не редактируй другие файлы; не запускай билд/тесты/git.
```

Существующий `/adr` остаётся неизменным; `/wish` создаётся по той же конвенции, чтобы поведение было предсказуемым.

### GitHub Issues — overlay

- Issue заводится вручную через `gh issue create`, когда идея переходит `proposed → planned`. Никаких автоматических синков.
- В теле Issue первая строка: `Backlog: docs/backlog/NNNN-<slug>.md` — этим обеспечивается обратная ссылка.
- В backlog-файл вписывается `issue: <url>` в frontmatter.
- Опционально: `.github/ISSUE_TEMPLATE/wish.yml` с одним полем «ссылка на backlog-файл» — позже, если будет много контрибьюторов. Сейчас не нужен.

### CLAUDE.md и docs/README.md

В [CLAUDE.md](../../CLAUDE.md) — добавить короткий раздел `## Feature backlog`, аналогичный существующему про ADR. Один абзац: «куда писать хотелки», «как создать через `/wish`», ссылка на `docs/backlog/README.md`.

В [docs/README.md](../README.md) — добавить пункт `[backlog/](backlog/) — feature wishlist…`.

## Critical files

Переименование (первый шаг реализации):

- `docs/plans/binary-baking-clover.md` → `docs/plans/feature-backlog-workflow.md` (`git mv`, чтобы сохранить историю).

Новые:

- `docs/backlog/0000-template.md` — шаблон записи (frontmatter + Context/Outcome/Notes).
- `docs/backlog/README.md` — INDEX с пятью секциями по статусу + краткий how-to сверху.
- `.claude/commands/wish.md` — slash-команда, скопирована по структуре с [.claude/commands/adr.md](../../.claude/commands/adr.md).

Изменяемые:

- [CLAUDE.md](../../CLAUDE.md) — добавить раздел `## Feature backlog` (короткий, абзац-два, по образцу раздела `## Architecture Decision Records`).
- [docs/README.md](../README.md) — расширить `## Разделы` пунктом про backlog.

Опционально (не делаем в этом PR):

- `docs/adr/0024-feature-backlog-workflow.md` — задокументировать сам процесс как ADR. Полезно, потому что это явное архитектурное решение про process. Но не критично — если решим, добавим отдельно.
- `.github/ISSUE_TEMPLATE/wish.yml` — позже.

## Reuse / зеркало конвенций

Принципы заимствованы у уже работающей системы ADR ([docs/adr/README.md](../adr/README.md), [.claude/commands/adr.md](../../.claude/commands/adr.md)):

- 4-значная монотонная нумерация, никогда не переиспользуется.
- 0000-template.md как образец.
- README.md как INDEX, поддерживается руками (или slash-командой при создании).
- Slash-команда создаёт файл и обновляет INDEX.
- Не редактирует посторонние файлы, не делает git-операций.

Это даёт пользователю один paradigm для двух соседних артефактов (ADR vs backlog) и снижает когнитивную нагрузку.

## Verification

1. **Создание через slash-команду.** В chat'е: `/wish добавить кнопку экспорта в PNG`. Ожидаем:
   - Появился `docs/backlog/0001-<slug>.md` со status: proposed, заполненными Context/Outcome.
   - В `docs/backlog/README.md` под `## Proposed` появилась строка-ссылка.
   - Ответ Claude'а содержит markdown-ссылку на созданный файл.

2. **Поиск по статусу.**

   ```bash
   grep -lE '^status: in-progress' docs/backlog/*.md
   ```

   возвращает только активные идеи.

3. **Полный жизненный цикл вручную.** Берём свежий файл, меняем `status: proposed → planned`, вписываем `issue: https://github.com/…/issues/42`, переносим строку в README.md из `## Proposed` в `## Planned`. Затем `planned → in-progress` (Notes ← ссылка на PR), `in-progress → done` (Notes ← ссылка на merged PR). Файл остаётся; вся история — в diff'ах.

4. **README отрисовка.** Открыть `docs/backlog/README.md` на GitHub и в IDE-preview — пять секций видны, ссылки рабочие.

5. **`pnpm lint && pnpm build`** — формальная проверка, что изменения CLAUDE.md / docs/README.md ничего не сломали (они в .md, не должны).
