# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PWA для просмотра логов. SPA на React 19 + TypeScript, собирается на Vite 8.
Service worker и Web App Manifest генерируются `vite-plugin-pwa` (Workbox под капотом).
Проект только что инициализирован — реальной функциональности log viewer'а ещё нет, есть только скелет от Vite-шаблона `react-ts` и PWA-обвязка.

## Tooling

- **Package manager:** pnpm (требуется). Если не установлен: `corepack enable pnpm`.
- **Node:** 20+ (разрабатывался на 24).
- **jq:** нужен для Stop-hook'а ADR-напоминалки ([.claude/hooks/adr-reminder.sh](.claude/hooks/adr-reminder.sh)). Если не установлен — `brew install jq`. Без `jq` хук просто молчит, ADR-практика остаётся в силе через `/adr` и политику ниже.

## Команды

```bash
pnpm dev           # vite dev-server, http://localhost:5173, PWA включена через devOptions.enabled
pnpm build         # tsc -b && vite build → dist/ (включая sw.js, manifest.webmanifest)
pnpm preview       # vite preview, http://localhost:4173 — для проверки prod-сборки локально
pnpm lint          # ESLint (flat config)
pnpm format        # Prettier — отформатировать весь проект
pnpm format:check  # Prettier — проверка форматирования (гоняется в CI)
pnpm gen:fixtures  # перегенерировать .tmp/ — sample-логи разных форматов для локальной проверки viewer'а
```

Тестового фреймворка нет — есть Vitest как dev-зависимость, гоняется через `pnpm test` / `pnpm test:watch` (см. `package.json`).

## Локальные фикстуры

Скрипт [scripts/gen-fixtures.mjs](scripts/gen-fixtures.mjs) (`pnpm gen:fixtures`) пишет в `.tmp/` набор детерминированных sample-логов под форматы, которые умеет парсер. Каталог в `.gitignore`, файлы воспроизводятся из фиксированного seed.

Что там:

- `pino.jsonl` — pino-style JSON Lines (числовые `level`, `time` в ms, поле `err`).
- `bunyan.jsonl` — JSON Lines с ISO `@timestamp` и текстовыми `level` (`INFO`/`WARN`/…), плюс `traceId`/`spanId`.
- `app.log` — plain-text `[ISO] LEVEL [service] message k=v`.
- `mixed.log` — plain-text + JSON в одном файле (проверка `parseAny`-fallback'а в [src/core/parsers/registry.ts](src/core/parsers/registry.ts)).
- `nginx-access.log` — Apache/Nginx combined log format.
- `stack-traces.log` — многострочные Java/Python tracebacks вперемешку с обычными строками.
- `large.jsonl` — ~50k pino-строк (~6.5 MB), нагрузочная проверка virtual scroll и индексации.

Если для нового парсера/адаптера нужен ещё формат — добавляй ещё один генератор в этот скрипт, не плоди отдельные ad-hoc файлы вне `.tmp/`.

## Debug-артефакты

Любые временные файлы, которые ты создаёшь по ходу отладки — Playwright-скриншоты, дампы JSON-ответов, выгрузки логов воркера, ad-hoc заметки — кладутся в [.tmp/](.tmp/) (`.gitignore`-нутый):

- **Скриншоты** (Playwright `browser_take_screenshot`, любые `*.png/*.jpg`) — в [`.tmp/screenshots/`](.tmp/screenshots/).
- **Прочее** (JSON-дампы, текстовые выгрузки, заметки) — в `.tmp/` напрямую или в логически именованных подкаталогах.

В корне репозитория ничего не оставляй: для подстраховки `/*.png /*.jpg /*.jpeg` тоже игнорятся, но это safety-net, а не место хранения.

UI-скриншоты, которые **должны** попасть в git (для PR-описаний, ADR-иллюстраций и т.п.), идут в `docs/assets/` — они проходят review.

## Архитектура

Multi-page Vite-сборка с двумя HTML-entry:

- [index.html](index.html) — статический **лендинг** (без React, без PWA-JS), отдаётся на `/log-viewer/`. Inline-стили, одна ссылка-CTA `app/`.
- [app/index.html](app/index.html) — entry самой **демки**, отдаётся на `/log-viewer/app/`. Подключает `/src/main.tsx`.
- [src/main.tsx](src/main.tsx) — точка входа демки, монтирует `<App />` в `#root`.
- [src/App.tsx](src/App.tsx) — корневой компонент.

PWA `manifest.scope = /log-viewer/app/` — install-prompt появляется только на демо-странице, лендинг остаётся обычной web-страницей. `workbox.navigateFallback` = `/log-viewer/app/index.html`, **deny-list** исключает `/log-viewer/` и `/log-viewer/index.html`, чтобы SW не подменял лендинг на демо.

PWA-слой:

- [vite.config.ts](vite.config.ts) — конфиг `VitePWA({ registerType: 'autoUpdate', injectRegister: 'auto', ... })`. SW регистрируется автоматически через виртуальный модуль плагина — вручную ничего регистрировать не нужно.
- [public/](public/) — иконки `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`. Это **одноцветные PNG-заглушки**, сгенерированные [scripts/gen-icons.mjs](scripts/gen-icons.mjs) без внешних зависимостей. При замене на реальные иконки — либо положить вручную с теми же именами, либо переписать скрипт/использовать `@vite-pwa/assets-generator`.
- В dev-режиме SW и манифест отдаются через `/dev-sw.js?dev-sw` и `/manifest.webmanifest`; артефакты dev-сборки попадают в `dev-dist/` (не в `.gitignore` сейчас — добавить, если будут коммиты).

TypeScript:

- Project references: [tsconfig.json](tsconfig.json) → [tsconfig.app.json](tsconfig.app.json) (src) + [tsconfig.node.json](tsconfig.node.json) (vite.config). Типы PWA подключены через `"types": ["vite/client", "vite-plugin-pwa/client"]` в `tsconfig.app.json`.

ESLint: flat config ([eslint.config.js](eslint.config.js)), `dist` в globalIgnores.

## Architecture Decision Records

Все нетривиальные архитектурные решения фиксируются как ADR в [docs/adr/](docs/adr/). Полный гайд для разработчиков — в [docs/adr/README.md](docs/adr/README.md).

**Когда фиксировать:**

- Выбор библиотеки/фреймворка (state, routing, parsing, storage).
- Выбор/смена архитектурного паттерна (Web Worker для парсинга, virtual scrolling, схема IndexedDB и т.п.).
- Отказ от очевидного решения с обоснованием.
- Контракт между модулями, на который будем ссылаться.
- Любое решение, на которое будем ссылаться через 3+ месяца.

**Что НЕ фиксировать:** рутинные правки кода, стилевые рефакторинги, багфиксы, semver-обновления зависимостей.

**Как:**

- Слэш-команда `/adr <короткое описание>` — создаст следующий по номеру файл `docs/adr/NNNN-<slug>.md` из контекста разговора и обновит индекс в `docs/adr/README.md`.
- Вручную: скопировать [docs/adr/0000-template.md](docs/adr/0000-template.md), назвать `NNNN-<kebab-slug>.md`, не забыть дописать запись в секцию `## Index` файла [docs/adr/README.md](docs/adr/README.md).
- Статус по умолчанию — `proposed`.

**При сомнении — создавать.** Лишний ADR дешевле потерянного решения.

Stop-hook ([.claude/hooks/adr-reminder.sh](.claude/hooks/adr-reminder.sh)) напомнит, если в ответе модели похоже принято архитектурное решение, но `docs/adr/` в этой сессии не обновлялся.

## Управление задачами

Задачи ведутся в **GitHub Projects** — доска [Log Viewer](https://github.com/users/AlexandrBukhtatyy/projects/1) (owner `AlexandrBukhtatyy`, project `#1`). Это ведущий трекер: «что делаем сейчас, что следующее, что решили не делать». Работа с ней — через `gh` CLI (нужен scope `project`; `gh project …`, для редактирования опций single-select-полей — `gh api graphql`).

- **Карточки — реальные GitHub Issues** (label `enhancement` для фич). Draft-задачи не используем: Issue линкуется с PR/коммитами (`closes #N`) и виден в репозитории.
- **Lifecycle (поле Status):** `Backlog → Planned → In progress → Done / Dropped`. Доп. поля: `Area` (perf, ui, parsing, storage, dx, formats, ai) и `Priority` (low, med, high).
- **Связь с планами:** крупная задача → детальный план в [docs/plans/](docs/plans/), ссылка из тела Issue строкой `Plan: docs/plans/<slug>.md`.
- **Откуда задачи:** мейнтейнер заводит Issue напрямую; обсуждения из [GitHub Discussions](https://github.com/AlexandrBukhtatyy/log-viewer/discussions) (Bug Reports, Ideas & Feature Requests) при созревании конвертируются в Issue («Create issue from discussion») и кладутся на доску — Projects v2 не принимает Discussion как элемент.
- [docs/ROADMAP.md](docs/ROADMAP.md) — тонкий указатель на доску, не дублирующий список задач; в нём не плодить плоские to-do.

**Формат тела Issue.** Единый для всех задач — источник истины — markdown-шаблон [.github/ISSUE_TEMPLATE/task.md](.github/ISSUE_TEMPLATE/task.md). Заводя Issue через `gh`, бери его (`gh issue create --template task.md`) либо заполняй тело по канону:

- **Заголовок** — императив без точки в конце (как commit subject): `Filter import/export`, `Column-click sort`. Эпик — префикс `[Epic]: <название>`.
- **Тело** — 1–2 абзаца «что и зачем» (суть, проблема, ожидаемый результат). Дальше по применимости:
  - `## Объём` (для крупных задач) — список «Входит / Не входит».
  - `## Ветки работ` (только для эпиков) — подзадачи, каждая со своей строкой `Plan:`.
  - футер-строки `Plan: docs/plans/<slug>.md` (если есть план) и `Часть эпика #N` (если входит в эпик).
- **Метаданные Area / Priority / Status — только полями доски Project**, в тело не дублируем.

Веб-путь: «пустой» Issue отключён ([config.yml](.github/ISSUE_TEMPLATE/config.yml)), баги/идеи уводятся в Discussions.

## Documentation

- Вся документация живёт в [docs/](docs/) и markdown-файлах в корне (`README.md`, `CLAUDE.md`, ADR).
- **Инженерные практики** — свод в [docs/conventions/](docs/conventions/): code style, TypeScript, React/state, CSS, тесты, тулинг, git. Сверяйся перед написанием кода.
- **UI/UX-конвенции** — в [docs/conventions/ui-conventions.md](docs/conventions/ui-conventions.md). Сверяйся перед вёрсткой UI: подписанные поля форм — только через компонент `<LvFormField>` ([src/ui/components/common/LvFormField.tsx](src/ui/components/common/LvFormField.tsx)); модалки — лейбл слева, узкие панели — сверху.
- **Куда что фиксировать:** визуальные/поведенческие UI-правила → [docs/conventions/ui-conventions.md](docs/conventions/ui-conventions.md); кодовые/архитектурные решения и контракты → ADR в [docs/adr/](docs/adr/); общие практики «как писать код» → [docs/conventions/](docs/conventions/).
- **Диаграммы — только Mermaid**, в fenced-блоке ` ```mermaid ... ``` `. Никаких PNG/SVG-схем, никакого ASCII-арта. Mermaid рендерится на GitHub и в IDE-превью, версионируется как текст, ревьюится в diff'е.
- Если в ответе пользователю или в PR-описании уместна диаграмма — тоже Mermaid.
- Растровые ассеты (скриншоты UI, фото) допустимы в `docs/assets/`.

## Рабочий процесс с Claude Code

- **Коммит после каждой завершённой под-задачи** — Claude Code коммитит автономно по ходу работы (самодостаточный кусок: новый компонент, миграция файла, группа конфигов, фикс), не дожидаясь явной команды. Гранулярность — под-задача, не каждый файл и не вся задача целиком. `git add` только релевантных файлов — без `docs/plans/` и `.tmp/`-артефактов.
- **`git push` — только по явной команде**; локальные коммиты копятся до запроса.
- Формат коммитов и git-хуки — см. «Версионирование и релизы» ниже и [docs/conventions/tooling.md](docs/conventions/tooling.md).

## Версионирование и релизы

С релиза 0.1.0 проект перешёл на [Conventional Commits 1.0](https://www.conventionalcommits.org/) и автоматизирует релизы через [release-please](https://github.com/googleapis/release-please) (workflow [.github/workflows/release-please.yml](.github/workflows/release-please.yml)). Полные правила — в [CONTRIBUTING.md](CONTRIBUTING.md), разделы "Стиль коммитов" и "Релизы".

Что это значит для работы в репо:

- **Заголовок коммита всегда в CC-формате** (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `deps:`, `build:`, `ci:`, `chore:`, `test:`, `style:`, `revert:`). Тип влияет на bump версии и попадание в CHANGELOG — выбирай осознанно.
- **Не править руками** `package.json:version`, `CHANGELOG.md` и `.release-please-manifest.json` — release-please сам бампит и переписывает. Единственное исключение — seed-запись `[0.1.0]` в CHANGELOG, уже зафиксированная.
- **BREAKING CHANGE** — `feat!:`/`fix!:` в заголовке или футер `BREAKING CHANGE: …`. На 0.x даёт minor bump, после 1.0 — major.
- Версия и git short SHA пробрасываются в bundle через `define` в [vite.config.ts](vite.config.ts) как `__APP_VERSION__` / `__APP_BUILD_HASH__` (декларации — [src/types/app-version.d.ts](src/types/app-version.d.ts)). Хардкод "1.0 · PWA" больше нигде не использовать.

## Подводные камни

- `vite-plugin-pwa@1.2.0` декларирует peer-зависимость `vite@^3..^7`, но проект на Vite 8. На момент инициализации build и dev зелёные. Если плагин когда-нибудь сломается — даунгрейд Vite до 7 решит, либо ждать релиз плагина с поддержкой Vite 8.
- `name` в [package.json](package.json) — `log-viewer` (не `init`, как было в шаблоне Vite).
- `pnpm install` после клона обязателен — pnpm-lock.yaml зафиксирован.
