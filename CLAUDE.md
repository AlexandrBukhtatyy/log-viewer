# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PWA для просмотра логов. SPA на React 19 + TypeScript, собирается на Vite 8.
Service worker и Web App Manifest генерируются `vite-plugin-pwa` (Workbox под капотом).
Проект только что инициализирован — реальной функциональности log viewer'а ещё нет, есть только скелет от Vite-шаблона `react-ts` и PWA-обвязка.

## Tooling

- **Package manager:** pnpm (требуется). Если не установлен: `corepack enable pnpm`.
- **Node:** 20+ (разрабатывался на 24).

## Команды

```bash
pnpm dev        # vite dev-server, http://localhost:5173, PWA включена через devOptions.enabled
pnpm build      # tsc -b && vite build → dist/ (включая sw.js, manifest.webmanifest)
pnpm preview    # vite preview, http://localhost:4173 — для проверки prod-сборки локально
pnpm lint       # ESLint (flat config)
```

Тестового фреймворка пока нет. Если будешь добавлять — Vitest идиоматичен для Vite.

## Архитектура

Standard Vite SPA:
- [src/main.tsx](src/main.tsx) — точка входа, монтирует `<App />` в `#root`
- [src/App.tsx](src/App.tsx) — корневой компонент (пока стартовая страница Vite)
- [index.html](index.html) — единственный HTML, содержит PWA-метатеги (theme-color, apple-touch-icon)

PWA-слой:
- [vite.config.ts](vite.config.ts) — конфиг `VitePWA({ registerType: 'autoUpdate', injectRegister: 'auto', ... })`. SW регистрируется автоматически через виртуальный модуль плагина — вручную ничего регистрировать не нужно.
- [public/](public/) — иконки `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`. Это **одноцветные PNG-заглушки**, сгенерированные [scripts/gen-icons.mjs](scripts/gen-icons.mjs) без внешних зависимостей. При замене на реальные иконки — либо положить вручную с теми же именами, либо переписать скрипт/использовать `@vite-pwa/assets-generator`.
- В dev-режиме SW и манифест отдаются через `/dev-sw.js?dev-sw` и `/manifest.webmanifest`; артефакты dev-сборки попадают в `dev-dist/` (не в `.gitignore` сейчас — добавить, если будут коммиты).

TypeScript:
- Project references: [tsconfig.json](tsconfig.json) → [tsconfig.app.json](tsconfig.app.json) (src) + [tsconfig.node.json](tsconfig.node.json) (vite.config). Типы PWA подключены через `"types": ["vite/client", "vite-plugin-pwa/client"]` в `tsconfig.app.json`.

ESLint: flat config ([eslint.config.js](eslint.config.js)), `dist` в globalIgnores.

## Подводные камни

- `vite-plugin-pwa@1.2.0` декларирует peer-зависимость `vite@^3..^7`, но проект на Vite 8. На момент инициализации build и dev зелёные. Если плагин когда-нибудь сломается — даунгрейд Vite до 7 решит, либо ждать релиз плагина с поддержкой Vite 8.
- `name` в [package.json](package.json) — `log-viewer` (не `init`, как было в шаблоне Vite).
- `pnpm install` после клона обязателен — pnpm-lock.yaml зафиксирован.
