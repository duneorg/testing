# Changelog

## [1.0.0] — 2026-07-05

First stable release. No breaking changes from 0.1.2 — the major bump marks
the package's public API as stable going forward, per semver.

### Fixed

- **JSR doc-coverage score was still 50% despite fully-documented origin
  declarations.** `deno_doc` resolves a re-exported symbol as an unresolved
  reference carrying no JSDoc whenever its origin file is itself a separate
  `deno.json` entrypoint. Switching the barrel re-export to `export *`
  (matching values and types exactly, with nothing else exported from
  `harness.ts`) fixes this; both entrypoints are now at 100% documented
  symbols.

## [0.1.1] — 2026-07-01

### Changed

- Updated `@dune/core` peer dependency to `^0.25`. This brings in the new `/api`, `/bootstrap`, and `SearchManager` exports required by the harness.

## [0.1.2] — 2026-07-01

### Fixed

- `dispose()` no longer declared `async` without an `await` — fixes `deno lint` and JSR score.

### Added

- `README.md` added to the package.
