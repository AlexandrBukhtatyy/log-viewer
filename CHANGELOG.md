# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases after 0.1.0 are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
Conventional Commits — do not edit entries below this line by hand.

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

[Unreleased]: https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AlexandrBukhtatyy/log-viewer/releases/tag/v0.1.0
