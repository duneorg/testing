# Changelog

## [0.1.1] — 2026-07-01

### Changed

- Updated `@dune/core` peer dependency to `^0.25`. This brings in the new `/api`, `/bootstrap`, and `SearchManager` exports required by the harness.

## [0.1.2] — 2026-07-01

### Fixed

- `dispose()` no longer declared `async` without an `await` — fixes `deno lint` and JSR score.

### Added

- `README.md` added to the package.
