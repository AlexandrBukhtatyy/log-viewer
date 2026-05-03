# 0008. Tailwind v4 как dev-зависимость (а не CDN)

- Status: proposed
- Date: 2026-05-03

## Context and Problem Statement

В каталог `src/ui/` скопирован дамп интерфейса от Claude Design. В исходном `Log Viewer.html` подключён `<script src="https://cdn.tailwindcss.com">`, но utility-классы Tailwind в JSX-коде дампа фактически **не используются** — вся стилизация идёт через кастомные классы `.lv-*` и CSS-переменные (см. [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md), §1).

Дамп переезжает в production-сборку. CDN-вариант неприемлем по трём причинам:

1. **PWA / offline-режим.** Service worker от `vite-plugin-pwa` кеширует только локальные ассеты (см. [vite.config.ts](../../vite.config.ts), `workbox.globPatterns`). CDN-скрипт ломает offline.
2. **Размер и латентность.** Tailwind CDN тянет всю CSS-базу в рантайме, билд её не препроцессит и не tree-shake'ит — на медленной сети это лишний RTT и неоптимальный CSS.
3. **Безопасность.** Сторонний скрипт-runtime в проде требует CSP-исключений, добавляет surface для supply-chain.

Параллельно — нужно решить, **подключать ли Tailwind вообще**, раз сейчас он не используется. Аргумент за: будущие итерации Claude Design с большой вероятностью будут эмитить utility-классы вперемешку с `.lv-*`. Если плагина не будет, такие классы отвалятся в проде, и обнаружится это поздно. Дешевле подключить заранее.

## Considered Options

- **A. Tailwind v4 через `@tailwindcss/vite` plugin.** Vite-нативно, content-detection автоматический, минимум конфигурации. Peer-warning под Vite 8 ожидаем (плагин декларирует `vite ^5..^7`), но не блокирующий — аналогичный warning уже принят для `vite-plugin-pwa@1.2.0` ([CLAUDE.md → Подводные камни](../../CLAUDE.md#подводные-камни)).
- **B. Tailwind v4 через PostCSS-плагин (`@tailwindcss/postcss`).** Без правки `vite.config.ts`. Чуть больше boilerplate (`postcss.config.mjs`), но shielded от peer-конфликтов с Vite — fallback, если A не запустится.
- **C. Tailwind v3 + PostCSS.** Стабильно, но нужен `tailwind.config.{ts,js}` с явным `content`. На 2026-05 v4 — current major, миграция с v3 на v4 — отдельная история. Не выбираем без причины.
- **D. Не подключать Tailwind, оставить только `.lv-*`-CSS.** Отказ от страховки. При появлении utility-классов в новых регенерациях — поломаемся в проде.
- **E. CDN из исходного HTML.** Отвергается по причинам в Context.

## Decision Outcome

Chosen option: **«A. Tailwind v4 через `@tailwindcss/vite` plugin»** — это рекомендуемый Tailwind'ом путь под Vite, минимальная диффа в конфиге, peer-warning не блокирующий и зеркалит уже существующий по `vite-plugin-pwa`. Если `pnpm install` упадёт по строгой валидации peer-deps — переключаемся на B (PostCSS-вариант) без переоткрытия ADR (это тактическая замена, не смена курса).

### Установка

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

### vite.config.ts

```ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({ /* ... */ }),
  ],
})
```

### Точка входа CSS

`src/ui/styles/lv.css` — первой строкой:

```css
@import "tailwindcss";
```

В Tailwind v4 content-detection автоматический: сканируются `.ts/.tsx/.html` без явного `content`-конфига.

### Сосуществование с `.lv-*`

`.lv-*`-классы и Tailwind utility-классы могут жить в одном элементе одновременно. Mass-migration с inline-стилей в `src/ui/components/{FilterBar,LogList,SourcePicker}.tsx` или с `.lv-*` на utility-классы **не входит** в этот ADR — выполняется по мере регенераций UI из Claude Design.

### Consequences

- Good: новые регенерации UI могут эмитить utility-классы — билд их подхватит.
- Good: PWA-кеш покрывает все стили, offline-режим работает.
- Good: dev-bundle и prod-bundle используют один и тот же CSS-pipeline — нет drift'а CDN vs build.
- Bad: peer-warning от `@tailwindcss/vite` × Vite 8 (известно, не блокирует).
- Bad: лишняя dev-зависимость, пока utility-классы не используются. Принимаем как страховку.
- Neutral: появляется новый импорт `@import "tailwindcss"` в [src/ui/styles/lv.css](../../src/ui/styles/lv.css).

## Links

- [docs/plans/replicated-cooking-muffin.md](../plans/replicated-cooking-muffin.md) — план декомпозиции, §1a.
- [CLAUDE.md → Подводные камни](../../CLAUDE.md) — peer-warning Vite 8 × `vite-plugin-pwa`.
- [Tailwind v4 — Vite installation](https://tailwindcss.com/docs/installation/using-vite).
