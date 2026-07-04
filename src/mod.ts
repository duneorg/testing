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

// `export *` rather than `export { X } from` — deno_doc (and JSR's doc-coverage
// check) collapses named re-exports of a symbol whose origin file is itself a
// separate deno.json entrypoint into an unresolved "reference" node with no
// JSDoc, even though the origin declaration is fully documented. `export *`
// re-exports the same named symbols but keeps the full resolved declaration
// (and its JSDoc) intact.
export * from "./harness.ts"; // createTestHarness, TestHarness, TestHarnessOptions, FixtureContent
