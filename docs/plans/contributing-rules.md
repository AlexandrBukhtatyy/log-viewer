# Формализация правил контрибутинга

## Context

Сейчас в репозитории есть [CONTRIBUTING.md](../../CONTRIBUTING.md) — короткая навигация (как запустить, структура, политика ADR/коммитов). Этого достаточно для соло-разработки, но мало для внешних контрибьюторов: нет issue/PR templates, нет регламента code-review, нет описания процесса для крупных идей, нет release-процесса.

Цель: дофиксировать правила так, чтобы человек со стороны мог открыть Issue или PR без догадок «а как у вас принято».

## Scope (черновик — обсудить)

Что должно появиться или развернуться:

1. **GitHub issue templates** (`.github/ISSUE_TEMPLATE/`):
   - `bug_report.yml` — поля: воспроизведение, ожидаемое vs фактическое, версия, окружение, console-вывод.
   - `feature_request.yml` — поля: проблема, предложение, alternatives. С label `idea`.
   - `parser_request.yml` (отдельно?) — для запросов на новые форматы логов.

2. **Pull request template** (`.github/pull_request_template.md`):
   - Что меняется и почему.
   - Связь с ADR/Plan/Issue.
   - Чек-лист: тесты, lint, build, ADR (если архитектурное), screenshots для UI.

3. **Code-review checklist** в `CONTRIBUTING.md`:
   - Соответствует ли код paradigm (no new deps without ADR, no PNG-схемам, …).
   - Поведение покрыто тестом / smoke-чеком.
   - Нет ли регрессии по существующим сценариям.
   - Не нарушает ли layer-rules ([ADR-0002](../adr/0002-headless-architecture.md)).

4. **Процесс крупных изменений (RFC)**:
   - Что считается «крупным» — конкретный список (новый адаптер, schema-migration, переход на другой парсер-движок).
   - Шаг 1: создать `docs/plans/<slug>.md` с разделами Context/Design/Critical files/Verification.
   - Шаг 2: открыть discussion-issue со ссылкой на план.
   - Шаг 3: дождаться согласования → PR на реализацию с обновлением плана статусом `accepted`.

5. **Branch naming + commit conventions**:
   - Ветки: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` — обсудить, нужно ли строго.
   - Коммиты — уже описаны в CONTRIBUTING.md, можно дополнить примерами и анти-паттернами.

6. **Release / changelog**:
   - Используем ли GitHub Releases? Если да — что туда попадает (только архитектурные ADR + крупные фичи / всё).
   - Файл `CHANGELOG.md` — keep-a-changelog или auto-generated по commit-messages.

7. **Code of conduct?** — для open-source это считается must-have. Минимальный шаблон Contributor Covenant.

## Подход (предварительный)

Реализация по двум волнам:

**Волна 1 — обязательный минимум.** Заводим в `.github/`:

- `ISSUE_TEMPLATE/bug_report.yml`
- `ISSUE_TEMPLATE/feature_request.yml`
- `pull_request_template.md`

Расширяем `CONTRIBUTING.md`:

- Секция «Code review checklist».
- Секция «RFC process for big changes» со ссылкой на `docs/plans/`.
- Примеры хороших / плохих commit-сообщений.

**Волна 2 — после первого внешнего контрибутора.**

- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1).
- `CHANGELOG.md` (формат и автоматизация).
- Возможно label-разметка issue/PR (auto через `.github/labeler.yml`).

## Critical files (предварительно)

Новые:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/pull_request_template.md`
- `CODE_OF_CONDUCT.md` (волна 2)
- `CHANGELOG.md` (волна 2)

Изменяются:

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — добавить секции «Code review checklist», «RFC process», «Branch naming», ссылки на новые templates.
- [docs/ROADMAP.md](../ROADMAP.md) — после волны 2 указать «Open-source readiness» как завершённый пункт.

## Verification

1. Открыть New Issue на GitHub → видны два шаблона (bug / feature), оба содержат осмысленные поля.
2. Открыть New PR → автоматически подставляется PR-template с чек-листом.
3. Соло-разработчик может пройти CONTRIBUTING.md сверху вниз и ответить себе: «как мне предложить большую идею?» — ответ есть (через `docs/plans/`).
4. Code-review checklist в `CONTRIBUTING.md` явный, маркированный список — можно использовать как self-review перед merge.
5. (Волна 2) Релиз → CHANGELOG.md содержит новую запись.
