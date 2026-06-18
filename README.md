# log-viewer

[![Release](https://img.shields.io/github/v/release/AlexandrBukhtatyy/log-viewer?include_prereleases&sort=semver)](https://github.com/AlexandrBukhtatyy/log-viewer/releases)
[![Changelog](https://img.shields.io/badge/changelog-keep%20a%20changelog-orange)](CHANGELOG.md)

- [Лендинг](https://alexandrbukhtatyy.github.io/log-viewer/)
- [Приложение](https://alexandrbukhtatyy.github.io/log-viewer/app/)

PWA для просмотра логов. React + TypeScript, собирается на Vite, service worker
и manifest генерируются `vite-plugin-pwa`.

## Обратная связь

Нашли баг? Откройте [Issue](https://github.com/AlexandrBukhtatyy/log-viewer/issues). Есть идея? Напишите в [Discussions](https://github.com/AlexandrBukhtatyy/log-viewer/discussions).

## Релизы

История изменений — [CHANGELOG.md](CHANGELOG.md), готовые сборки — на странице [Releases](https://github.com/AlexandrBukhtatyy/log-viewer/releases). Версионирование — [semver](https://semver.org/), коммиты — [Conventional Commits](https://www.conventionalcommits.org/), релизы автоматизированы через [release-please](https://github.com/googleapis/release-please) (правила в [CONTRIBUTING.md](CONTRIBUTING.md#релизы)).

## Требования

- Node.js 20+ (репозиторий разрабатывался на 24)
- pnpm (можно поднять через `corepack enable pnpm`)
- [jq](https://jqlang.org/) — нужен для Stop-hook'а Claude Code, который напоминает фиксировать архитектурные решения как ADR (см. [docs/adr/](docs/adr/)). Установка: `brew install jq` (macOS) / `apt install jq` (Debian/Ubuntu). Без `jq` хук молчит и не мешает работе, но ADR-напоминалка перестаёт срабатывать.

## Команды

```bash
pnpm install        # установить зависимости
pnpm dev            # dev-сервер на http://localhost:5173 (PWA включена и в dev)
pnpm build          # production-сборка в dist/
pnpm preview        # запуск preview-сборки на http://localhost:4173
pnpm lint           # ESLint
pnpm test           # Vitest (run-mode); pnpm test:watch — watch-mode
pnpm gen:fixtures   # сгенерировать sample-логи в .tmp/ (см. ниже)
```

## Локальные фикстуры

`pnpm gen:fixtures` ([scripts/gen-fixtures.mjs](scripts/gen-fixtures.mjs)) пишет в `.tmp/` набор sample-логов разных форматов (pino JSON, bunyan/ISO JSON, plain-text, nginx access, multi-line tracebacks, mixed, плюс крупный ~6.5 MB файл для нагрузки). Каталог `.tmp/` в `.gitignore`; данные детерминированы, перегенерируются из фиксированного seed. Используется для ручной проверки viewer'а на разнообразных входных данных.

## PWA

- Конфигурация плагина: [vite.config.ts](vite.config.ts)
- Иконки в [public/](public/) — `pwa-192x192.png`, `pwa-512x512.png`,
  `apple-touch-icon.png`. Сейчас это одноцветные заглушки, сгенерированные
  скриптом [scripts/gen-icons.mjs](scripts/gen-icons.mjs). Замени их на
  настоящие, когда появится дизайн.
- Service worker регистрируется автоматически (`registerType: 'autoUpdate'`).

## On-prem развёртывание

Помимо публичной сборки на GitHub Pages, log-viewer публикуется как npm-пакет [`@log-viewer/app`](https://www.npmjs.com/package/@log-viewer/app) — для использования внутри закрытых корпоративных контуров без интернета. Пакет содержит собранную PWA и встроенный HTTP-сервер (`bin/cli.mjs`, без runtime-зависимостей), готовый к запуску за reverse proxy с TLS.

Подробное обоснование решения — [ADR-0029](docs/adr/0029-on-prem-npm-package-distribution.md).

### Локально

```bash
npx @log-viewer/app --port 8080
# или
pnpm dlx @log-viewer/app --port 8080
```

Откроется на `http://localhost:8080/`. Опции: `--port`, `--host`, `--dir`, `--no-sw`, `--healthcheck-path`, `--quiet`. Подробности — `npx @log-viewer/app --help`.

### Docker

В корне репо есть готовый [`Dockerfile`](Dockerfile). По умолчанию ставит пакет с публичного npmjs.org; для закрытого контура передайте URL зеркала через build-arg:

```bash
docker build -t log-viewer:0.1.1 \
  --build-arg PKG_VERSION=0.1.1 \
  --build-arg NPM_REGISTRY=https://nexus.internal/repository/npm-proxy/ .

docker run --rm -p 8080:8080 log-viewer:0.1.1
```

Полностью offline-сценарий: собрать образ на машине с интернетом → `docker save log-viewer:0.1.1 -o log-viewer.tar` → перенести `.tar` в закрытый контур → `docker load -i log-viewer.tar`.

### ⚠️ TLS обязателен

Service worker и OPFS (SQLite в браузере) требуют **secure context**: HTTPS или `localhost`. На голом HTTP-IP PWA сломается тихо — SW не зарегистрируется, OPFS-API вернёт `undefined`. Деплоить либо за TLS-terminating reverse proxy, либо запускать с флагом `--no-sw` (отключит PWA-режим, но сохранит работу таблицы логов).

### Сборка on-prem-бандла

```bash
pnpm build:onprem
# → dist/app/ — корень для bin/cli.mjs
```

В отличие от `pnpm build`, эта команда задаёт `BUILD_TARGET=onprem`, что переключает Vite на `base: '/'`, выкидывает лендинг и перенастраивает PWA scope под root. См. [vite.config.ts](vite.config.ts).

## Структура

- [src/](src/) — исходники приложения
- [public/](public/) — статические ассеты, копируются в корень `dist/`
- [scripts/](scripts/) — служебные скрипты (генерация иконок, генерация локальных лог-фикстур)
- [docs/](docs/) — документация проекта, в т.ч. [docs/adr/](docs/adr/) — Architecture Decision Records
- [.claude/](.claude/) — конфиг Claude Code: команда `/adr` для создания ADR и Stop-hook ADR-напоминалки
