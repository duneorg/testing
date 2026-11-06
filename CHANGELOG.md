# Changelog

## [Unreleased]

Version 2.0.0 (the conformance driver changed incompatibly).

### Changed — BREAKING

- **The conformance driver has no `adminPrefix`.** The admin's URL prefix comes
  from the `admin.prefix` capability slot, which an admin must now provide (core
  no longer assumes `/admin`). `adminPrefix?: string` is replaced by
  `hostsContributions?: boolean`, which only enables the `admin.pages` /
  `admin.routes` checks. New checks: the admin provides `admin.prefix` (one
  provider, a usable prefix), core reserves that prefix against plugin routes,
  and with no admin `/admin` is an ordinary plugin path. The stub admin provides
  `admin.prefix` (`/stub-admin` by default). Needs `@dune/core` 0.36 (dune#123).

### Added

- **`runAdminConformance()`** (`@dune/testing/conformance`): the admin
  conformance suite. A driver says how to build an app with an admin installed
  and how to sign an editor in; the suite checks the contract with core (the
  `auth.session` capability, session recognition and marker scrubbing, the
  declared session cookie, mount-order independence, `onPageUpdate` /
  `onPageCreate` / `onPageDelete` from the writer, `admin.pages` /
  `admin.routes` mounting, and the site serving with no admin). Also
  `adminConformanceChecks()` to run the checks yourself. Its own tests include
  deliberately broken admins that it must reject. The stub admin is the
  reference run.
- **`createAppHarness()`** (`@dune/testing/app-harness`): the in-memory harness
  plus the full `createDuneApp()` app, with `request(path)` going through plugin
  routes, the response-transform pipeline and the content catch-all.
- **`createStubAdmin()`** (`@dune/testing/stub-admin`): a minimal replacement
  admin built only on core's injected services, capabilities and mount API. It
  proves Dune does not depend on `@dune/plugin-admin`: its tests cover login and
  sessions, `auth.session` recognised by core's transform pipeline (and only its
  own cookie), marker scrubbing, a page edit that fires `onPageUpdate`, a role
  without edit rights, and a site with no admin at all. Needs `@dune/core` 0.36
  (duneorg/dune#97); version bump and the `^0.36` pin are release work.

## [1.0.3] — 2026-10-28

### Fixed

- **`@dune/core` pin bumped to `^0.35`.** The previous `^0.34` range doesn't
  cover `@dune/core` 0.35 — a site or test suite running it would have loaded a
  second, stale copy of core just for this package. No behavior change; nothing
  in this release depends on a 0.35-only export.

## [1.0.2] — 2026-08-27

### Fixed

- **`tests/harness_test.ts` no longer imports `plugin-orama` via a relative path
  reaching outside the package.** The search-engine registration test now
  exercises the `onSearchEngineCreate` hook with a small inline stub engine, so
  the suite runs identically in a standalone clone, in CI, and in the shared dev
  workspace. `deno test` is now also run in CI.
- **`@dune/core` pin bumped to `^0.34`.** The previous `^0.33` range didn't
  cover `@dune/core`'s current version — a site running a newer core would have
  loaded a second, stale copy just for this package. No behavior change; nothing
  in this release depends on a 0.34-only export.

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
