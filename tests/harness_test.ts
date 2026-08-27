import { assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import { createTestHarness } from "../src/harness.ts";
import type { DunePlugin } from "@dune/core/hooks";
import type {
  PageIndex,
  SearchEngine,
  SearchEngineCreateContext,
  SearchResult,
} from "@dune/core/search";

/**
 * A minimal in-process `SearchEngine` used only to exercise the harness's
 * `onSearchEngineCreate` registration path (register + setActiveEngine +
 * build/rebuild wiring). Real third-party engines such as
 * `@dune/plugin-orama` carry their own test suites; keeping this stub inline
 * lets `@dune/testing` stay free of cross-package dependencies so the suite
 * runs identically in a standalone clone, CI, or the shared dev workspace.
 */
function createStubSearchEngine(
  initialPages: PageIndex[],
  loadText: (page: PageIndex) => Promise<string>,
): SearchEngine {
  let docs: Array<{ page: PageIndex; text: string }> = [];

  async function index(pages: PageIndex[]): Promise<void> {
    docs = await Promise.all(
      pages
        .filter((p) => p.published && p.route)
        .map(async (p) => ({
          page: p,
          text: `${p.title}\n${await loadText(p)}`.toLowerCase(),
        })),
    );
  }

  return {
    build(): Promise<void> {
      return index(initialPages);
    },
    rebuild(newPages: PageIndex[]): Promise<void> {
      return index(newPages);
    },
    search(query: string, limit = 20): Promise<SearchResult[]> {
      const q = query.trim().toLowerCase();
      const hits: SearchResult[] = q
        ? docs
          .filter((d) => d.text.includes(q))
          .slice(0, limit)
          .map((d) => ({ page: d.page, score: 1, excerpt: "" }))
        : [];
      return Promise.resolve(hits);
    },
    suggest(prefix: string, limit = 10): Promise<string[]> {
      const p = prefix.trim().toLowerCase();
      const out = p
        ? docs
          .map((d) => d.page.title)
          .filter((t) => t.toLowerCase().startsWith(p))
          .slice(0, limit)
        : [];
      return Promise.resolve(out);
    },
  };
}

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
      "01.hello/default.md":
        "---\ntitle: Hello World\n---\nThis is the hello page",
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
  const searchPlugin: DunePlugin = {
    name: "custom-search-test",
    version: "0.0.1",
    hooks: {
      onSearchEngineCreate: (ctx: unknown) => {
        const { data } = ctx as { data: SearchEngineCreateContext };
        const engine = createStubSearchEngine(data.pages, data.loadText);
        data.register("stub", engine);
        data.setActiveEngine("stub");
      },
    },
  };

  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Home\n---\nWelcome",
    },
    plugins: [searchPlugin],
  });
  try {
    assertEquals(h.search.activeEngineName(), "stub");
    assertEquals(h.search.registeredEngineNames().includes("stub"), true);
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
