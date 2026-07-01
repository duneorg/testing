/**
 * createTestHarness — in-process Dune bootstrap for plugin testing.
 *
 * Spins up a full Dune engine backed by an in-memory storage adapter so tests
 * never touch the filesystem. Fixture content and plugins are wired in before
 * any lifecycle hooks fire, so hooks like `onSearchEngineCreate` and
 * `onContentIndexReady` work exactly as in production.
 *
 * ```ts
 * import { createTestHarness } from "@dune/testing";
 * import myPlugin from "./src/plugin.ts";
 *
 * Deno.test("my plugin registers a search engine", async () => {
 *   const h = await createTestHarness({
 *     content: {
 *       "01.home/default.md": "---\ntitle: Home\n---\nHello world",
 *     },
 *     plugins: [myPlugin({ apiKey: "test" })],
 *   });
 *
 *   try {
 *     const results = await h.search.search("hello");
 *     assertEquals(results[0].page.route, "/home");
 *   } finally {
 *     await h.dispose();
 *   }
 * });
 * ```
 *
 * @module
 */

import { MemoryStorageAdapter } from "@dune/core/storage";
import { bootstrap } from "@dune/core/bootstrap";
import { createApiHandler } from "@dune/core/api";
import type { BootstrapResult } from "@dune/core/bootstrap";
import type { DunePlugin } from "@dune/core/hooks";
import type { DuneEngine } from "@dune/core/engine";
import type { SearchManager } from "@dune/core/search";
import type { HookRegistry } from "@dune/core/hooks";
import type { DuneConfig } from "@dune/core/config";

/** Fixture content: path (relative to `content/`) → file body. */
export type FixtureContent = Record<string, string>;

/** Options for {@link createTestHarness}. */
export interface TestHarnessOptions {
  /**
   * Fixture content, keyed by path relative to `content/`.
   *
   * @example
   * ```ts
   * content: {
   *   "01.home/default.md": "---\ntitle: Home\n---\nHello",
   *   "02.blog/blog.md": "---\ntitle: Blog\ntemplate: listing\n---\n",
   * }
   * ```
   */
  content?: FixtureContent;
  /**
   * Extra files at arbitrary paths relative to the storage root.
   * Use to inject config overrides, flex object data, or plugin fixtures.
   *
   * @example
   * ```ts
   * files: {
   *   "config/site.yaml": "site:\n  title: Override\n",
   *   "data/flex/products/apple.yaml": "name: Apple\nprice: 1.99\n",
   * }
   * ```
   */
  files?: Record<string, string>;
  /**
   * Plugins to register before any bootstrap hooks fire.
   * Pass plugin instances directly — no JSR specifier resolution required.
   */
  plugins?: DunePlugin[];
  /**
   * Site title override. Defaults to `"Dune Test Site"`.
   */
  siteTitle?: string;
  /**
   * When true, disables the built-in admin plugin.
   * Defaults to true (admin is heavy; disable unless testing admin behavior).
   */
  disableAdmin?: boolean;
}

/** A fully bootstrapped in-memory Dune instance for testing. */
export interface TestHarness {
  /** The bootstrapped DuneEngine — inspect `engine.pages` for indexed content. */
  engine: DuneEngine;
  /** The active SearchManager — call `search(q)` and `suggest(p)` directly. */
  search: SearchManager;
  /** The hook registry — inspect registered plugins or subscribe to events. */
  hooks: HookRegistry;
  /** The resolved DuneConfig (defaults + harness overrides). */
  config: DuneConfig;
  /** The in-memory storage adapter (pre-populated with fixture files). */
  storage: MemoryStorageAdapter;
  /** The full BootstrapResult for advanced assertions. */
  bootstrap: BootstrapResult;
  /**
   * Send an in-process HTTP request to the content REST API (`/api/*`).
   *
   * Only routes handled by the read-only content API handler are reachable.
   * For requests to the admin API or full-stack routes, use the Playwright
   * E2E suite against a real server instead.
   *
   * @example
   * ```ts
   * const res = await h.fetch("/api/pages");
   * assertEquals(res.status, 200);
   * const json = await res.json();
   * ```
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Send an in-process HTTP request and return the response body as text.
   * Shorthand for `(await h.fetch(path, init)).text()`.
   *
   * @example
   * ```ts
   * const body = await h.render("/api/config/site");
   * assertStringIncludes(body, '"title"');
   * ```
   */
  render(path: string, init?: RequestInit): Promise<string>;
  /**
   * Trigger a full content rebuild: re-indexes all pages and rebuilds the
   * search index. Useful for testing hooks that respond to content changes.
   */
  rebuild(): Promise<void>;
  /**
   * Tear down the harness. Call in `finally` or `afterAll`. Safe to call
   * multiple times.
   */
  dispose(): Promise<void>;
}

/**
 * Create an in-process Dune test harness.
 *
 * All filesystem I/O is replaced by an in-memory `MemoryStorageAdapter`.
 * Plugins supplied via `options.plugins` are registered before any bootstrap
 * lifecycle hooks fire, so they participate in the full hook chain.
 */
export async function createTestHarness(
  options: TestHarnessOptions = {},
): Promise<TestHarness> {
  const {
    content = {},
    files = {},
    plugins = [],
    siteTitle = "Dune Test Site",
    disableAdmin = true,
  } = options;

  // ── 1. In-memory storage ────────────────────────────────────────────────────

  const storage = new MemoryStorageAdapter();

  // Minimal site config — enough for bootstrap to succeed.
  // Note: site.yaml content maps directly to config.site (no wrapper needed).
  // system.yaml content maps directly to config.system.
  storage.set(
    "config/site.yaml",
    `title: ${JSON.stringify(siteTitle)}\nurl: "http://localhost:8000"\n`,
  );
  storage.set(
    "config/system.yaml",
    "debug: false\ncache:\n  enabled: false\n",
  );

  // Fixture content.
  for (const [relPath, body] of Object.entries(content)) {
    storage.set(`content/${relPath}`, body);
  }

  // Arbitrary extra files.
  for (const [path, body] of Object.entries(files)) {
    storage.set(path, body);
  }

  // ── 2. Bootstrap ────────────────────────────────────────────────────────────

  const result = await bootstrap("/dune-test-harness", {
    storage,
    plugins,      // registered before any hooks fire
    buildSearch: true,
    dev: true,
    // Disable admin by default — it tries to create filesystem directories
    // (audit log, session store) that don't exist in the test environment.
    // deno-lint-ignore no-explicit-any
    configOverrides: disableAdmin ? { admin: { enabled: false } as any } : undefined,
  });

  // ── 3. In-process API handler ────────────────────────────────────────────────

  const apiHandler = createApiHandler({
    engine: result.engine,
    collections: result.collections,
    taxonomy: result.taxonomy,
    search: result.search,
    flex: result.flexEngine,
  });

  const BASE = "http://localhost:8000";

  async function hFetch(path: string, init?: RequestInit): Promise<Response> {
    const req = new Request(`${BASE}${path}`, init);
    const res = await apiHandler(req);
    if (res === null) {
      return new Response(`No handler for ${path}`, { status: 404 });
    }
    return res;
  }

  let disposed = false;

  return {
    engine: result.engine,
    search: result.search,
    hooks: result.hooks,
    config: result.config,
    storage,
    bootstrap: result,

    fetch: hFetch,

    async render(path: string, init?: RequestInit): Promise<string> {
      return (await hFetch(path, init)).text();
    },

    async rebuild(): Promise<void> {
      await result.engine.rebuild();
      await result.search.rebuild(result.engine.pages);
    },

    dispose(): Promise<void> {
      if (disposed) return Promise.resolve();
      disposed = true;
      return Promise.resolve();
    },
  };
}
