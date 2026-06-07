# On-prem дистрибутив: npm-пакет + Dockerfile

## Context

Сейчас [log-viewer](../../README.md) разворачивается только как статика на GitHub Pages (workflow [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)) с `base: '/log-viewer/'` и multi-page билдом (лендинг + app). Для on-prem-инсталляций в закрытом контуре (без интернета, с приватным npm-зеркалом) нужен независимый артефакт, который:

- ставится как обычный npm-пакет (`npm install`/`npx`) — закрытые контуры почти всегда имеют npm-proxy (Verdaccio/Nexus/JFrog);
- содержит готовый HTTP-сервер, чтобы не требовать nginx;
- упаковывается в Docker одной командой через готовый `Dockerfile` в репо.

Приложение полностью клиентское: нет backend, нет fetch на API, всё хранится локально в OPFS через [@sqlite.org/sqlite-wasm](../../package.json). Это упрощает on-prem до «отдать статику + правильные MIME».

## Решения

| Что | Решение | Почему |
|---|---|---|
| Имя пакета | `@abukhtatyy/log-viewer` | `log-viewer` занят; личный scope даёт зарезервированный namespace без org. |
| Имя бинаря | `log-viewer` (`npx @abukhtatyy/log-viewer`) | Совпадает с интуицией; коллизий с существующим `log-viewer@1.x` (его bin = `tail-logs`) нет. |
| HTTP-сервер | Встроенный `node:http`, без зависимостей | Минимум supply chain для закрытого контура. `sirv`/`fastify-static` подтягивают `mrmime`/`totalist` — лишнее. |
| Сборка | Один `vite.config.ts` с env-флагом `BUILD_TARGET=onprem` | Один источник правды; alt — два конфига — даёт дрейф плагинов. |
| Base path | `base: '/'` для on-prem (mount только в root) | VitePWA генерирует абсолютные URL в precache manifest и worker URLs; `'./'` ломает SW и `start_url`/`scope`. `--base-path` отложен до явного запроса. |
| Содержимое | Только app, без лендинга | Решение пользователя. В on-prem лендинг бесполезен. |
| Service Worker | Включён по умолчанию, флаг `--no-sw` для отключения | Дефолт даёт offline + instant load; `--no-sw` нужен для okружений без TLS, где SW не зарегистрируется. |
| HTTP-headers | `X-Content-Type-Options: nosniff` + правильные MIME (особенно `.wasm`) | COOP/COEP **не нужны** — sqlite-wasm уже использует `OpfsAsyncProxy` через MessageChannel (см. `sqlite3-opfs-async-proxy-*.js` в текущем dist), SharedArrayBuffer не требуется. |
| Registry | Публичный npmjs.org с `--provenance` | Закрытый контур ставит через своё зеркало. |
| Docker | Только `Dockerfile` в репо, без push в GHCR | Решение пользователя. |
| GitHub Pages билд | Без изменений (default `BUILD_TARGET=pages`) | `deploy.yml` не трогаем. |

## Файлы

### Модифицируем

**[vite.config.ts](../../vite.config.ts)** — добавляем переключатель сценариев:

```ts
const TARGET = process.env.BUILD_TARGET ?? 'pages'   // 'pages' | 'onprem'
const isOnprem = TARGET === 'onprem'

// внутри defineConfig:
base: isOnprem ? '/' : '/log-viewer/',
build: {
  rollupOptions: {
    input: isOnprem
      ? { app: resolve(__dirname, 'app/index.html') }
      : { main: resolve(__dirname, 'index.html'),
          app:  resolve(__dirname, 'app/index.html') },
  },
},
// в VitePWA({...}):
manifest: {
  // ...
  start_url: isOnprem ? '/' : '/log-viewer/app/',
  scope:     isOnprem ? '/' : '/log-viewer/app/',
},
workbox: {
  navigateFallback: isOnprem ? 'index.html' : '/log-viewer/app/index.html',
  navigateFallbackDenylist: isOnprem ? [] : [
    /^\/log-viewer\/$/, /^\/log-viewer\/index\.html$/,
  ],
},
```

В on-prem-билде Vite кладёт `app/index.html` в `dist/app/index.html`. CLI отдаёт SPA из `dist/app/`, поэтому путь к корню — `dist/app/index.html`. Альтернатива: вынести app entry в корень `dist/` через `build.rollupOptions.output` — не делаем, не стоит сложности.

→ CLI знает про два каталога: `--dir` по умолчанию равен `<package>/dist/app`.

**[package.json](../../package.json)** — снимаем `private`, добавляем поля для публикации:

```jsonc
{
  "name": "@abukhtatyy/log-viewer",
  "type": "module",
  "bin": { "log-viewer": "./bin/cli.mjs" },
  "files": ["dist/", "bin/", "README.md", "LICENSE"],
  "exports": { ".": "./bin/cli.mjs" },
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    // ...
    "build:onprem": "BUILD_TARGET=onprem vite build"
  }
}
```

Снять `"private": true`. Добавить минимальный `LICENSE` (MIT) в корень — npm с provenance ругается без него.

### Создаём

**`bin/cli.mjs`** — встроенный `node:http`-сервер с:
- опциями `--port`/`PORT`, `--host`/`HOST`, `--no-sw`, `--healthcheck-path`/`HEALTHCHECK_PATH`, `--quiet`;
- MIME-картой с `.wasm → application/wasm` и `.webmanifest → application/manifest+json`;
- `Cache-Control: immutable` для `assets/*` и `no-cache` для `index.html`/`sw.js`/`manifest.webmanifest`;
- SPA fallback на `index.html`;
- защитой от path traversal (`normalize` + проверка `startsWith(ROOT)`);
- `GET /healthz → 200 ok`;
- `dist/app/` как корень (см. выше про rollup input).

Скелет из proposal от Plan-агента, доводится до прод-готовности (logging, ошибки, graceful shutdown по `SIGTERM`).

**`Dockerfile`** — multi-stage `node:20-alpine` с поддержкой двух сценариев установки:

```dockerfile
ARG PKG_VERSION=latest
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG PKG_TARBALL=

FROM node:20-alpine AS install
WORKDIR /opt
ARG PKG_VERSION
ARG NPM_REGISTRY
ARG PKG_TARBALL
COPY ${PKG_TARBALL:-/dev/null} /tmp/pkg.tgz 2>/dev/null || true
RUN if [ -s /tmp/pkg.tgz ]; then \
      npm install --prefix /opt /tmp/pkg.tgz --omit=dev ; \
    else \
      npm install --prefix /opt --registry="$NPM_REGISTRY" \
        @abukhtatyy/log-viewer@${PKG_VERSION} --omit=dev ; \
    fi

FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /opt
COPY --from=install --chown=app:app /opt/node_modules /opt/node_modules
USER app
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["node","/opt/node_modules/@abukhtatyy/log-viewer/bin/cli.mjs"]
CMD []
```

Оба сценария установки:
- из registry (с возможностью указать зеркало): `docker build --build-arg PKG_VERSION=0.2.0 --build-arg NPM_REGISTRY=https://nexus.internal/repository/npm-proxy/ .`
- полный offline через tarball: `pnpm pack` → `docker build --build-arg PKG_TARBALL=./abukhtatyy-log-viewer-0.2.0.tgz .`

Плюс `.dockerignore` (минимум: `node_modules`, `dist`, `dev-dist`, `.tmp`, `.git`).

**`.github/workflows/publish-npm.yml`** — публикация на release:

```yaml
name: Publish to npm
on:
  release:
    types: [published]
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: 'https://registry.npmjs.org/'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:onprem
      - run: pnpm publish --no-git-checks --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Требует `NPM_TOKEN` (automation token) в GitHub Secrets. `--provenance` работает с `id-token: write`. release-please уже бампит версию в `package.json` перед триггером.

**`docs/adr/0XXX-on-prem-distribution.md`** — ADR со статусом `proposed`. Фиксируем выбор npm + bundled CLI + относительно слепого Dockerfile vs альтернатив (только nginx, только GHCR-образ, только static tarball на release). Регистрируем в [docs/adr/README.md](../adr/README.md).

## Совместимость

- `pnpm build` (default `BUILD_TARGET=pages`) — поведение не меняется, `deploy.yml` пушит на GitHub Pages как раньше.
- `pnpm build:onprem` — кладёт `dist/app/*` и связанную статику в `dist/`. CLI читает из `dist/app/`. На локальной машине, если нужны параллельные билды, чистить `dist/` между ними вручную (не делаем второй outDir — лишний шум).
- `vite-plugin-pwa@1.2.0` peer-mismatch с Vite 8 — известный, документирован в [CLAUDE.md](../../CLAUDE.md), новый билд этого не усугубляет.

## Риски (отслеживать)

- **SW + HTTPS:** OPFS и SW требуют secure context. В Docker за TLS-proxy — OK. По голому HTTP-IP — PWA сломается тихо. **Жирно в README** + предлагается `--no-sw` для downgrade-сценариев.
- **Кеш старого SW при обновлении пакета:** `registerType: 'autoUpdate'` + `clientsClaim`/`skipWaiting` уже стоят, баннер обновления (`LvUpdateBanner`) уже есть; новых рисков on-prem не добавляет.
- **`files` whitelist:** обязательная проверка `npm pack --dry-run` до публикации, чтобы не залить `node_modules`/`.tmp`.
- **OPFS режим:** если когда-нибудь переключимся на `OpfsSAHPool`, CLI придётся научить COOP/COEP — фиксируем в ADR follow-up.

## Verification

1. **Локальный билд on-prem:** `BUILD_TARGET=onprem pnpm vite build` → `dist/app/index.html` существует, в `dist/sw.js` нет упоминаний `/log-viewer/`.
2. **CLI smoke-тест:** `node bin/cli.mjs --port 8080` → `curl http://127.0.0.1:8080/healthz` = 200; `curl -I http://127.0.0.1:8080/assets/<wasm>` → `Content-Type: application/wasm` + `Cache-Control: immutable`; `curl http://127.0.0.1:8080/whatever-spa-route` → отдаёт `index.html`.
3. **Playwright проверка app:** через `mcp__playwright__browser_navigate` на `http://localhost:8080/`, загрузить `.tmp/pino.jsonl`, убедиться что таблица рендерится и OPFS не падает (console без ошибок). Скриншоты — в [.tmp/screenshots/](../../.tmp/screenshots/).
4. **`npm pack --dry-run`:** проверить что в tarball только `dist/`, `bin/`, `README.md`, `LICENSE`, `package.json`. Размер ≤ 3 MB.
5. **Docker build:** `docker build --build-arg PKG_TARBALL=./abukhtatyy-log-viewer-*.tgz -t log-viewer:test .` → `docker run --rm -p 8080:8080 log-viewer:test` → app открывается на `http://localhost:8080/`, healthcheck зелёный (`docker ps` → status `(healthy)`).
6. **CI dry-run:** `act` или `workflow_dispatch` на тестовой ветке (без `npm publish` — заменить на `pnpm publish --dry-run`).
