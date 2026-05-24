# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases after 0.1.0 are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
Conventional Commits — do not edit entries below this line by hand.

## [0.1.1](https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.0...v0.1.1) (2026-05-24)


### Features

* expose package version and build hash to bundle ([f741cc0](https://github.com/AlexandrBukhtatyy/log-viewer/commit/f741cc09a7c42f7375a9b716d60e84ddbd137ec1))
* **pwa:** show update banner when a new service worker is ready ([9896b46](https://github.com/AlexandrBukhtatyy/log-viewer/commit/9896b4630fc2eec35f7fd09e4bbf6fb5c704bd2e))
* **ui:** add About section and clickable status-bar version ([9843705](https://github.com/AlexandrBukhtatyy/log-viewer/commit/98437052015f0d8fdf9de4c6c683e864e1d62269))


### Bug Fixes

* **ui-prefs:** migrate persisted store to v1, force timelineOn=false ([f8fabc3](https://github.com/AlexandrBukhtatyy/log-viewer/commit/f8fabc30025ca8a3d861d87a9a0b2cc311f90669))


### Documentation

* add ADR-0026 for versioning and release automation ([c5d0cb0](https://github.com/AlexandrBukhtatyy/log-viewer/commit/c5d0cb07b06efa725bc973874316591df1651f67))
* add CHANGELOG and adopt Conventional Commits ([9293c3b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/9293c3b197b4011ec24c5827f41ed5eb10a26860))
* log pipeline sequence diagrams (ingest, read, filter) ([ae22498](https://github.com/AlexandrBukhtatyy/log-viewer/commit/ae22498177a24942726c185c9ff9080daedf7a1a))

## [Unreleased]

## [0.1.0] - 2026-05-24

### Added

- Initial public release: PWA log viewer (React 19 + Vite 8).
- Local ingestion from files, directories, drag-and-drop, and pasted text.
- Parsers: pino JSONL, bunyan-style JSONL with ISO timestamps, plain-text,
  nginx/Apache combined access log, mixed JSON + plain-text, multi-line
  Java/Python stack traces.
- SQLite FTS5 index stored in OPFS; Web Worker coordinator plus a parser
  worker pool for off-main-thread ingest and search.
- Virtual scroll, timeline histogram, group-by, saved searches, bookmarks,
  live-tail mode, omni-search (⌘K) and a Monaco-based entry detail view.
- Workspace persistence: tabs, selection, filter, group-by, and live-tail
  state survive reload through `localStorage`.
- Two-entry build: marketing landing at `/log-viewer/` and PWA demo at
  `/log-viewer/app/`, deployed to GitHub Pages.

[Unreleased]: https://github.com/aleksandrbuhtatyj/log-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aleksandrbuhtatyj/log-viewer/releases/tag/v0.1.0
