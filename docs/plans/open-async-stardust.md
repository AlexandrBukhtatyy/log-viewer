# Plan: Версионирование, CHANGELOG и индикаторы версии в UI

## Context

Проект — open source PWA log-viewer, опубликован на GitHub Pages
(`/log-viewer/` лендинг + `/log-viewer/app/` PWA). На текущий момент:

- `package.json:version = "0.0.0"`, `private: true`, git tags пусты.
- `CHANGELOG.md` отсутствует, нет release-автоматизации.
- В UI единственное упоминание версии — хардкод `"1.0 · PWA"`
  ([LvStatusBar.tsx:26](../../src/ui/components/status/LvStatusBar.tsx#L26)).
- Конвенция коммитов — произвольная (без Conventional Commits).
- `vite-plugin-pwa` работает в `autoUpdate` без UI-нотификации:
  пользователь не знает, когда работает на старой версии.

Это мешает open source-практикам: пользователь не видит, что изменилось
между визитами; нет точки входа в историю; релизы непредсказуемы;
обновлённая PWA молча тащит фоновый апдейт.

Цель — сделать релизы предсказуемыми (semver + CHANGELOG), коммиты —
машиночитаемыми (Conventional Commits + Release Please) и явно показать
пользователю текущую версию + наличие обновления.

**Решения, зафиксированные с пользователем:**

- Release flow — **Release Please** (Conventional Commits).
- UI-точки — все четыре: статус-бар, About-секция в Settings, PWA
  update-баннер, версия в футере лендинга.
- Стартовая версия — **0.1.0** (pre-1.0 честнее для текущей зрелости;
  убирает фальшивое "1.0").

## Design

### 1. Источник правды для версии

- `package.json:version = "0.1.0"`.
- Vite пробрасывает в bundle две константы через `define`:
  `__APP_VERSION__` (из `package.json`) и `__APP_BUILD_HASH__`
  (`git rev-parse --short HEAD`, fallback `'dev'` в среде без git).
- Декларация типов — новый файл `src/types/app-version.d.ts` (каталог
  уже подхватывается через `tsconfig.app.json` include).

### 2. CHANGELOG.md — seed

Корневой `CHANGELOG.md` в формате Keep a Changelog 1.1.0. Один раз
заполняется руками — записью `[0.1.0] - 2026-05-24` с кратким
описанием текущей функциональности (ingest, парсеры, OPFS+FTS5,
virtual scroll, workspace persistence, две HTML-entry, PWA).
Все последующие записи добавляет Release Please автоматически.

### 3. Release Please

Три новых файла в корне:

- `release-please-config.json` — `release-type: node`,
  `bump-minor-pre-major: true`,
  `bump-patch-for-minor-pre-major: true` (на 0.x `feat:` → patch
  0.1.0 → 0.1.1, BREAKING → minor; кадензу можно ослабить позже),
  `include-v-in-tag: true`, секции CHANGELOG: feat/fix/perf/deps/
  revert/docs/refactor + hidden chore/test/ci/build/style.
- `.release-please-manifest.json` — `{".": "0.1.0"}` (источник
  правды о текущей версии, так как git tags пусты).
- `.github/workflows/release-please.yml` — `on: push: branches:[main]`,
  permissions `contents: write` + `pull-requests: write`, шаг
  `googleapis/release-please-action@v4` с `token: GITHUB_TOKEN`.

**Триггер деплоя после релиза.** `GITHUB_TOKEN` не запускает другие
workflow'ы — после merge release-please PR существующий `deploy.yml`
сам не стартует. Решение: добавить в
[.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)
триггер `release: types: [published]` — zero-secrets, без PAT.

### 4. Conventional Commits — документация

- [CONTRIBUTING.md:53-58](../../CONTRIBUTING.md#L53-L58) — заменить
  раздел "Стиль коммитов" на CC-правила (типы, формат, BREAKING),
  добавить раздел "Релизы" с описанием Release Please и кадензы
  на 0.x.
- [CLAUDE.md](../../CLAUDE.md) — новая секция "Версионирование и
  релизы" перед "Подводные камни": CC обязательны, `package.json:version`
  и `CHANGELOG.md` руками не править (после seed).
- [README.md](../../README.md) — badge
  `https://img.shields.io/github/v/release/aleksandrbuhtatyj/log-viewer?include_prereleases&sort=semver`
  - краткая секция "Releases" со ссылкой на CHANGELOG.

commitlint **не вводим сейчас** — соло-разработчик, шум в CI.
Добавим, если появятся внешние контрибьюторы.

### 5. UI-изменения

#### 5.1. Статус-бар

[src/ui/components/status/LvStatusBar.tsx:26](../../src/ui/components/status/LvStatusBar.tsx#L26):
`"1.0 · PWA"` → `v{__APP_VERSION__} · PWA`. Обёртка `lv-status-app`
становится кликабельной — открывает Settings popover на About-секции.
Новый prop `onOpenAbout` пробрасывается из [LvApp.tsx](../../src/ui/components/layout/LvApp.tsx)
(`() => setSettingsOpen(true)`). В [src/ui/styles/lv.css](../../src/ui/styles/lv.css)
для `.lv-status-app[role="button"]` — `cursor: pointer`.

#### 5.2. About-секция в Settings

[src/ui/components/settings/LvSettingsPopover.tsx:116](../../src/ui/components/settings/LvSettingsPopover.tsx#L116) —
после блока "Editor" вставить новый `.lv-settings-sec` "About":
строки `Version: v{__APP_VERSION__}`, `Build: {__APP_BUILD_HASH__}` и
ряд ссылок (GitHub, Changelog, Roadmap, Issues) на репозиторий
`aleksandrbuhtatyj/log-viewer`. Использует существующие классы
`.lv-settings-row` / `.lv-settings-label` — никаких новых стилей.

#### 5.3. PWA update-баннер

- `tsconfig.app.json` — добавить `"vite-plugin-pwa/react"` в
  `compilerOptions.types` (рядом с `"vite-plugin-pwa/client"`).
- Новый компонент `src/ui/components/pwa/LvUpdateBanner.tsx` использует
  `useRegisterSW` из `virtual:pwa-register/react`. При `needRefresh=true`
  показывает баннер "Доступно обновление Log Viewer" + кнопку
  "Обновить" (`updateServiceWorker(true)`).
- Стили `.lv-update-banner` в [src/ui/styles/lv.css](../../src/ui/styles/lv.css)
  (fixed bottom-right, accent-обводка, theme-aware через `--lv-fg-*`).
- Монтаж в [src/App.tsx](../../src/App.tsx) рядом с `<LvAppContainer />`.
- `vite.config.ts` оставляем с `injectRegister: 'auto'`. Плагин не
  дублирует регистрацию при наличии явного импорта
  `virtual:pwa-register/react`; если в DevTools console увидим
  warning о двойной регистрации — переключим на `injectRegister: false`.

#### 5.4. Версия в футере лендинга

[index.html:323](../../index.html#L323) — в `<span class="footer-copy">`
дописать `· v<!--APP_VERSION-->0.1.0<!--/APP_VERSION-->` + ссылку
`Changelog` (`https://github.com/aleksandrbuhtatyj/log-viewer/blob/main/CHANGELOG.md`).
Маркеры внутри комментариев + дефолтное значение — лендинг остаётся
валидным html в IDE-preview без сборки.

В `vite.config.ts` — inline-плагин `versionInjector` с
`transformIndexHtml(html)`: regex-replace
`<!--APP_VERSION-->.*?<!--/APP_VERSION-->` → `APP_VERSION`. Бежит по
обоим HTML-entry (`index.html` + `app/index.html`), но в `app/index.html`
плейсхолдера нет — no-op.

### 6. Фазы (по одному коммиту в Conventional Commits-формате)

1. `feat: expose package version and build hash to bundle` — bump
   `package.json` 0.0.0 → 0.1.0, `vite.config.ts` (`define` +
   `versionInjector`), `src/types/app-version.d.ts`,
   `tsconfig.app.json` (`vite-plugin-pwa/react` в types),
   `LvStatusBar.tsx` (версия из define), `index.html` (плейсхолдер +
   Changelog-ссылка).
2. `docs: add CHANGELOG and adopt Conventional Commits` — `CHANGELOG.md`
   seed, обновлённые `CONTRIBUTING.md` / `CLAUDE.md` / `README.md`.
3. `ci: add Release Please workflow` — `release-please-config.json`,
   `.release-please-manifest.json`, `.github/workflows/release-please.yml`,
   `release: published` триггер в `deploy.yml`.
4. `feat(ui): add About section to Settings popover` —
   `LvSettingsPopover.tsx` (новая секция), `LvStatusBar.tsx`
   (onClick → `onOpenAbout`), `LvApp.tsx` (prop wiring).
5. `feat(pwa): show update banner when new service worker is ready` —
   `src/ui/components/pwa/LvUpdateBanner.tsx`, стили в `lv.css`,
   монтаж в `src/App.tsx`.

После Phase 3 (рекомендация) — создать ADR `/adr versioning and
release automation via Release Please`. Введение CC + автоматизации
релизов попадает под критерии ADR в [docs/adr/README.md](../adr/README.md).

## Critical files

- [package.json](../../package.json) — bump version + (опционально позже)
  скрипт `release` если потребуется.
- [vite.config.ts](../../vite.config.ts) — `define` + `versionInjector`.
- [tsconfig.app.json](../../tsconfig.app.json) — `vite-plugin-pwa/react`
  в types.
- [src/types/app-version.d.ts](../../src/types/) — новый.
- [src/ui/components/status/LvStatusBar.tsx](../../src/ui/components/status/LvStatusBar.tsx) —
  замена хардкода + `onOpenAbout` prop.
- [src/ui/components/layout/LvApp.tsx](../../src/ui/components/layout/LvApp.tsx) —
  wiring `onOpenAbout`.
- [src/ui/components/settings/LvSettingsPopover.tsx](../../src/ui/components/settings/LvSettingsPopover.tsx) —
  About-секция.
- [src/ui/components/pwa/LvUpdateBanner.tsx](../../src/ui/components/pwa/) —
  новый.
- [src/App.tsx](../../src/App.tsx) — монтаж баннера.
- [src/ui/styles/lv.css](../../src/ui/styles/lv.css) — `.lv-update-banner`,
  cursor для статус-бара.
- [index.html](../../index.html) — плейсхолдер версии в футере.
- [CHANGELOG.md](../../CHANGELOG.md) — новый, seed для 0.1.0.
- [release-please-config.json](../../release-please-config.json) — новый.
- [.release-please-manifest.json](../../.release-please-manifest.json) — новый.
- [.github/workflows/release-please.yml](../../.github/workflows/release-please.yml) —
  новый.
- [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) —
  добавить `release: published`.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — раздел "Стиль коммитов" → CC,
  новый раздел "Релизы".
- [CLAUDE.md](../../CLAUDE.md) — секция "Версионирование и релизы".
- [README.md](../../README.md) — badge + раздел "Releases".

## Verification

**Локально:**

1. `pnpm install && pnpm test && pnpm lint && pnpm build` — все зелёные.
2. `grep -o 'v0.1.0' dist/index.html` — найдено (футер лендинга).
3. `grep -ro '0.1.0' dist/assets | head` — найдено (bundle PWA).
4. `pnpm preview` → `http://localhost:4173/log-viewer/` — версия и
   Changelog-ссылка в футере.
5. `/log-viewer/app/` — версия в статус-баре (`v0.1.0 · PWA`), клик
   открывает Settings → About с версией, build hash и 4 ссылками.

**PWA update-баннер (ручная):**

1. `pnpm build && pnpm preview`, открыть `/log-viewer/app/`, дождаться
   регистрации SW (DevTools → Application → Service Workers).
2. Косметическая правка (например, пробел в `LvApp.tsx`), `pnpm build`
   снова, reload вкладки — `useRegisterSW` вернёт `needRefresh=true`,
   баннер появится.
3. Альтернативно: DevTools → Application → SW → "Update on reload" +
   reload. Если в console видно warning о двойной регистрации —
   переключить `injectRegister: 'auto'` → `false` в `vite.config.ts`.

**Release Please dry-run:**

1. После merge Phase 3 в main: Actions → workflow "Release Please" —
   зелёный.
2. Pull Requests → автоматически создан PR `chore(main): release 0.x.x`
   с обновлённым CHANGELOG.md и package.json.
3. Merge PR → tag `v0.x.x` + GitHub Release созданы; `deploy.yml`
   запускается по `release: published`, PWA задеплоена.

**Тестовый feat-коммит:**

- На feature-ветке `feat: pretty-print json in entry detail` (мнимая
  фича), PR, merge — Release Please обновит уже открытый release PR,
  добавив запись в Features.

## Риски

- `vite-plugin-pwa@1.2.0` peer-dep на Vite ^3..^7, проект на Vite 8 —
  текущая сборка работает; `useRegisterSW` — штатная фича плагина,
  риски не выше существующих. Fallback (downgrade Vite 7) уже
  упомянут в [CLAUDE.md](../../CLAUDE.md#подводные-камни).
- Двойная регистрация SW при `injectRegister: 'auto'` + явный
  `useRegisterSW` — митигация в §5.3 (переключить на `false`).
- `bump-patch-for-minor-pre-major: true` — спорный флаг. На 0.x даёт
  patch на каждый feat. Если хотим нормальную semver-кадензу до 1.0 —
  снимаем флаг в одной строке.
- Расхождение GitHub username: [README.md:3](../../README.md#L3)
  ссылается на `alexandrbukhtatyy.github.io`, остальной репо
  (CONTRIBUTING.md, index.html, CLAUDE.md) — `aleksandrbuhtatyj`.
  **Вне scope этой задачи**; в новых артефактах используем
  `aleksandrbuhtatyj` (доминирующий). Унификация — отдельный fix-PR.
- ADR-стопхук попросит ADR — это и есть тот случай "лишний ADR
  дешевле потерянного решения": создаём после Phase 3.
