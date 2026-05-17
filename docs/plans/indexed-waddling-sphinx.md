# Публикация log-viewer на GitHub Pages

## Контекст

Нужно опубликовать PWA на GitHub Pages как project page по адресу
`https://alexandrbukhtatyy.github.io/log-viewer/`. Деплой — автоматический на
push в `main`. Сейчас в проекте нет ни `base` в Vite, ни workflow, а в
PWA-манифесте `start_url: '/'` — для project page это сломает установленную PWA
(она будет пытаться контролировать весь `github.io`).

Параллельные цели:

- ассеты и сервис-воркер должны корректно резолвиться под подпутём
  `/log-viewer/`;
- установленная PWA должна открываться внутри подпути, а не в корне
  `github.io`;
- сборка и деплой воспроизводятся CI без ручных шагов после первого включения
  Pages.

Router'а в `src/` сейчас нет, поэтому SPA-fallback (`404.html`) не требуется —
только заметка на будущее.

## Что меняем

### 1. [vite.config.ts](../../vite.config.ts) — `base` и PWA-манифест

Ключевые правки:

```ts
export default defineConfig({
  base: '/log-viewer/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: { enabled: true },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // …существующие поля без изменений…
        start_url: '/log-viewer/',
        scope: '/log-viewer/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/log-viewer/index.html',
      },
    }),
  ],
})
```

Почему:

- `base` — единый источник истины. Vite ребейзит все ассеты в
  [index.html](../../index.html), а `vite-plugin-pwa` тем же `base` подмешивает
  префикс в SW-регистрацию и precache.
- Абсолютные `start_url` и `scope: '/log-viewer/'` убирают двусмысленность с
  относительными путями и совпадают с тем, что Workbox эмитит по умолчанию для
  SW под подпутём.
- `navigateFallback` — задел под будущий роутер; сейчас безвреден.
- Воркеры через `new URL('../workers/...', import.meta.url)`
  ([coordinator-client.ts:10-12](../../src/worker-client/coordinator-client.ts#L10-L12),
  [coordinator/index.ts:19](../../src/workers/coordinator/index.ts#L19))
  и WASM SQLite (`@sqlite.org/sqlite-wasm`) подхватятся автоматически — Vite
  эмитит их в `dist/assets/`, путь префиксируется `base`. Изменения в коде не
  требуются.

### 2. [package.json](../../package.json) — `packageManager`

Добавить поле, чтобы corepack в CI использовал ту же версию pnpm, что и
локально (проверено `pnpm -v` → `10.33.2`):

```jsonc
{
  "name": "log-viewer",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  // …
}
```

### 3. `.github/workflows/deploy.yml` — новый файл

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        # версия читается из packageManager в package.json

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Заметки:

- `concurrency.cancel-in-progress: false` — рекомендация GitHub: прерванный
  `deploy-pages` может оставить сайт в полуразвёрнутом состоянии.
- Node 20 LTS на CI достаточно для Vite 8 (требует ≥ 20.19 / 22.12); локально
  можно оставаться на 24.
- `actions/configure-pages@v5` для Vite ничего не переписывает — `base` уже
  задан вручную, это и есть рекомендованный паттерн.

### 4. `.gitignore`

Не трогаем — `dist` и `dev-dist` уже игнорируются.

## Ручные шаги в GitHub UI (один раз)

1. Закоммитить и запушить изменения в `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Без этого `actions/deploy-pages@v4` упадёт.
3. После первого успешного запуска убедиться, что окружение `github-pages`
   создалось (Settings → Environments) и разрешает деплой с ветки `main`.

## Проверка

### Локально, до пуша

1. `pnpm build` — убедиться, что в `dist/index.html` ассеты идут через
   `/log-viewer/...`, а `dist/sw.js` создан.
2. `pnpm preview` — открыть `http://localhost:4173/log-viewer/`. Корень `/` в
   preview даст 404, это норма.
3. DevTools → Application:
   - Manifest: `start_url` и `scope` равны `/log-viewer/`.
   - Service Worker зарегистрирован по `/log-viewer/sw.js`, scope
     `/log-viewer/`.
4. DevTools → Network с отключённым кэшем: ноль 404, воркер парсера и SQLite
   WASM тянутся из `/log-viewer/assets/...`.

### После первого деплоя

1. Открыть `https://alexandrbukhtatyy.github.io/log-viewer/` — 200, нет 404 в
   Network.
2. SW зарегистрирован на `https://alexandrbukhtatyy.github.io/log-viewer/sw.js`
   со scope `/log-viewer/`.
3. Установить PWA из адресной строки, перезапустить — приложение должно
   открыться по `/log-viewer/`, не по корню.
4. Прогнать загрузку лога и индексацию — убедиться, что воркеры стартуют без
   ошибок.

## Риски и заметки

- **vite-plugin-pwa 1.2.0 vs Vite 8** — peer-dep плагина `vite@^3..^7`, мы на 8.
  Документировано в [CLAUDE.md](../../CLAUDE.md). Сборка зелёная,
  `base`-логика плагина не менялась с 0.x. Если сломается — даунгрейд Vite до
  7 либо ждать релиз плагина.
- **`packageManager: pnpm@10.33.2`** — pin. Если хочется автоматически
  подтягивать минорные апдейты, заменить на `pnpm@10` и дать
  `pnpm/action-setup` выбрать последнюю 10.x.
- **`registerType: 'autoUpdate'`** — пользователи получают обновлённый SW в
  фоне; одно перезагрузка после деплоя может ещё показать старый shell, но
  ассеты хэшированы, конфликта не будет.
- **Роутер появится позже** — тогда нужен либо `HashRouter`, либо
  пост-билд-шаг `cp dist/index.html dist/404.html`. Сейчас не требуется,
  фиксировать ADR имеет смысл в момент добавления роутера.

## Критичные файлы

- [vite.config.ts](../../vite.config.ts)
- [package.json](../../package.json)
- `.github/workflows/deploy.yml` (новый)
- [src/worker-client/coordinator-client.ts](../../src/worker-client/coordinator-client.ts)
  и [src/workers/coordinator/index.ts](../../src/workers/coordinator/index.ts)
  — изменений нет, но это контрольные точки на регрессию при ревью PR.
