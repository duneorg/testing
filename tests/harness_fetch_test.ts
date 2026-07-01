import { assertEquals, assertStringIncludes } from "@std/assert";
import { createTestHarness } from "../src/harness.ts";

const CONTENT = {
  "01.home/default.md": "---\ntitle: Home\n---\nHello world",
  "02.about/default.md": "---\ntitle: About\n---\nAbout us",
};

Deno.test("h.fetch — GET /api/pages returns page list", async () => {
  const h = await createTestHarness({ content: CONTENT });
  try {
    const res = await h.fetch("/api/pages");
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(Array.isArray(json.items), true);
    assertEquals(json.items.length, 2);
  } finally {
    await h.dispose();
  }
});

Deno.test("h.fetch — GET /api/pages/:path returns single page", async () => {
  const h = await createTestHarness({ content: CONTENT });
  try {
    const res = await h.fetch("/api/pages//home/");
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.title, "Home");
  } finally {
    await h.dispose();
  }
});

Deno.test("h.fetch — GET /api/config/site returns site config", async () => {
  const h = await createTestHarness({ content: CONTENT, siteTitle: "Fetch Test Site" });
  try {
    const res = await h.fetch("/api/config/site");
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.title, "Fetch Test Site");
  } finally {
    await h.dispose();
  }
});

Deno.test("h.fetch — unknown route returns 404", async () => {
  const h = await createTestHarness({ content: CONTENT });
  try {
    const res = await h.fetch("/not-a-real-route");
    assertEquals(res.status, 404);
  } finally {
    await h.dispose();
  }
});

Deno.test("h.render — returns response body as text", async () => {
  const h = await createTestHarness({ content: CONTENT, siteTitle: "Render Test" });
  try {
    const body = await h.render("/api/config/site");
    assertStringIncludes(body, "Render Test");
  } finally {
    await h.dispose();
  }
});

Deno.test("h.fetch — GET /api/search returns results", async () => {
  const h = await createTestHarness({ content: CONTENT });
  try {
    const res = await h.fetch("/api/search?q=hello");
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(Array.isArray(json.items), true);
  } finally {
    await h.dispose();
  }
});
