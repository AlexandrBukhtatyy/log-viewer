# TypeScript

## interface vs type

- **`interface`** — структуры, props, контракты (особенно с методами/расширением):
  `LogParser`, `LvSidebarProps`, `LogEntry`.
- **`type`** — union'ы, алиасы, discriminated unions: `LogLevel`, `LogSource`, `LvNode`.

## readonly везде

Поля типов и props — `readonly` по умолчанию; коллекции — `ReadonlyArray` /
`ReadonlySet` / `Readonly<Record<…>>`:

```ts
export interface LvSidebarProps {
  readonly catalog: ReadonlyArray<LvCatalogRoot>;
  readonly selectedIds: ReadonlySet<string>;
}
```

Исключение — сигнатуры коллбэков (`onChange: (next: string) => void`).

## Union вместо enum

Перечислимые значения — строковые union-типы (tree-shakeable, видны в типах):

```ts
export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'unknown';
```

## Discriminated unions

Дискриминатор — поле `kind` (домен) или `type` (UI):

```ts
export type LogSource = FileLogSource | DirectoryLogSource; // .kind
export type LvNode = LvFileNode | LvFolderNode; // .type
```

## Brand-типы для идентификаторов

```ts
export type EntryId = string & { readonly __brand: 'EntryId' };
export type SourceId = string & { readonly __brand: 'SourceId' };
```

## Централизация доменных типов

Доменные типы — в `src/core/types/`, реэкспорт из
[src/core/types/index.ts](../../src/core/types/index.ts). UI потребляет core-типы
напрямую (ADR 0010), без адаптеров.

## Строгость (tsconfig)

`tsconfig.app.json` включает `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. Полный `strict: true` **не**
включён — см. «Осознанные пробелы» в [tooling.md](tooling.md).
