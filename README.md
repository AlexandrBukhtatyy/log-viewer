# log-viewer

PWA для просмотра логов. React + TypeScript, собирается на Vite, service worker
и manifest генерируются `vite-plugin-pwa`.

## Требования

- Node.js 20+ (репозиторий разрабатывался на 24)
- pnpm (можно поднять через `corepack enable pnpm`)

## Команды

```bash
pnpm install      # установить зависимости
pnpm dev          # dev-сервер на http://localhost:5173 (PWA включена и в dev)
pnpm build        # production-сборка в dist/
pnpm preview      # запуск preview-сборки на http://localhost:4173
pnpm lint         # ESLint
```

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
- [scripts/](scripts/) — служебные скрипты (генерация иконок)
