# Per-source customization (личные настройки источников)

## Context

Сейчас источники одинаковы для пользователя: одно дерево, одни и те же колонки на весь viewer, одни и те же глобальные фильтры. На практике хочется разное: для `nginx-access.log` — широкая `request_uri` и `status`, для pino-JSONL — `service` и `trace_id`, для прода один цвет, для стейджа — другой. Сейчас всё это переносится между источниками вручную каждый раз.

Цель: позволить пользователю **закрепить** настройки UI **за конкретным источником** (не глобально и не за активной вкладкой), чтобы при повторном открытии того же файла/папки раскладка восстанавливалась автоматически.

## Scope (черновик — обсудить)

Что входит в «личные настройки» источника:

1. **Color tag / accent** — цветной маркер источника, виден в сайдбаре и шапках вкладок (поможет различать прод/стейдж/локальный).
2. **Alias** — короткое имя, отображаемое поверх оригинального `source.name`.
3. **Column overrides** — свой набор `LvColumnPref[]` для этого источника (когда он единственный активный или активная вкладка). Перекрывает глобальный `tweaks.columns`.
4. **Default filter** — `LogFilter` (или его подмножество), который автоматически применяется при первом открытии вкладки этого источника. Удобно для «всегда показывай только ERROR/WARN».
5. **Pinned saved-searches** — отдельный список saved-searches, привязанный к источнику.

Решения, которые надо принять до реализации:
- Применяются ли overrides только когда источник активен **в одиночку** или всегда?
- Что приоритетнее при конфликте: глобальные columns / source-overrides / последнее ручное действие?
- Как мигрировать существующий `tweaks.columns` (UI-prefs)?
- Где хранить — добавлять в `tweaks.sources[sourceId]` (LocalStorage, как сейчас prefs) или в IDB рядом с handles?

## Подход

Хранилище: новый zustand-store `use-source-prefs` с `persist({ name: 'lv:source-prefs' })`. Ключ — `sourceId`. На уровне UI hook возвращает merge: `globalDefault ⊕ sourcePrefs[sourceId]`.

Контракт:

```ts
interface LvSourcePrefs {
  accent?: string;        // hex или CSS-color
  alias?: string;
  columns?: LvColumnPref[];
  filter?: Partial<LogFilter>;
}
```

UI-точки:
- В контекст-меню источника в сайдбаре — пункт «Настройки этого источника…» → попап `<LvSourceSettingsModal>` с полями.
- Цветовой маркер: тонкая полоска слева от `<LvTreeNode>` для root-нод (когда `accent` задан).
- Когда активная вкладка — конкретный источник, применять source-overrides поверх глобальных.

## Critical files (предварительно)

Новые:
- `src/hooks/use-source-prefs.ts` — zustand store + merge-helper.
- `src/ui/components/sidebar/LvSourceSettingsModal.tsx` — попап.
- `src/ui/styles/lv.css` — стили accent-полоски.

Изменяются:
- `src/ui/components/sidebar/LvTreeNode.tsx` — отображение accent + alias, context-menu пункт.
- `src/app/containers/LvAppContainer.tsx` — merge source-prefs с глобальными tweaks/filter при смене активной вкладки.
- `src/ui/contracts/lv-types.ts` — поля `accent?`/`alias?` на `LvCatalogRoot` (если решим читать из catalog'а).

## Verification

1. Открыть pino.jsonl, выставить accent (например розовый) → сайдбар показывает розовую полоску.
2. На этом же источнике задать columns `[service, trace_id]` → колонки применились.
3. Закрыть вкладку, открыть снова — accent/columns восстановились.
4. Открыть другой источник — у него свой набор колонок (или default), accent отсутствует.
5. Применить `clearAll` → source-prefs тоже чистятся (или флаг чекбокса в Clear-modal: «личные настройки источников»).
6. `pnpm test && pnpm lint && pnpm build` — без новых ошибок.
