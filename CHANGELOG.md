# Changelog

## [Unreleased]

### Fixed

- **`tests/harness_test.ts` no longer imports `plugin-orama` via a relative path
  reaching outside the package.** The search-engine registration test now
  exercises the `onSearchEngineCreate` hook with a small inline stub engine, so
  the suite runs identically in a standalone clone, in CI, and in the shared dev
  workspace. `deno test` is now also run in CI.

## [1.0.1] — 2026-08-23

### Fixed

- **`@dune/core` pin bumped to `^0.33`.** The previous `^0.31` range (itself a
  leftover from a stale `^0.25`) didn't cover `@dune/core`'s current version — a
  site running a newer core would have loaded a second, stale copy just for this
  package. No behavior change; nothing in this release depends on a 0.33-only
  export.

## [1.0.0] — 2026-07-05

First stable release. No breaking changes from 0.1.2 — the major bump marks the
package's public API as stable going forward, per semver.

### Fixed

- **JSR doc-coverage score was still 50% despite fully-documented origin
  declarations.** `deno_doc` resolves a re-exported symbol as an unresolved
  reference carrying no JSDoc whenever its origin file is itself a separate
  `deno.json` entrypoint. Switching the barrel re-export to `export *` (matching
  values and types exactly, with nothing else exported from `harness.ts`) fixes
  this; both entrypoints are now at 100% documented symbols.

## [0.1.1] — 2026-07-01

### Changed

- Updated `@dune/core` peer dependency to `^0.25`. This brings in the new
  `/api`, `/bootstrap`, and `SearchManager` exports required by the harness.

## [0.1.2] — 2026-07-01

### Fixed

- `dispose()` no longer declared `async` without an `await` — fixes `deno lint`
  and JSR score.

### Added

- `README.md` added to the package.
