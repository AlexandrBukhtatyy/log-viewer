# Декомпозиция Claude Design dump в src/ui/

## Context

В каталог [src/ui/](src/ui/) скопированы исходники из Claude Design — это монолитный дамп интерфейса log viewer'а:

- `Log Viewer.html` — standalone preview с `<script src="cdn.tailwindcss.com">` (классы Tailwind в коде **не используются**) и большим `<style>` блоком: design tokens (CSS-переменные `--lv-*`), темы `[data-theme="dark|light"]`, density-варианты, ~200 классов `.lv-*`.
- `log-app.jsx`, `log-viewer.jsx`, `log-tree.jsx`, `log-monaco.jsx`, `tweaks-panel.jsx` — JSX (без TypeScript), ~30 React-компонентов в общей сложности, иконки inline-SVG, всё ставит классы `lv-*`.
- `log-data.js` — IIFE, кладёт моки в `window.LogData` (каталог файлов, генераторы LogEntry).

Цель — превратить этот монолит в набор независимых, регенерируемых компонентов в `src/ui/components/<region>/`, оставив рабочую основу `App.tsx → AppShell.tsx → 3 контейнера` нетронутой. Декомпозиция «единоразовая ручная» — дальше Claude Design эмитит апдейты в эту же структуру.

**Нерешённое до плана зафиксировано выбором пользователя:**
- стилевая система — сохраняем `.lv-*` (CSS-файл с переменными и темами);
- scope — все 5 файлов разом (~30 компонентов), Monaco и mock — параллельно;
- wiring — `app/containers/` и `AppShell.tsx` в этой итерации **не трогаем**;
- Tailwind подключаем как dev-зависимость (не CDN), но как дополнительную возможность — основная стилизация по-прежнему через `.lv-*` классы.

## Принципы

1. **ADR-0002 (headless).** [src/ui/components/](src/ui/components/) — props-only, без хуков, без runtime-импортов из core. ESLint в [eslint.config.js](eslint.config.js#L60-L79) уже это enforce'ит. Локальный UI-state (`useState/useRef` для open/close, refs на DOM) — разрешён.
2. **Минимум диффа на регенерацию.** Стили лежат в одном CSS-файле как в исходном HTML; компоненты ставят `className="lv-..."`. Если Claude Design завтра эмитит свежий вариант с теми же классами — диффом будут только сами TSX, не стили.
3. **Никакого подключения к данным сейчас.** Скопированный mock `log-data.js` нельзя импортировать в компонент (они должны принимать данные через props). Mock переезжает в [src/dev/](src/dev/) для локального превью, в основном app не подключается.
4. **Старые [src/ui/components/{FilterBar,LogList,SourcePicker}.tsx](src/ui/components/) остаются.** AppShell продолжает рендерить их, путь к работающему билду не ломаем. Новые компоненты живут в подкаталогах с префиксом `Lv*` в именах файлов и классов — конфликтов имён нет.

## 1. Стили: вынос `<style>` из HTML

Создать [src/ui/styles/lv.css](src/ui/styles/lv.css):
- Скопировать содержимое `<style>` блока из [src/ui/Log Viewer.html](src/ui/Log%20Viewer.html) **as-is**, без модификаций.
- Файл импортится единожды из [src/main.tsx](src/main.tsx) после существующего `import './index.css'`.
- В `index.css` ничего не меняем — он остаётся базовым reset'ом.

CSS-переменные (`--lv-bg`, `--lv-fg`, `--lv-level-error`, `--lv-accent`, `--lv-font-ui`, `--lv-font-mono`, …) и темы (`[data-theme="dark|light"]`, `[data-density="compact|comfortable"]`) сохраняются. Атрибут `data-theme` будут проставлять контейнер/контекст в следующей итерации wiring'а — сейчас просто оставляем default-значения из CSS.

Из исходного `Log Viewer.html` **удаляем** ссылку на `<script src="https://cdn.tailwindcss.com">` (файл всё равно идёт под удаление в §5, отдельной правки не нужно).

### 1a. Tailwind v4 как dev-зависимость

Подключаем Tailwind v4 через [`@tailwindcss/vite`](https://tailwindcss.com/docs/installation/using-vite) — это рекомендуемый путь под Vite. Mom утилитарные классы Tailwind в скопированной верстке **не используются** (всё через `.lv-*`), но мы:

- убираем рантайм-обращение к CDN (важно для prod-bundle и offline-режима PWA);
- даём будущим итерациям Claude Design возможность эмитить utility-классы вперемешку с `.lv-*`;
- не делаем рефакторинг существующих `.lv-*` или inline-стилей — миграция вне scope (см. §7).

Шаги:
1. `pnpm add -D tailwindcss @tailwindcss/vite` — обновит [package.json](package.json) и [pnpm-lock.yaml](pnpm-lock.yaml).
2. В [vite.config.ts](vite.config.ts) добавить `import tailwindcss from '@tailwindcss/vite'` и `tailwindcss()` в массив `plugins` (рядом с `react()`, `VitePWA(...)`).
3. Первой строкой [src/ui/styles/lv.css](src/ui/styles/lv.css) — `@import "tailwindcss";`. В Tailwind v4 content-detection автоматическое: сканируются `.ts/.tsx/.html` без явного `content`-конфига.
4. Зафиксировать решение ADR'ом — создать [docs/adr/0008-tailwind-v4-via-package.md](docs/adr/0008-tailwind-v4-via-package.md) (status: proposed) с обоснованием: «через зависимость, не CDN; v4 + vite-plugin; сосуществует с `.lv-*`-системой; mass-migration на utility-классы — out of scope». Обновить index в [docs/adr/README.md](docs/adr/README.md).

**Подводный камень peer-deps.** Vite 8 уже создаёт peer-warning'и для `vite-plugin-pwa@1.2.0` ([CLAUDE.md → Подводные камни](CLAUDE.md)). У `@tailwindcss/vite` peer-range на момент 2026-05 — `vite ^5 || ^6 || ^7`, на Vite 8 будет аналогичный warning. Если `pnpm install` упадёт по `strict-peer-dependencies`, fallback — PostCSS-вариант: `pnpm add -D tailwindcss @tailwindcss/postcss`, создать `postcss.config.mjs` с плагином, без правки `vite.config.ts`. Решаем по факту в момент установки.

## 2. Структура каталогов и компонентный split

`src/ui/components/<region>/<Component>.tsx` — каждый файл экспортирует один named-компонент. Имена сохраняем с префиксом `Lv` чтобы не конфликтовали с уже существующими `FilterBar/LogList/SourcePicker` и читались узнаваемо.

```
src/ui/components/
  topbar/
    LvTitlebar.tsx              ← log-app.jsx:1020
    LvMenuBar.tsx                ← log-app.jsx:696
    LvMenuButton.tsx             ← log-app.jsx:800
    LvMenu.tsx                   ← log-app.jsx:815
  rail/
    LvIconRail.tsx               ← log-app.jsx:3
  status/
    LvStatusBar.tsx              ← log-app.jsx:330
  sidebar/
    LvSidebar.tsx                ← log-tree.jsx:315
    LvTreeNode.tsx               ← log-tree.jsx:147
    LvFileIcon.tsx               ← log-tree.jsx (иконки)
    LvSourceIcon.tsx             ← log-tree.jsx (иконки)
    LvChevron.tsx                ← log-tree.jsx (иконка)
    LvRootBadge.tsx              ← log-tree.jsx (иконка)
    LvAddSourceMenu.tsx          ← log-tree.jsx:238
  filter/
    LvFilterBar.tsx              ← log-viewer.jsx:200
    LvLevelPill.tsx              ← log-viewer.jsx:75
    LvGroupBySelect.tsx          ← log-viewer.jsx:89
    LvAddFieldFilter.tsx         ← log-viewer.jsx:374
  timeline/
    LvTimeline.tsx               ← log-viewer.jsx:444
  stream/
    LvViewer.tsx                 ← log-viewer.jsx:1004 (контейнер списка)
    LvTabs.tsx                   ← log-viewer.jsx:936
    LvFilePeek.tsx               ← log-viewer.jsx:966
    LvRow.tsx                    ← log-viewer.jsx:635
    LvRowDetail.tsx              ← log-viewer.jsx:689
    LvGroupHeader.tsx            ← log-viewer.jsx:782
    LvOpenMenu.tsx               ← log-viewer.jsx:566
    LvEditorIcon.tsx             ← log-viewer.jsx:619
    LvEmpty.tsx                  ← log-viewer.jsx:1354
  panels/
    LvBookmarksPanel.tsx         ← log-app.jsx:46
    LvAiPanel.tsx                ← log-app.jsx:85
    LvAlertsPanel.tsx            ← log-app.jsx:258
    LvSearchPanel.tsx            ← log-app.jsx:292
  modals/
    LvCommandPalette.tsx         ← log-app.jsx:371
    LvShortcutsModal.tsx         ← log-app.jsx:935
  settings/
    LvSettingsPopover.tsx        ← log-app.jsx:855
  tweaks/
    LvTweaksPanel.tsx            ← tweaks-panel.jsx
    LvTweakSection.tsx
    LvTweakSlider.tsx
    LvTweakRadio.tsx
    LvTweakColor.tsx
    LvTweakToggle.tsx
  layout/
    LvApp.tsx                    ← log-app.jsx:413, чисто композиционная shell-обёртка над всем выше
```

**Утилиты** (не компоненты), которые сейчас лежат в [log-viewer.jsx](src/ui/log-viewer.jsx):
- `lvFmtTime`, `lvHighlight`, `lvApplyFilters`, `lvBuildGroups` → [src/ui/utils/lv.ts](src/ui/utils/lv.ts) (ESLint допускает `ui/utils/`, ограничения на импорты из core/types те же, что у компонентов).

**TS-types для props** — встраиваем в каждый файл как `interface Lv<Component>Props` (так уже сделано в [LogList.tsx:23](src/ui/components/LogList.tsx#L23) и [FilterBar.tsx:18](src/ui/components/FilterBar.tsx#L18)). Отдельный `ui/contracts/` пока не заводим — добавится, когда понадобится переиспользовать тип в нескольких местах.

## 3. Правила переноса JSX → TSX

Для каждого компонента:
1. Вынести функцию из исходного JSX в одноимённый TSX-файл по схеме выше.
2. Поменять `React.useState` / `React.useEffect` / `React.useRef` / `React.useMemo` / `React.useCallback` на named-импорты `import { useState, … } from 'react'`.
3. Заменить deconstruction props на типизированный интерфейс. Все props — `readonly` где это просто значение; колбэки оставляем как есть.
4. Убрать любые обращения к `window.LogData` — данные приходят только через props. Если в исходнике компонент сам звал mock — props получает родитель, контейнер пусть его передаёт (в этой итерации — `LvApp` собирает mock из `src/dev/log-data-mock.ts`, но импорт mock делает только `LvApp` или dev-страница, не сами компоненты).
5. `useTweaks` из [tweaks-panel.jsx](src/ui/tweaks-panel.jsx) **не переносить** в `src/hooks/` — это ui-only state, который не нужен ядру. Превратить в локальный `useState` внутри `LvApp` и пробрасывать `tweaks/setTweaks` пропсами в `LvTweaksPanel`. Полноценный хук `useTweaks` появится в отдельном плане, когда понадобится persistence через ViewStore.
6. Inline-SVG иконки (Chevron, FileIcon, SourceIcon, иконки в FilterBar/Titlebar) — выделить отдельные компоненты только там, где SVG переиспользуется ≥2 раз; одноразовые остаются inline.
7. Никаких `default export`. Только named exports — соответствует стилю текущих TSX и плагин-правилам ESLint.

## 4. Что переезжает за пределы ui/components/

- [src/ui/utils/lv.ts](src/ui/utils/lv.ts) — `lvFmtTime`, `lvHighlight`, `lvApplyFilters`, `lvBuildGroups`. Чистый TS, без React-импортов.
- [src/dev/log-data-mock.ts](src/dev/log-data-mock.ts) — содержимое [src/ui/log-data.js](src/ui/log-data.js), типизированный экспорт `{ CATALOG, FILES_BY_ID, LOG_BY_FILE, SAVED, addFile, addRootFolder, removeRoot }`. Использовать ТОЛЬКО как dev-источник для local preview-страницы (см. ниже). Не импортируется ни одним компонентом и ни AppShell.
- [src/dev/lv-preview.tsx](src/dev/lv-preview.tsx) — дев-страница, рендерит `<LvApp />` с подключённым mock. Подключается через query-параметр в [src/main.tsx](src/main.tsx) (`?preview=lv` → рендерит `<LvPreview/>` вместо `<App/>`), либо через отдельный entry — выбрать на этапе реализации, default — query-параметр (минимальный диффе).

## 5. Что удаляется

Когда декомпозиция закончена — удалить:
- [src/ui/Log Viewer.html](src/ui/Log%20Viewer.html) — содержимое мигрировало в `lv.css`.
- [src/ui/log-app.jsx](src/ui/log-app.jsx), [src/ui/log-viewer.jsx](src/ui/log-viewer.jsx), [src/ui/log-tree.jsx](src/ui/log-tree.jsx), [src/ui/tweaks-panel.jsx](src/ui/tweaks-panel.jsx) — мигрировали в TSX.
- [src/ui/log-monaco.jsx](src/ui/log-monaco.jsx) — **оставляем как есть** до отдельного ADR/плана интеграции Monaco. Его никто не импортирует, ESLint его не цепляет (в `eslint.config.js` `files: ['**/*.{ts,tsx}']`, jsx без ts-инфры не проверяется).
- [src/ui/log-data.js](src/ui/log-data.js) — после миграции mock'а в `src/dev/`.

[src/ui/components/{FilterBar,LogList,SourcePicker}.tsx](src/ui/components/) **остаются**. AppShell продолжает их рендерить.

## 6. Verification

После декомпозиции:

1. `pnpm install` — без ошибок (либо приемлемые peer-warning'и от `@tailwindcss/vite` × Vite 8, аналогичные текущим от `vite-plugin-pwa`).
2. `pnpm build` — `tsc -b && vite build` должны пройти зелёными. В `dist/assets/` появляется CSS-bundle с обработанным `@import "tailwindcss"` + `.lv-*` правилами.
3. `pnpm lint` — ESLint без ошибок. Особенно проверяем правила слоёв: новые `Lv*.tsx` не должны импортировать из `hooks/`, `app/`, `worker-client/`, `workers/`. Импорт типов из `core/` допустим (allowTypeImports).
4. `pnpm dev` → `http://localhost:5173/` — основное приложение всё ещё работает (старый AppShell со старыми FilterBar/LogList/SourcePicker рендерится, prod-flow не сломан). В Network нет запросов к `cdn.tailwindcss.com`.
5. `pnpm dev` → `http://localhost:5173/?preview=lv` — открывается дев-страница с `<LvApp/>` на mock-данных, выглядит идентично [src/ui/Log Viewer.html](src/ui/Log%20Viewer.html) (открыть рядом для сравнения **до** удаления HTML — взять скриншот заранее).
6. Прогон по чек-листу регенерации: `git status --porcelain src/hooks/ src/core/ src/workers/ src/app/containers/ src/worker-client/` после коммита декомпозиции должен быть пустым (контракт ADR-0002, см. [docs/adr/0002-headless-architecture.md:80](docs/adr/0002-headless-architecture.md#L80)).
7. Smoke в браузере: оба дев-режима без ошибок в console (`window.__edit_mode`, drag-handler tweaks, click-away listeners — самые вероятные источники warning'ов).

## 7. Out of scope (следующие итерации)

- Замена старого `AppShell.tsx` на новый `LvApp` — требует написания новых хуков (`useTabs`, `useGroupBy`, `useBookmarks`, `useTreeSelection`, `useTimelineRange`, `useTweaks`) и адаптеров под существующие `useLogFilter/useLogWindow/useSelectedEntry`. Отдельный ADR + план.
- Полная Monaco-интеграция (lazy-loaded editor, themes, FTS-подсветка) — отдельный ADR.
- Согласование уровней логов: в дизайне 5 (`error/warn/info/debug/trace`), в core 7 (`+fatal/unknown` — [src/core/types/](src/core/types/)). Решается в wiring-итерации, не сейчас.
- ESLint-правило, форбидящее импорты из `src/dev/` в `src/ui/`/`src/app/`/`src/hooks/` — добавить, когда `src/dev/` появится.
- Миграция inline-стилей в [src/ui/components/{FilterBar,LogList,SourcePicker}.tsx](src/ui/components/) на Tailwind utility-классы или `.lv-*`. Сейчас они работают, не блокируют. Решается, когда придёт регенерация этих компонентов из Claude Design.

## Critical files

- Создать: `src/ui/styles/lv.css`, ~30 файлов в `src/ui/components/<region>/Lv*.tsx`, `src/ui/utils/lv.ts`, `src/dev/log-data-mock.ts`, `src/dev/lv-preview.tsx`, [docs/adr/0008-tailwind-v4-via-package.md](docs/adr/0008-tailwind-v4-via-package.md).
- Изменить: [src/main.tsx](src/main.tsx) (импорт `./ui/styles/lv.css`, опциональный preview-роутинг по query), [vite.config.ts](vite.config.ts) (плагин `tailwindcss()`), [package.json](package.json) и [pnpm-lock.yaml](pnpm-lock.yaml) (`tailwindcss`, `@tailwindcss/vite` в devDeps), [docs/adr/README.md](docs/adr/README.md) (запись об ADR-0008).
- Удалить: `src/ui/Log Viewer.html`, `src/ui/log-app.jsx`, `src/ui/log-viewer.jsx`, `src/ui/log-tree.jsx`, `src/ui/tweaks-panel.jsx`, `src/ui/log-data.js`.
- Не трогать: [src/App.tsx](src/App.tsx), [src/app/AppShell.tsx](src/app/AppShell.tsx), [src/app/containers/](src/app/containers/), [src/app/providers/](src/app/providers/), [src/hooks/](src/hooks/), [src/core/](src/core/), [src/workers/](src/workers/), [src/worker-client/](src/worker-client/), [src/ui/components/{FilterBar,LogList,SourcePicker}.tsx](src/ui/components/), [src/index.css](src/index.css).
