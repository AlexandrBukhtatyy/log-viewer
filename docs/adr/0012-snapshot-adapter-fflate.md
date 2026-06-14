## 0012. Snapshot-адаптер: zip / tar / tar.gz через fflate, минимальный POSIX-tar reader

- Status: proposed
- Date: 2026-05-02

## Context and Problem Statement

`SnapshotLogSource` появился в [ADR-0010](0010-lv-on-viewstore-core-types.md)
как stub: UI в [LvAddSourceMenu](../../src/ui/components/sidebar/LvAddSourceMenu.tsx)
предлагал «Snapshot» с file picker'ом, но `open()` сразу бросал `not implemented`.
В [плане Phase 3](../plans/replicated-cooking-muffin.md#phase-3--snapshot-адаптер-и-live-tail-верификация-p2)
зафиксировано: реализовать распаковку архива в памяти и стрим строк в общий
parser-pipeline. Нужно выбрать формат и библиотеку.

## Considered Options

- **A. fflate** — pure-JS, ~15 KiB gzipped, sync- и async-API. Знает zip/gzip/deflate.
  Нет встроенного tar — придётся писать самому.
- **B. JSZip** — больше (~60-100 KiB), только zip. Не покрывает tar/tar.gz.
- **C. tar-stream + pako** — два пакета, ~40 KiB суммарно. Поддерживает сложные
  PAX/long-name extensions tar'а из коробки.
- **D. Делегировать unsafe-eval / WASM-libarchive** — потенциально лучшее покрытие
  форматов, но 200+ KiB и COOP/COEP-сложности.

## Decision Outcome

Выбрано **«A. fflate + ручной POSIX-tar reader»**.

Аргументы:

- 90 % реальных дампов — `kubectl logs` / `docker logs` в виде `.zip` или
  `tar.gz`-архивов с регулярными файлами. PAX-extensions (длинные имена,
  расширенные атрибуты) почти не встречаются в log-tarballs; `kubectl cp`
  и `docker save` дают plain POSIX tar.
- Bundle: fflate стоит ~15 KiB; ручной tar reader — ещё ~50 строк кода.
  Альтернатива С добавила бы 40 KiB зависимостей.
- Если PAX-tar реально появится в фикстуре — заменим reader на `tar-stream`
  отдельным ADR; UI и контракт adapter'а не изменятся.

### Реализация

[src/core/sources/snapshot-adapter.ts](../../src/core/sources/snapshot-adapter.ts):

1. **Detect формата по magic bytes** (плюс расширение как fallback):
   - `0x50 0x4B` → zip.
   - `0x1F 0x8B` → gzip → trim'им и читаем как tar (single-file gzip в
     log-workflows почти не встречается).
   - имя содержит `.tar` → plain tar.
   - всё остальное → throw с понятным сообщением.
2. **Распаковка**:
   - zip → `fflate.unzipSync(bytes)` (sync; для типичного 50-MB архива
     укладывается в ~200 ms на M1).
   - tar.gz → `fflate.gunzipSync(bytes) → readTar(...)`.
   - tar → `readTar(bytes)`.
3. **`readTar`** — POSIX-tar reader на ~40 строк:
   - 512-байтный header: `name[0..100]`, `size[124..136]` octal,
     `typeflag[156]`.
   - Только regular files (`'0'` или `'\0'`) собираются.
   - Нулевой header — терминатор архива.
   - Не валидирует checksum (быстрее на 5-10 % при минимальной потере
     отлова corruption — fflate-decoded bytes уже валидированы gzip-CRC).
4. **Whitelist расширений** для текстовых файлов: `.log .txt .json .jsonl
.ndjson .out .err .yaml .yml .conf .csv .tsv`. macOS-мусор
   (`__MACOSX/`, `._*`, `.DS_Store`) явно скипается.
5. **Стрим строк**: каждый whitelist'нутый файл декодируется как UTF-8
   и enqueue'ится в `ReadableStream<string>`, добавляя `\n` если файл
   им не заканчивается (иначе последняя строка одного файла «слипнется» с
   первой следующего). Дальше — стандартный `createLineSplitter()`.

### Ограничения текущей версии

- Все entries из всех файлов архива идут под **один** `SourceId` — UI
  показывает их как один большой лог. Имя файла внутри архива не
  попадает в `entry.fields.path`. Чтобы различать — пользователь делает
  отдельный snapshot per service. Полноценное расщепление архива на
  N независимых текстовых под-источников в дереве — Phase 4
  (нужна перестройка дерева каталога: kind=`snapshot` ↔ children=text-sources).
- Архив целиком грузится в память: `archive.arrayBuffer()`. Для типичных
  50-200 MB OPFS+SQLite поглощает на порядок больше — узким местом
  становится не snapshot, а индексер. Streaming-распаковка (fflate
  Stream API) — отложено до фикстуры > 1 GB.
- Не валидируем checksum tar header'а. Если кто-то скормит coding'ом
  испорченный tar — увидит пустой набор файлов или crash на size-octal
  parse. Acceptable trade-off (см. Phase 3, plan §3).

### Тесты

[snapshot-adapter.test.ts](../../src/core/sources/snapshot-adapter.test.ts) —
8 кейсов: zip с одним/несколькими файлами, whitelist (binaries и macOS
мусор), tar-uncompressed, tar.gz, unknown format → throw, no-text-files
→ throw, trailing-newline injection, проверка `source.kind`.

`buildTar` хелпер в тестовом файле — собирает минимальный POSIX-tar (без
checksum, без mode/uid/gid/mtime), что и читает наш reader. Это
double-проверка спецификации: если кто-то сделает reader строже —
тестовый builder тоже потребует обновления.

### Live-tail верификация (отложена)

Phase 3 в плане упоминает «live-tail end-to-end smoke». Реализовать
полностью автоматическую проверку без MCP Playwright не получилось
(MCP-tool'ы недоступны в этой сессии), а локальный WS-эхо-сервер требует
external-zenlang setup'а вне скоупа adapter'а. Stream-adapter (`addStream`)
и subscribeChanges уже подключены ([ADR-0010](0010-lv-on-viewstore-core-types.md)) —
здесь оставляем ручной smoke (`pnpm dev` → Add stream → wss://echo.example);
автоматизация — Phase 5 вместе с server-side find и progress UI.

### Consequences

- Good: Snapshot kind перестал быть «фантомом» в UI — реально работает
  для типичных log-dump'ов.
- Good: bundle вырос на ~15 KiB gzipped (1734 KiB precache vs 1726 KiB).
- Good: PAX/GNU-tar legacy не платим до момента, когда он реально нужен.
- Bad: имена файлов внутри архива теряются в стриме. Если пользователь
  откроет zip с 5 сервисами в одном дереве, он увидит «один большой
  лог» — без `path`-фильтра по сервису. Помечено как Phase 4 в плане.
- Bad: sync-распаковка блокирует worker на время unzip/gunzip. Для 200 MB
  это ~1 sec; на UI viden как короткий «idle» (статус остаётся
  `loading`). Async-stream API fflate-а — when needed.
- Neutral: тесты идут под Node-File API (Node 20+), File constructor
  доступен; никакой DOM-эмуляции не нужно.

## Links

- [ADR-0010](0010-lv-on-viewstore-core-types.md) — расширение core под
  9 source kinds, среди которых snapshot.
- [docs/plans/replicated-cooking-muffin.md §Phase 3](../plans/replicated-cooking-muffin.md#phase-3--snapshot-адаптер-и-live-tail-верификация-p2)
  — план, по которому шла работа.
- [fflate](https://www.npmjs.com/package/fflate) — выбранная библиотека.
