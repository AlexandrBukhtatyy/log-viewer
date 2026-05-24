# План: канал обратной связи

## Context

У проекта нет структурированного способа собирать обратную связь. CONTRIBUTING.md упоминает GitHub Issues одной строкой; в [`.github/`](../../.github/) нет ни одного issue-template; в самом UI кнопки «Report Issue…» в [LvMenuBar.tsx](../../src/ui/components/topbar/LvMenuBar.tsx) уже есть, но команда `help-report` нигде не обрабатывается; на лендинге [index.html](../../index.html) и в [README.md](../../README.md) тоже нет соответствующих точек входа.

Цель — построить **двухполосный** канал:

- **GitHub-полоса** для tech-savvy пользователей: Issues (структурированные через templates), Discussions (Q&A/Ideas), Projects (public roadmap).
- **Telegram-полоса** для случайных пользователей демки: public-группа с invite-ссылкой, доступ без аккаунта на GitHub.

Параллельно — добавить ErrorBoundary с ring-buffer'ом последних ошибок, чтобы bug-репорты приходили с минимально полезной диагностикой (версия, build hash, UA, активные парсеры, размер открытого файла, последние ошибки).

Все entry-point'ы (StatusBar, menu, Settings/About, лендинг, README, CONTRIBUTING) ведут в одну модалку `LvFeedbackModal` или в её фрагменты (для лендинга — прямые ссылки).

## Scope

**Входит:**
- 3 issue templates + config.yml с дисейблом blank и ссылками наружу.
- Утилита `collectDiagnostics()` + Markdown-форматтер.
- `ErrorBoundary` + module-level ring-buffer на 30 последних ошибок (хук на `console.error/warn`, `window.onerror`, `onunhandledrejection`).
- Модалка `LvFeedbackModal` с выбором типа → канала, по образцу [LvClearDataModal.tsx](../../src/ui/components/modals/LvClearDataModal.tsx).
- Подключение существующего пункта меню `help-report` к модалке.
- Кнопка в [LvStatusBar.tsx](../../src/ui/components/status/LvStatusBar.tsx) (lucide `MessageSquarePlus`).
- Расширение About-секции в [LvSettingsPopover.tsx](../../src/ui/components/settings/LvSettingsPopover.tsx).
- Build-time `__BUILD_TIME__` (ISO) — в [vite.config.ts](../../vite.config.ts) и [app-version.d.ts](../../src/types/app-version.d.ts).
- Поля `repository` / `bugs` / `homepage` в [package.json](../../package.json).
- Секция Feedback на лендинге и в README; расширение CONTRIBUTING.
- Конфиг-модуль `src/config/feedback.ts` (URL'ы репозитория и Telegram invite — одной константой).

**Не входит** (отдельные задачи):
- Telegram-бот с webhook (рассматривалось, отвергнуто в пользу группы).
- Anonymous-форма через Formspree/Web3Forms.
- Featurebase / Canny / голосование вне GitHub.
- Email-канал.
- Sentry / external error reporting.
- Любые изменения worker'ов, парсеров, ingestion-pipeline.

## Шаги

### 1. Конфиг-модуль и `package.json`

- Создать [src/config/feedback.ts](../../src/config/feedback.ts):
  ```ts
  export const FEEDBACK_CONFIG = {
    repoUrl: 'https://github.com/AlexandrBukhtatyy/log-viewer',
    issuesUrl: 'https://github.com/AlexandrBukhtatyy/log-viewer/issues',
    discussionsUrl: 'https://github.com/AlexandrBukhtatyy/log-viewer/discussions',
    roadmapUrl: 'https://github.com/users/AlexandrBukhtatyy/projects/<N>', // вписать после создания Project
    telegramInviteUrl: 'https://t.me/+<invite>', // вписать после создания группы
  } as const;
  ```
- В [package.json](../../package.json) добавить `repository`, `bugs`, `homepage` — это автоматически попадает в npm/registry мета и удобно для CLI.

### 2. Build-time мета

- В [vite.config.ts](../../vite.config.ts) (рядом с `__APP_VERSION__`/`__APP_BUILD_HASH__`) добавить `__BUILD_TIME__: JSON.stringify(new Date().toISOString())`.
- В [src/types/app-version.d.ts](../../src/types/app-version.d.ts) объявить `declare const __BUILD_TIME__: string;`.

### 3. Ring-buffer ошибок

- Новый модуль `src/utils/error-buffer.ts`:
  - Module-level singleton с массивом ≤30 записей `{ ts: number, level: 'error' | 'warn', message: string, stack?: string, source: 'console' | 'window' | 'promise' | 'boundary' }`.
  - Экспорт: `installErrorBuffer()` (идемпотентен; патчит `console.error`/`console.warn`, навешивает `window.onerror`/`onunhandledrejection`), `snapshotErrors()`, `pushError(entry)` для ErrorBoundary.
- Вызов `installErrorBuffer()` в [src/main.tsx](../../src/main.tsx) **до** монтирования React.

### 4. ErrorBoundary

- `src/ui/ErrorBoundary.tsx`:
  - Class component (другого пути для error boundary в React 19 нет).
  - В `componentDidCatch` пушит в ring-buffer через `pushError({ source: 'boundary', ... })`.
  - Fallback UI: переиспользует `.lv-modal` стили (full-screen scrim), кнопка «Send crash report» открывает `LvFeedbackModal` с pre-выбранным типом Bug и включённой диагностикой.
- В [src/main.tsx](../../src/main.tsx) обернуть `<App/>` в `<ErrorBoundary>`.

### 5. Утилита диагностики

- `src/utils/diagnostics.ts`:
  - `collectDiagnostics(viewStore): Diagnostics` — синхронно читает версию/хеш/build time, `navigator.userAgent`, `navigator.onLine`, `navigator.serviceWorker.controller !== null`, последние ошибки через `snapshotErrors()`, и через `viewStore.getState()` — `sources` (для каждого: `parserId`, `source.size`, `entryCount` при `status.kind==='done'`), `totalCount`, `filteredCount`.
  - `formatDiagnosticsMarkdown(d: Diagnostics): string` — формирует Markdown-блок ```` ```\n...\n``` ```` для вставки в Issue body или Telegram.
- Источники полей (для справки исполнителя):
  - Версия/хеш: [vite.config.ts](../../vite.config.ts), пример использования в [LvStatusBar.tsx:33](../../src/ui/components/status/LvStatusBar.tsx#L33).
  - ViewStore: [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts), context [src/app/providers/view-store-context.ts](../../src/app/providers/view-store-context.ts).
  - Типы source: [src/core/types/log-source.ts](../../src/core/types/log-source.ts).

### 6. Модалка `LvFeedbackModal`

- `src/ui/components/feedback/LvFeedbackModal.tsx` — клон каркаса [LvClearDataModal.tsx](../../src/ui/components/modals/LvClearDataModal.tsx) (тот же `lv-modal-scrim` + `lv-modal` + `lv-modal-hd/body/ft`, Escape-handler, focus-trap).
- Props: `{ open, onClose, initialKind?: 'bug' | 'feature' | 'question' | 'idea', includeDiagnostics?: boolean }`.
- Один экран (без многошаговости), три блока:
  1. **Type** — segmented control: Bug / Feature / Question / Idea. Меняет шаблон title и метки в pre-fill.
  2. **Message** — `<textarea>` (опционально, можно открыть Issue и без него).
  3. **Diagnostics** — checkbox «Include diagnostics» (по умолчанию ON для Bug, OFF для остальных) + `<details>` с preview Markdown'а.
- Действия в футере (lucide-иконки):
  - **Open on GitHub** — формирует URL `…/issues/new?title=<>&body=<>&labels=<>` через `encodeURIComponent`, `window.open(url, '_blank', 'noopener')`. Для типа Idea: метка `enhancement` + suggestion открыть Discussion (см. ниже).
  - **Discuss on GitHub** — для Question/Idea: `…/discussions/new?category=<>` с pre-fill body.
  - **Open Telegram group** — `window.open(telegramInviteUrl, '_blank')`, и если `includeDiagnostics` — копирует body в clipboard через `navigator.clipboard.writeText()` + тоаст «Diagnostics copied — paste in chat».
  - **Cancel**.
- Стилизация: только переиспользование классов `lv-modal*`, `lv-btn`, `lv-btn-primary`. Новых CSS-файлов не плодим; если нужны мелкие правки — добавить в существующий `lv.css`.

### 7. Точки входа в приложении

- **[LvStatusBar.tsx](../../src/ui/components/status/LvStatusBar.tsx):** добавить `<button className="lv-status-item lv-status-feedback">` с иконкой `MessageSquarePlus` из `lucide-react` (как уже сделано в [LvFilterBar](../../src/ui/components/topbar/LvFilterBar.tsx)) перед UTC-индикатором. Через новый prop `onOpenFeedback?: () => void` пробрасывается до контейнера.
- **[LvMenuBar.tsx](../../src/ui/components/topbar/LvMenuBar.tsx):** существующий пункт `Report Issue…` (`onRun: () => onCommand?.('help-report')`) переименовать в `Send Feedback…` и оставить ту же команду.
- **`LvApp.tsx`** (контейнер): добавить `const [feedbackOpen, setFeedbackOpen] = useState(false)`; обработать `'help-report'` в `onCommand` → `setFeedbackOpen(true)`; пробросить `onOpenFeedback={() => setFeedbackOpen(true)}` в StatusBar; смонтировать `<LvFeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />`.
- **[LvSettingsPopover.tsx](../../src/ui/components/settings/LvSettingsPopover.tsx):** в секции About — кнопка «Send Feedback» (открывает модалку через тот же команд-канал) и Telegram-ссылка рядом с GitHub.

### 8. Точки входа вне приложения

- **[index.html](../../index.html) (лендинг):**
  - В footer (строки 321–337) — Telegram-ссылка рядом с GitHub-логотипом (использовать lucide-style inline SVG из telegram-icon, формат как существующий GitHub-логотип).
  - В карточке «Дальше — лучше» (~314): расширить `card-links` ссылками на Issues, Discussions, Telegram (стиль `.card-links a` уже есть).
- **[README.md](../../README.md):** новая секция `## Feedback & Community` после блока PWA (примерно после строки про SW): Issues / Discussions / Roadmap (Project) / Telegram-группа — список со ссылками.
- **[CONTRIBUTING.md](../../CONTRIBUTING.md):** расширить блок «Связаться» (строки 5–8): добавить Discussions (Q&A для вопросов, Ideas для предложений), Roadmap (Project), Telegram-группу.

### 9. Issue templates и Discussions config

- `.github/ISSUE_TEMPLATE/bug_report.yml` — `name: Bug report`, поля: что произошло, как воспроизвести, ожидаемое поведение, **diagnostics** (textarea с подсказкой «вставьте сюда блок из приложения»), браузер/OS. Labels: `bug`.
- `.github/ISSUE_TEMPLATE/feature_request.yml` — name, problem-statement, proposed-solution, alternatives. Labels: `enhancement`.
- `.github/ISSUE_TEMPLATE/question.yml` — короткая форма; в config дополнительно редирект в Discussions Q&A.
- `.github/ISSUE_TEMPLATE/config.yml`:
  ```yaml
  blank_issues_enabled: false
  contact_links:
    - name: Discussions (Q&A, Ideas)
      url: https://github.com/AlexandrBukhtatyy/log-viewer/discussions
      about: Общие вопросы, идеи, поделиться кейсом.
    - name: Public Roadmap
      url: https://github.com/users/AlexandrBukhtatyy/projects/<N>
      about: Что в работе и что в ближайших планах.
    - name: Telegram group
      url: https://t.me/+<invite>
      about: Чат сообщества, без GitHub-аккаунта.
  ```

## Файлы

**Новые:**
- [.github/ISSUE_TEMPLATE/bug_report.yml](../../.github/ISSUE_TEMPLATE/bug_report.yml)
- [.github/ISSUE_TEMPLATE/feature_request.yml](../../.github/ISSUE_TEMPLATE/feature_request.yml)
- [.github/ISSUE_TEMPLATE/question.yml](../../.github/ISSUE_TEMPLATE/question.yml)
- [.github/ISSUE_TEMPLATE/config.yml](../../.github/ISSUE_TEMPLATE/config.yml)
- [src/config/feedback.ts](../../src/config/feedback.ts)
- [src/utils/error-buffer.ts](../../src/utils/error-buffer.ts)
- [src/utils/diagnostics.ts](../../src/utils/diagnostics.ts)
- [src/ui/ErrorBoundary.tsx](../../src/ui/ErrorBoundary.tsx)
- [src/ui/components/feedback/LvFeedbackModal.tsx](../../src/ui/components/feedback/LvFeedbackModal.tsx)

**Изменяемые:**
- [package.json](../../package.json) — `repository`, `bugs`, `homepage`.
- [vite.config.ts](../../vite.config.ts) — `__BUILD_TIME__`.
- [src/types/app-version.d.ts](../../src/types/app-version.d.ts) — декларация `__BUILD_TIME__`.
- [src/main.tsx](../../src/main.tsx) — `installErrorBuffer()` + `<ErrorBoundary>`.
- [src/ui/components/status/LvStatusBar.tsx](../../src/ui/components/status/LvStatusBar.tsx) — кнопка feedback + prop.
- [src/ui/components/topbar/LvMenuBar.tsx](../../src/ui/components/topbar/LvMenuBar.tsx) — переименование пункта.
- [src/ui/components/settings/LvSettingsPopover.tsx](../../src/ui/components/settings/LvSettingsPopover.tsx) — feedback в About.
- `src/ui/LvApp.tsx` (или эквивалент-контейнер, найденный исполнителем) — state и команды.
- [index.html](../../index.html) — footer + карточка.
- [README.md](../../README.md) — секция Feedback & Community.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — блок «Связаться».
- CSS-файл с `.lv-status-*` и `.lv-modal-*` (искать по grep — судя по разведке, это `lv.css`) — при необходимости добавить класс под кнопку feedback в StatusBar.

## Reuse

- Каркас модалки + Escape-handler + focus-trap: [LvClearDataModal.tsx](../../src/ui/components/modals/LvClearDataModal.tsx).
- Стили: `.lv-modal-scrim`, `.lv-modal`, `.lv-modal-hd/body/ft`, `.lv-btn`, `.lv-btn-primary`, `.lv-status-item`, `.lv-status-sep`.
- Иконки: `lucide-react` (`MessageSquarePlus`, `Bug`, `Lightbulb`, `MessageCircleQuestion`, `Send`, `ClipboardCopy`).
- Build-time константы: `__APP_VERSION__`, `__APP_BUILD_HASH__` (vite.config.ts).
- Команд-канал: `onCommand?: (cmd: string) => void` в [LvMenuBar.tsx](../../src/ui/components/topbar/LvMenuBar.tsx) — уже передаёт `'help-report'`.
- ViewStore: `useViewStore()` из [src/worker-client/log-client.ts](../../src/worker-client/log-client.ts).
- Контекст PWA-регистрации: [src/ui/components/pwa/LvUpdateBanner.tsx](../../src/ui/components/pwa/LvUpdateBanner.tsx) — пример работы с `virtual:pwa-register`.

## Ручные шаги вне кода

Эти шаги делает владелец репозитория один раз — без них код будет работать с placeholder-URL'ами, но не доходить по назначению. Выполнить **до** или **сразу после** реализации, чтобы вписать актуальные URL в [src/config/feedback.ts](../../src/config/feedback.ts) и в `.github/ISSUE_TEMPLATE/config.yml`:

1. **GitHub Settings → Features → включить Discussions.** Создать категории: `Q&A` (formats: question/answer), `Ideas` (formats: discussion с reactions для voting), `General`.
2. **GitHub Projects → New project** (тип Board), уровень — user или repo. Колонки: Backlog / Planned / In progress / Done. Сделать публичным. Записать номер проекта в `roadmapUrl`.
3. **Telegram → создать public-группу** (или private с invite-ссылкой). Скопировать invite-ссылку (`https://t.me/+...`) в `telegramInviteUrl` и в `.github/ISSUE_TEMPLATE/config.yml`.

## Verification

После реализации — прогнать end-to-end вручную в браузере:

- `pnpm lint && pnpm build` зелёные, tsc без ошибок (`__BUILD_TIME__` декларация подцепилась).
- `pnpm dev`:
  - Открыть `http://localhost:5173/log-viewer/app/`, загрузить любой файл из `.tmp/` (см. `pnpm gen:fixtures`).
  - Кликнуть кнопку feedback в StatusBar → модалка открывается. Выбрать Bug → нажать «Open on GitHub» → новая вкладка с pre-filled Issue, в body видно diagnostics с версией, hash, UA, активным парсером, размером и `entryCount` файла.
  - Включить чекбокс «Include diagnostics», выбрать Question → «Open Telegram group» → открылась ссылка на группу, в clipboard лежит Markdown с диагностикой (вставить в любой text-input для проверки).
  - В DevTools Console: `throw new Error('test crash')` внутри React-обработчика (например, через React DevTools-инструменты) → ErrorBoundary показывает fallback с «Send crash report». Эта кнопка открывает модалку, тип pre-выбран Bug, diagnostics включена и содержит этот error в блоке Recent errors.
  - Вызвать `console.error('synthetic')` несколько раз → открыть модалку с diagnostics — последняя ошибка видна.
  - В меню Help → `Send Feedback…` открывает ту же модалку.
  - В Settings (клик по «Log Viewer» в StatusBar) → About → ссылка Telegram открывается, кнопка Send Feedback открывает модалку.
- `pnpm preview`:
  - Открыть `http://localhost:4173/log-viewer/` — лендинг: ссылки в footer и в карточке «Дальше — лучше» ведут на Issues / Discussions / Telegram (внешние URL).
- Открыть Issue через UI → проверить, что репо подтянул template (поле «Bug report» появилось как выбор) и что blank issue заблокирован, contact-links видны.
- GitHub Discussions / Project / Telegram-группа существуют и доступны по URL'ам из `feedback.ts`.

## Дальнейшие шаги (не в этой итерации)

- Anonymous-форма (Formspree/Web3Forms) на случай, если Telegram-группа окажется недостаточной.
- Telegram-бот с webhook, авто-перекладывающий feedback из приложения в личный чат (улучшение UX поверх текущей группы).
- Подписка на Sentry/PostHog для аггрегации ошибок (если ring-buffer покажется недостаточным).
- Локализация модалки (сейчас — RU/EN по аналогии с тем, что уже есть в проекте).
