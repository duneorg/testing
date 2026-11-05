/**
 * createAppHarness — the in-memory test harness plus the full Fresh app.
 *
 * `createTestHarness()` reaches only the read-only content API. This one also
 * builds the app `dune serve` builds (`createDuneApp()`): content pages, plugin
 * routes, the response-transform pipeline, the inline-edit WebSocket route,
 * everything a plugin's `mount()` registers. Use it to test a plugin or an
 * admin end to end, in process, without a server.
 *
 * ```ts
 * import { createAppHarness } from "@dune/testing";
 *
 * const h = await createAppHarness({
 *   content: { "01.home/default.md": "---\ntitle: Home\n---\nHello" },
 *   plugins: [myPlugin()],
 * });
 * try {
 *   const res = await h.request("/");
 *   assertEquals(res.status, 200);
 * } finally {
 *   await h.dispose();
 * }
 * ```
 *
 * @module
 */

import { createDuneApp } from "@dune/core/fresh-app";
import { createTestHarness } from "./harness.ts";
import type { TestHarness, TestHarnessOptions } from "./harness.ts";

/** A {@link TestHarness} that also serves the full Dune app. */
export interface AppHarness extends TestHarness {
  /**
   * Send an in-process HTTP request through the whole app (page cache,
   * plugin routes, response transforms, content catch-all).
   */
  request(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Options for {@link createAppHarness}: those of {@link createTestHarness}, with
 * the built-in admin disabled unless `disableAdmin: false`.
 */
export type AppHarnessOptions = TestHarnessOptions;

/** Create an in-process Dune app over in-memory storage. */
export async function createAppHarness(
  options: AppHarnessOptions = {},
): Promise<AppHarness> {
  const h = await createTestHarness(options);
  const { app } = await createDuneApp(h.bootstrap, {
    root: "/dune-test-harness",
    port: 0,
    dev: false,
  });
  const handler = app.handler();
  return {
    ...h,
    request(path, init) {
      return handler(new Request(new URL(path, "http://localhost:8000"), init));
    },
  };
}
