/**
 * @dune/testing — Test harness for Dune CMS plugins and themes.
 *
 * Provides `createTestHarness()` for spinning up an in-process Dune instance
 * backed by in-memory storage. No filesystem access required.
 *
 * @example
 * ```ts
 * import { createTestHarness } from "@dune/testing";
 * import { assertEquals } from "@std/assert";
 * import myPlugin from "./src/plugin.ts";
 *
 * Deno.test("plugin hooks search engine", async () => {
 *   const h = await createTestHarness({
 *     content: {
 *       "01.home/default.md": "---\ntitle: Home\n---\nHello world",
 *     },
 *     plugins: [myPlugin()],
 *   });
 *   try {
 *     assertEquals(h.search.registeredEngineNames().includes("my-engine"), true);
 *   } finally {
 *     await h.dispose();
 *   }
 * });
 * ```
 *
 * @module
 */

export { createTestHarness } from "./harness.ts";
export type { TestHarness, TestHarnessOptions, FixtureContent } from "./harness.ts";
