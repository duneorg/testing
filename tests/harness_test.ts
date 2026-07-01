import { assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import { createTestHarness } from "../src/harness.ts";
import type { DunePlugin } from "@dune/core/hooks";
import type { SearchEngineCreateContext } from "@dune/core/search";
import { createOramaEngine } from "../../plugin-orama/src/engine.ts";

// ── Basic harness functionality ───────────────────────────────────────────────

Deno.test("createTestHarness — bootstrap succeeds with empty content", async () => {
  const h = await createTestHarness();
  try {
    assertEquals(Array.isArray(h.engine.pages), true);
    assertEquals(h.config.site.title, "Dune Test Site");
  } finally {
    await h.dispose();
  }
});

Deno.test("createTestHarness — indexes fixture content pages", async () => {
  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Home\n---\nWelcome to the site",
      "02.about/default.md": "---\ntitle: About\n---\nAbout us page",
    },
  });
  try {
    const routes = h.engine.pages.map((p) => p.route);
    assertEquals(routes.some((r) => r.startsWith("/home")), true);
    assertEquals(routes.some((r) => r.startsWith("/about")), true);
  } finally {
    await h.dispose();
  }
});

Deno.test("createTestHarness — siteTitle override", async () => {
  const h = await createTestHarness({ siteTitle: "My Custom Test Site" });
  try {
    assertEquals(h.config.site.title, "My Custom Test Site");
  } finally {
    await h.dispose();
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

Deno.test("createTestHarness — built-in search works on fixture content", async () => {
  const h = await createTestHarness({
    content: {
      "01.hello/default.md": "---\ntitle: Hello World\n---\nThis is the hello page",
    },
  });
  try {
    const results = await h.search.search("hello");
    assertGreater(results.length, 0);
    assertEquals(results[0].page.title, "Hello World");
    assertEquals(results[0].page.route.startsWith("/hello"), true);
  } finally {
    await h.dispose();
  }
});

// ── Plugin integration ────────────────────────────────────────────────────────

Deno.test("createTestHarness — plugin hook fires during bootstrap", async () => {
  let hookFired = false;

  const testPlugin: DunePlugin = {
    name: "test-hook-plugin",
    version: "0.0.1",
    hooks: {
      onContentIndexReady: (_ctx: unknown) => {
        hookFired = true;
      },
    },
  };

  const h = await createTestHarness({ plugins: [testPlugin] });
  try {
    assertEquals(hookFired, true);
  } finally {
    await h.dispose();
  }
});

Deno.test("createTestHarness — plugin can register a search engine via hook", async () => {
  const oramaPlugin: DunePlugin = {
    name: "orama-test",
    version: "0.0.1",
    hooks: {
      onSearchEngineCreate: (ctx: unknown) => {
        const { data } = ctx as { data: SearchEngineCreateContext };
        const engine = createOramaEngine({}, data.pages, {
          loadText: data.loadText,
          injectedRecords: data.injectedRecords,
        });
        data.register("orama", engine);
        data.setActiveEngine("orama");
      },
    },
  };

  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Home\n---\nWelcome",
    },
    plugins: [oramaPlugin],
  });
  try {
    assertEquals(h.search.activeEngineName(), "orama");
    assertEquals(h.search.registeredEngineNames().includes("orama"), true);
    const results = await h.search.search("welcome");
    assertGreater(results.length, 0);
  } finally {
    await h.dispose();
  }
});

// ── Storage ───────────────────────────────────────────────────────────────────

Deno.test("createTestHarness — files option populates extra storage paths", async () => {
  const h = await createTestHarness({
    files: {
      "data/custom/item.json": JSON.stringify({ key: "value" }),
    },
  });
  try {
    const text = await h.storage.readText("data/custom/item.json");
    assertStringIncludes(text, "value");
  } finally {
    await h.dispose();
  }
});

// ── Rebuild ───────────────────────────────────────────────────────────────────

Deno.test("createTestHarness — rebuild re-indexes updated content", async () => {
  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Original\n---\nOriginal content",
    },
  });
  try {
    const before = h.engine.pages.find((p) => p.route.startsWith("/home"));
    assertEquals(before?.title, "Original");

    // Update the content in storage and rebuild.
    h.storage.set(
      "content/01.home/default.md",
      "---\ntitle: Updated\n---\nUpdated content",
    );
    await h.rebuild();

    const after = h.engine.pages.find((p) => p.route.startsWith("/home"));
    assertEquals(after?.title, "Updated");
  } finally {
    await h.dispose();
  }
});

// ── dispose ───────────────────────────────────────────────────────────────────

Deno.test("createTestHarness — dispose is idempotent", async () => {
  const h = await createTestHarness();
  await h.dispose();
  await h.dispose(); // should not throw
});
