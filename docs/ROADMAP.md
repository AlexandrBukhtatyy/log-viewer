# Roadmap

Планирование переехало в **[GitHub Projects → Log Viewer](https://github.com/users/AlexandrBukhtatyy/projects/1)** — это ведущий трекер задач. Доска отвечает на «что делаем сейчас, что следующее, что решили не делать».

Lifecycle статусов на доске: `Backlog → Planned → In progress → Done / Dropped`. У каждой карточки — поля `Area` (perf, ui, parsing, storage, dx, formats, ai) и `Priority` (low, med, high). Детальные планы по крупным задачам по-прежнему живут в [docs/plans/](plans/) и линкуются из тела соответствующего Issue строкой `Plan: …`.

## История решений

Все архитектурные решения и trade-off'ы — в [docs/adr/](adr/). Последние:

- [ADR-0023](adr/0023-clear-application-data.md) — File → Clear Application Data… с тремя независимыми scope'ами.
- [ADR-0022](adr/0022-source-removal-cleanup.md) — полная очистка ресурсов при `removeSource`, включая await ingest и OPFS spool.
- [ADR-0021](adr/0021-window-only-refresh-and-entry-cache.md) — window-only refresh + entry cache, throttle ingest-change.
- [ADR-0020](adr/0020-batched-contiguous-blob-reads.md) — batched contiguous reads в `SourceBlobReader`.

## Как предложить идею или сообщить о баге

- **Баг** → категория [Bug Reports](https://github.com/AlexandrBukhtatyy/log-viewer/discussions/categories/bug-reports) в Discussions.
- **Идея / запрос фичи** → категория [Ideas & Feature Requests](https://github.com/AlexandrBukhtatyy/log-viewer/discussions/categories/ideas-feature-requests) в Discussions.

Созревшее обсуждение мейнтейнер конвертирует в Issue («Create issue from discussion») и кладёт на доску. Масштабную идею можно сразу оформить черновиком плана в `docs/plans/<slug>.md` (PR приветствуется) — см. [CONTRIBUTING.md](../CONTRIBUTING.md).
