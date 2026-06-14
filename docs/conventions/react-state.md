# React и state

## Компоненты

- Стрелочные функции с префиксом `Lv`; props — `export interface LvXProps` с `readonly`:

  ```tsx
  export interface LvFooProps {
    readonly value: string;
    onChange: (v: string) => void;
  }
  export const LvFoo = ({ value, onChange }: LvFooProps) => {
    /* ... */
  };
  ```

- Деструктуризация props в сигнатуре, дефолты там же (`orientation = 'row'`).
- JSDoc-блок над компонентом со списком мест использования — образцы
  [LvSearchInput.tsx](../../src/ui/components/common/LvSearchInput.tsx),
  [LvFormField.tsx](../../src/ui/components/common/LvFormField.tsx).

## Container / dumb (ADR 0002, 0010)

- `src/ui/components/**` — **только props-driven**, без импортов из `hooks`/`workers`/`app`
  (из `core` — только типы). Граница enforced в [eslint.config.js](../../eslint.config.js).
- Хуки вызываются только в контейнерах `src/app/containers/` — единственный шов.

## Модалки

- `if (!open) return null;` в начале.
- Закрытие по Escape — `useEffect` + `keydown`-listener с cleanup.
- Scrim закрывает по клику, содержимое — `onMouseDown={(e) => e.stopPropagation()}`.

## Hooks

- Живут в `src/hooks/`, реэкспорт из [src/hooks/index.ts](../../src/hooks/index.ts).
- Каждый хук возвращает `export interface UseXxx { ... }` — это **контракт** между
  containers и UI (стабилен между регенерациями UI).
- Поля результата `readonly`, методы в `useCallback`.

## State — Zustand (ADR [0007](../adr/0007-state-management-zustand.md))

- Чистый core-store класс + Zustand-обёртка.
- `ViewStore` пробрасывается через React Context (`useViewStore()` бросает вне провайдера).
- Подписка через селекторы по одному полю: `useStore(store, (s) => s.totalCount)` — чтобы
  не перерисовывать лишнее. Мутации — `store.getState().setX(...)`.

## Доступность (a11y)

- Иконки без текста — `aria-hidden="true"`; интерактив без видимого текста — `aria-label`.
- `role` для не-нативных виджетов (`role="dialog"`, `role="switch"`, `role="separator"`).
- Поля: `htmlFor`/`id`, `aria-invalid` на ошибочном вводе.
