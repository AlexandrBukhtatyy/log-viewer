# log-viewer

- [Лендинг](https://alexandrbukhtatyy.github.io/log-viewer/)
- [Приложение](https://alexandrbukhtatyy.github.io/log-viewer/app/)

PWA для просмотра логов. React + TypeScript, собирается на Vite, service worker
и manifest генерируются `vite-plugin-pwa`.

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

## Структура

- [src/](src/) — исходники приложения
- [public/](public/) — статические ассеты, копируются в корень `dist/`
- [scripts/](scripts/) — служебные скрипты (генерация иконок, генерация локальных лог-фикстур)
- [docs/](docs/) — документация проекта, в т.ч. [docs/adr/](docs/adr/) — Architecture Decision Records
- [.claude/](.claude/) — конфиг Claude Code: команда `/adr` для создания ADR и Stop-hook ADR-напоминалки
