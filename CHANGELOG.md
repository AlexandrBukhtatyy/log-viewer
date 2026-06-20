# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases after 0.1.0 are generated automatically by
[release-please](https://github.com/googleapis/release-please) from
Conventional Commits — do not edit entries below this line by hand.

## [0.1.3](https://github.com/AlexandrBukhtatyy/log-viewer/compare/v0.1.2...v0.1.3) (2026-06-20)


### Features

* **indexer:** scope field_meta to file within a directory source ([06300c9](https://github.com/AlexandrBukhtatyy/log-viewer/commit/06300c97cbd43dff02294881ec973c717b132fc7))
* logical fields (~-namespace) for cross-format semantic attributes ([e86aae6](https://github.com/AlexandrBukhtatyy/log-viewer/commit/e86aae6eca72c72790d8f3e2170fdb06f1218ebf))
* **logical-fields:** compact panel — duplicate, search, two-line cards ([85fb1ae](https://github.com/AlexandrBukhtatyy/log-viewer/commit/85fb1aecab04554a630cc143a6a9c1d306941b36))
* **logical-fields:** coverage drill-down and quick filter from row ([b67f687](https://github.com/AlexandrBukhtatyy/log-viewer/commit/b67f687600fc024e425b2599e9314cab824dbf20))
* **logical-fields:** editor modal + group-by section split ([3d9cc84](https://github.com/AlexandrBukhtatyy/log-viewer/commit/3d9cc84448950b76a64a6ad088d98e1c532efb97))
* **logical-fields:** inline editor for user-defined custom fields ([d91be8d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/d91be8dcb298e4130bc9ef3954b8278f06eaa98f))
* **logical-fields:** regex-on-json, discovery, import/export ([8b07a46](https://github.com/AlexandrBukhtatyy/log-viewer/commit/8b07a4657389f4354d606c20c42c926372f8e025))
* **logical-fields:** seed editor form from initial in new mode ([bea635c](https://github.com/AlexandrBukhtatyy/log-viewer/commit/bea635c983546d8082a5db6cc9050d284fc0dbc4))
* **search:** add FTS toggle + autocomplete to the Search panel ([5b3e78d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/5b3e78d97d063201c497b46dba6dff2162d05c85))
* **search:** autocomplete dropdown component ([ba288de](https://github.com/AlexandrBukhtatyy/log-viewer/commit/ba288defff3b811a67810a1c6ada55665bf86236))
* **search:** lazy logical-field values via getGroupCounts ([bc6d2d1](https://github.com/AlexandrBukhtatyy/log-viewer/commit/bc6d2d192e1f08bdaa643c7f61dbc89b914f59f6))
* **search:** real FTS query grammar on the read path ([da4d4fa](https://github.com/AlexandrBukhtatyy/log-viewer/commit/da4d4faf9bc3b5f0be97504aa013b9ceafe3d738))
* **search:** recent-search history store + suggestions builder ([ae8f78e](https://github.com/AlexandrBukhtatyy/log-viewer/commit/ae8f78e4a7d103cb6189d89f26c18b5ce6c3346d))
* **search:** resolve body-only logical fields on the read path ([61d6a2c](https://github.com/AlexandrBukhtatyy/log-viewer/commit/61d6a2cb9ff462c37b876ac9245ed2fdf71dd4cd))
* **search:** structured field suggestions in the Search panel ([486027d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/486027d4721ba529d9db834f75b88661b4751211))
* **search:** structured field-filter suggestions in the builder ([8ac959f](https://github.com/AlexandrBukhtatyy/log-viewer/commit/8ac959f31d389066c794114b7b18fd2f4c024c29))
* **search:** system field values in filter-bar autocomplete ([7457cd3](https://github.com/AlexandrBukhtatyy/log-viewer/commit/7457cd386687b1401e0adac265797078265b5054))
* **search:** wire FTS-aware autocomplete into the filter bar ([eb9e347](https://github.com/AlexandrBukhtatyy/log-viewer/commit/eb9e3470c9b717201282243a22805a75231a3a82))
* **sidebar:** pin tab on double-click of a file ([6da82c3](https://github.com/AlexandrBukhtatyy/log-viewer/commit/6da82c3dc030b859a131a3b96cb37c97c8fbf683))
* **table:** single-column sort with per-tab persistence ([8542903](https://github.com/AlexandrBukhtatyy/log-viewer/commit/8542903819fd5c5f3c5ec3be4bd92fc0ad053a24))
* **table:** toggle raw log line vs columns view ([9d0d510](https://github.com/AlexandrBukhtatyy/log-viewer/commit/9d0d510f195c4d79ec813ab80661b4fa3973fcc0))
* **tabs:** add per-tab filter/groupBy fields to LvTab ([fa68185](https://github.com/AlexandrBukhtatyy/log-viewer/commit/fa681857b9fdc064a2b21aac50c070d2856a5d39))
* **tabs:** apply active tab's rules to other tabs ([a385120](https://github.com/AlexandrBukhtatyy/log-viewer/commit/a38512032ca4e46aeb42621374f0a72935f57051))
* **tabs:** per-tab filter/groupBy resolvers + rules bundle helpers ([5665c2f](https://github.com/AlexandrBukhtatyy/log-viewer/commit/5665c2f77afaba96e4447532d3dff8277ce84730))
* **tabs:** resolve per-tab filter/groupBy in container (read path) ([4c2adfd](https://github.com/AlexandrBukhtatyy/log-viewer/commit/4c2adfd455ef93e91b4d9214d1dcb190fe57fdf0))
* **tabs:** write per-tab filter/groupBy (write path) ([cd20428](https://github.com/AlexandrBukhtatyy/log-viewer/commit/cd20428d91bb4d76d2d740278d637096dfce856a))


### Bug Fixes

* **cli:** show localhost URL when bound to wildcard host ([40d1551](https://github.com/AlexandrBukhtatyy/log-viewer/commit/40d15510ef8996649bc004ee94d0c746c954fa27))
* **filter:** keep the filters dropdown inside the viewer, not under the sidebar ([b969895](https://github.com/AlexandrBukhtatyy/log-viewer/commit/b96989583bbf498330ffdb6cd64dc422a61fbb62))
* **indexer:** self-heal empty field_meta cache on open ([6a76d74](https://github.com/AlexandrBukhtatyy/log-viewer/commit/6a76d74391c0b8dc0254c0ab9e02c7b29af93d01))
* **parsers:** emit canonical service/k=v fields from app-text logs ([d373677](https://github.com/AlexandrBukhtatyy/log-viewer/commit/d3736771aa50fc45c8676c72ef8ae923e9fa658c))
* **search:** recognize explicit AND in the FTS grammar ([5d92f8b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/5d92f8b49a47c3ffb8a12f58297bffe6696e98c7))
* **stream:** fall back to raw line in columns view until a column is picked ([d8d2616](https://github.com/AlexandrBukhtatyy/log-viewer/commit/d8d26168c3f51b2bc8f4d20887dcb48f7f5f7934))
* **workspace:** strip scope from persisted per-tab filter ([ce6c189](https://github.com/AlexandrBukhtatyy/log-viewer/commit/ce6c1893d8254a7744028a247bf9a4e81f040468))


### Documentation

* add feedback section to README ([50df89c](https://github.com/AlexandrBukhtatyy/log-viewer/commit/50df89c871ff7837a786aea92fabf03f608735e8))
* add GitHub Discussions category form templates ([448ab6c](https://github.com/AlexandrBukhtatyy/log-viewer/commit/448ab6ce43331328e2e9c62c7fcc9ce8a5fa3bc9))
* **adr:** document field-aware (hybrid) search suggestions in ADR-0034 ([7b76ebf](https://github.com/AlexandrBukhtatyy/log-viewer/commit/7b76ebf810605bd6c91992eeaf96db0223a70b1c))
* **adr:** record per-tab view rules model (ADR-0033) ([643e0b8](https://github.com/AlexandrBukhtatyy/log-viewer/commit/643e0b8677b9a21ab122eb7836744dcf06f51c1c))
* **adr:** record read-path for body-only logical fields (ADR-0037) ([3a9bb7d](https://github.com/AlexandrBukhtatyy/log-viewer/commit/3a9bb7d185b40d54598ebfba17ec6f40ae0043c8))
* **adr:** record read-path FTS grammar + search autocomplete (ADR-0034) ([2919761](https://github.com/AlexandrBukhtatyy/log-viewer/commit/291976198b61fbc774321ff40f4232e97d5b3b5d))
* **conventions:** add engineering practices guide ([459c958](https://github.com/AlexandrBukhtatyy/log-viewer/commit/459c958e9e65c6d8ebeef9da84e15ab07c5b6fb7))
* move task tracking to GitHub Projects ([5e4fea7](https://github.com/AlexandrBukhtatyy/log-viewer/commit/5e4fea77f613b2e5af5a82f5f2250b3fc884de11))
* **plans:** add feedback-collection bots → Discussions concept ([9ff47e6](https://github.com/AlexandrBukhtatyy/log-viewer/commit/9ff47e6cc1c58133956db4903c6125037514d70c))
* **plans:** add Web MCP adoption concept (agent tools + egress redaction) ([4099a0a](https://github.com/AlexandrBukhtatyy/log-viewer/commit/4099a0adc62c73dfcbd83846b8da3fa35ddcd2d0))
* **plans:** plan Role B (in-app BYOK agent) doc + GitHub epic structure ([7b17532](https://github.com/AlexandrBukhtatyy/log-viewer/commit/7b17532c0789737a986189e13f86ae20c265063b))
* point bug reports to Discussions Bug Reports category ([5fc5fd8](https://github.com/AlexandrBukhtatyy/log-viewer/commit/5fc5fd8c30bdf96350ac3124000eca701c084ec9))
* record commit workflow and decision-doc boundaries in CLAUDE.md ([45024a5](https://github.com/AlexandrBukhtatyy/log-viewer/commit/45024a5e64a2a3226e7e7146861458fcebdcafef))
* record GitHub Projects task workflow in CLAUDE.md ([790d46b](https://github.com/AlexandrBukhtatyy/log-viewer/commit/790d46b5f243f61b177ca57cc1c1c24df691dbb7))
* **roadmap:** note read-path streaming results and shared scan-cap follow-ups ([e162583](https://github.com/AlexandrBukhtatyy/log-viewer/commit/e1625830a17c9ff1da598b8692bc26cafef888b3))


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
