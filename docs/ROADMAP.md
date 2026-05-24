# Roadmap

Живой список того, что планируется добавить в [Log Viewer](https://github.com/AlexandrBukhtatyy/log-viewer). Каждый пункт — ссылка на план в [docs/plans/](plans/), где описан scope, файлы для правок и шаги проверки. Уже принятые архитектурные решения — в [docs/adr/](adr/).

## Ближайшие планы

- [Column-click sort](plans/column-click-sort.md) — сортировка по клику на заголовок колонки (asc → desc → reset), работает поверх built-in и динамических полей, совместима с group-by.
- [Per-source customization](plans/per-source-customization.md) — color tag, alias, набор колонок и предзаданный фильтр для каждого источника. Восстановление раскладки при повторном открытии файла/папки.
- [Filter import/export](plans/filter-import-export.md) — JSON-файл с активным `LogFilter` и saved-searches. Можно делиться с командой и переносить между устройствами.
- [Feature backlog workflow](plans/feature-backlog-workflow.md) — формализация процесса фиксации идей-«хотелок» (гибрид `docs/backlog/` файлов + GitHub Issues).

## Идеи на горизонте

- Расширение оркестратора прогресса (`bytesRead`/`bytesTotal` в индексер) — чтобы в сайдбаре крутился не только спиннер, а живой процент.
- Поддержка дополнительных форматов: bunyan-improved, OTLP-логи, k8s/cloud-адаптеры (заглушки уже есть, ADR-0014).
- Свои custom-parsers с UI-конструктором, regex live-preview.
- Расширенный AI-помощник по логам (LvAiPanel есть, нужен бек).
- Workspace-export: вся сессия (источники, фильтры, закладки) одним файлом.

## История решений

Все архитектурные решения и trade-off'ы — в [docs/adr/](adr/). Последние:

- [ADR-0023](adr/0023-clear-application-data.md) — File → Clear Application Data… с тремя независимыми scope'ами.
- [ADR-0022](adr/0022-source-removal-cleanup.md) — полная очистка ресурсов при `removeSource`, включая await ingest и OPFS spool.
- [ADR-0021](adr/0021-window-only-refresh-and-entry-cache.md) — window-only refresh + entry cache, throttle ingest-change.
- [ADR-0020](adr/0020-batched-contiguous-blob-reads.md) — batched contiguous reads в `SourceBlobReader`.

## Как предложить идею

- Issue в репозитории — самый удобный канал, см. [CONTRIBUTING.md](../CONTRIBUTING.md).
- Pull request с черновиком в `docs/plans/<slug>.md` — приветствуется, если идея масштабная.
