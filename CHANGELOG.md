# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases after 0.1.0 are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
Conventional Commits — do not edit entries below this line by hand.

## [0.1.3](https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.2...v0.1.3) (2026-06-14)


### Features

* logical fields (~-namespace) for cross-format semantic attributes ([e86aae6](https://github.com/AlexandrBukhtatyy/log-viewer/commit/e86aae6eca72c72790d8f3e2170fdb06f1218ebf))
* **logical-fields:** coverage drill-down and quick filter from row ([b67f687](https://github.com/AlexandrBukhtatyy/log-viewer/commit/b67f687600fc024e425b2599e9314cab824dbf20))
* **logical-fields:** editor modal + group-by section split ([3d9cc84](https://github.com/AlexandrBukhtatyy/log-viewer/commit/3d9cc84448950b76a64a6ad088d98e1c532efb97))
* **logical-fields:** inline editor for user-defined custom fields ([d91be8d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/d91be8dcb298e4130bc9ef3954b8278f06eaa98f))
* **logical-fields:** regex-on-json, discovery, import/export ([8b07a46](https://github.com/AlexandrBukhtatyy/log-viewer/commit/8b07a4657389f4354d606c20c42c926372f8e025))
* **table:** single-column sort with per-tab persistence ([8542903](https://github.com/AlexandrBukhtatyy/log-viewer/commit/8542903819fd5c5f3c5ec3be4bd92fc0ad053a24))


### Bug Fixes

* **cli:** show localhost URL when bound to wildcard host ([40d1551](https://github.com/AlexandrBukhtatyy/log-viewer/commit/40d15510ef8996649bc004ee94d0c746c954fa27))


### Documentation

* **conventions:** add engineering practices guide ([459c958](https://github.com/AlexandrBukhtatyy/log-viewer/commit/459c958e9e65c6d8ebeef9da84e15ab07c5b6fb7))
* record commit workflow and decision-doc boundaries in CLAUDE.md ([45024a5](https://github.com/AlexandrBukhtatyy/log-viewer/commit/45024a5e64a2a3226e7e7146861458fcebdcafef))


### Code Refactoring

* **ui:** unify form-field layout via shared LvFormField ([7e7372b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/7e7372bbae7ca206f27ea62b21e4a62c278fe387))

## [0.1.2](https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.1...v0.1.2) (2026-06-07)


### Features

* **dist:** on-prem npm package + Dockerfile for air-gapped deploys ([23ca21b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/23ca21b303651ef243c910edf46d23337b548320))
* **parser:** mirror full JSON object into entry.fields ([bcc49fa](https://github.com/AlexandrBukhtatyy/log-viewer/commit/bcc49fad66efec656873628188384209bbb78f72))
* **sidebar:** right-click context menu for root sources ([213d303](https://github.com/AlexandrBukhtatyy/log-viewer/commit/213d3039fa38251d87f5be82fa472f8ac1adfb0b))
* **sidebar:** tristate folder checkbox and Select-all fix ([b3e13f4](https://github.com/AlexandrBukhtatyy/log-viewer/commit/b3e13f49a6eba70f7955845e23191fe7444f24df))
* **ui:** hide fields outside the active sources in column and group-by pickers ([af9efae](https://github.com/AlexandrBukhtatyy/log-viewer/commit/af9efae6c08836573a029c93bba4e5c17c9e2543))
* **ui:** remove View menu from topbar ([04b426b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/04b426b861934dae42e995b1cb709a15371fdb7e))
* **ui:** split group-by picker into system and log-field sections ([741e140](https://github.com/AlexandrBukhtatyy/log-viewer/commit/741e1401811eb71c034df7ca95c1bc24ed7e9803))
* **ui:** unified column model with per-tab format-aware columns, regex builder and presets ([462739c](https://github.com/AlexandrBukhtatyy/log-viewer/commit/462739cdc6ca73a9a2a4c2ae5247705d1998527e))


### Bug Fixes

* correct GitHub username in repository links ([eb5e495](https://github.com/AlexandrBukhtatyy/log-viewer/commit/eb5e495a5f1dc6da6c1ee405caefb0fcfbfe5f8e))
* **dist:** switch npm scope to @log-viewer/app to match org token ([e56eb8d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/e56eb8d7760f96f0843a169ff39de91c62d5901d))
* **worker-client:** release OPFS SAH-pool lock on bfcache pagehide ([9c990ca](https://github.com/AlexandrBukhtatyy/log-viewer/commit/9c990ca5a4b705ab28a13cfa3b860b935f58e5d9))


### Documentation

* **plans:** add feedback channel plan ([06263be](https://github.com/AlexandrBukhtatyy/log-viewer/commit/06263bed5ff65a30bbc37042a6be7eddfd426e48))

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

[Unreleased]: https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AlexandrBukhtatyy/log-viewer/releases/tag/v0.1.0
