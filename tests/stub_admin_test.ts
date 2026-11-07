/**
 * A replacement admin built only on core's injected services, capabilities and
 * mount API. If these pass, Dune does not depend on `@dune/plugin-admin`.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { DunePlugin } from "@dune/core/hooks";
import { createAppHarness, createStubAdmin } from "../src/mod.ts";

const content = {
  "01.home/default.md": "---\ntitle: Home\n---\nHello world",
  "02.about/default.md": "---\ntitle: About\n---\nAbout us",
};

/** Records the auth core hands to transformResponse and adds an editing marker. */
function probe() {
  const seen: { username?: string; canUpdate?: boolean; role?: string }[] = [];
  const plugin: DunePlugin = {
    name: "probe",
    version: "1.0.0",
    hooks: {},
    async transformResponse({ response, auth }) {
      seen.push(
        auth
          ? {
            username: auth.username,
            role: auth.role,
            canUpdate: auth.hasPermission("pages.update"),
          }
          : {},
      );
      const type = response.headers.get("Content-Type") ?? "";
      if (!type.includes("text/html")) return response;
      const body = await response.text();
      return new Response(
        body.replace("</body>", `<p data-dune-field="probe">m</p></body>`),
        {
          status: response.status,
          headers: response.headers,
        },
      );
    },
  };
  return { plugin, seen };
}

async function login(
  h: Awaited<ReturnType<typeof createAppHarness>>,
  prefix: string,
  username: string,
  password: string,
) {
  const res = await h.request(`${prefix}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

Deno.test("stub admin: the public site serves with it installed, and core sees what it provides", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
  });
  const h = await createAppHarness({ content, plugins: [admin.plugin] });
  try {
    const home = await h.request("/");
    assertEquals(home.status, 200);
    assertStringIncludes(
      await home.text(),
      "<title>Home | Dune Test Site</title>",
    );

    const providers = Object.fromEntries(
      h.bootstrap.capabilities.providers().map((p) => [p.name, p]),
    );
    assertEquals(providers["editor.session"].provider, "stub-admin");
    assertEquals(providers["editor.session"].status, "active");
    assertEquals(providers["scheduler.executor"].status, "active");
    assertExists(
      h.bootstrap.authz,
      "core creates authz for any editor.session provider, with admin.enabled false",
    );
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: login accepts the right password and sets its own cookie", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
  });
  const h = await createAppHarness({ content, plugins: [admin.plugin] });
  try {
    const bad = await login(h, admin.prefix, "ed", "wrong");
    assertEquals(bad.res.status, 401);
    assertEquals(bad.cookie, undefined);
    assertEquals(
      (await login(h, admin.prefix, "nobody", "pw")).res.status,
      401,
    );

    const good = await login(h, admin.prefix, "ed", "pw");
    assertEquals(good.res.status, 200);
    assertStringIncludes(good.cookie ?? "", `${admin.cookieName}=`);
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: core's transform pipeline recognises its session and only its session", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
  });
  const { plugin, seen } = probe();
  const h = await createAppHarness({
    content,
    plugins: [admin.plugin, plugin],
  });
  try {
    const { cookie } = await login(h, admin.prefix, "ed", "pw");
    assertExists(cookie);

    const anonymous = await h.request("/about/");
    const anonHtml = await anonymous.text();
    assertEquals(seen.at(-1), {}, "no cookie: auth is null");
    assertEquals(
      anonHtml.includes("data-dune-field"),
      false,
      "markers are scrubbed for anonymous visitors",
    );

    const other = await h.request("/about/", {
      headers: { cookie: "analytics=1" },
    });
    await other.text();
    assertEquals(seen.at(-1), {}, "an unrelated cookie is not a session");

    const editor = await h.request("/about/", { headers: { cookie } });
    const editorHtml = await editor.text();
    assertEquals(seen.at(-1), {
      username: "ed",
      role: "admin",
      canUpdate: true,
    });
    assertStringIncludes(
      editorHtml,
      "data-dune-field",
      "editing markers survive for a valid editing session",
    );
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: a forged cookie is not a session", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
  });
  const { plugin, seen } = probe();
  const h = await createAppHarness({
    content,
    plugins: [admin.plugin, plugin],
  });
  try {
    const res = await h.request("/about/", {
      headers: { cookie: `${admin.cookieName}=forged` },
    });
    assertEquals((await res.text()).includes("data-dune-field"), false);
    assertEquals(seen.at(-1), {});
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: a provider that does not declare its cookie is still found (any cookie is tried)", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
    declareCookie: false,
    cookieName: "weird_name",
  });
  const { plugin, seen } = probe();
  const h = await createAppHarness({
    content,
    plugins: [admin.plugin, plugin],
  });
  try {
    assertEquals(
      h.bootstrap.capabilities.get("editor.session")?.sessionCookies,
      undefined,
    );
    const { cookie } = await login(h, admin.prefix, "ed", "pw");
    await (await h.request("/about/", { headers: { cookie: cookie! } })).text();
    assertEquals(seen.at(-1)?.username, "ed");
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: it edits a page through storage and fires onPageUpdate itself", async () => {
  const admin = createStubAdmin({
    users: [{ username: "ed", password: "pw" }],
  });
  const updates: unknown[] = [];
  const listener: DunePlugin = {
    name: "listener",
    version: "1.0.0",
    hooks: { onPageUpdate: ({ data }) => void updates.push(data) },
  };
  const h = await createAppHarness({
    content,
    plugins: [admin.plugin, listener],
  });
  try {
    const edit = (cookie?: string) =>
      h.request(`${admin.prefix}/pages/edit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({
          sourcePath: "content/02.about/default.md",
          content: "---\ntitle: About\n---\nEdited",
        }),
      });

    assertEquals((await edit()).status, 401, "anonymous cannot edit");
    assertEquals(updates.length, 0);

    const { cookie } = await login(h, admin.prefix, "ed", "pw");
    const res = await edit(cookie);
    assertEquals(res.status, 200);
    assertEquals(
      await h.storage.readText("content/02.about/default.md"),
      "---\ntitle: About\n---\nEdited",
    );
    assertEquals(
      updates,
      [{ sourcePath: "02.about/default.md" }],
      "the writer fires the event, exactly once",
    );

    const list = await h.request(`${admin.prefix}/pages`, {
      headers: { cookie: cookie! },
    });
    assertEquals((await list.json()).pages.length, 2);
  } finally {
    await h.dispose();
  }
});

Deno.test("stub admin: an account without an editing role is authenticated but cannot edit", async () => {
  const admin = createStubAdmin({
    users: [{ username: "viewer", password: "pw", role: "member" }],
  });
  const h = await createAppHarness({ content, plugins: [admin.plugin] });
  try {
    const { cookie } = await login(h, admin.prefix, "viewer", "pw");
    const res = await h.request(`${admin.prefix}/pages/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({
        sourcePath: "content/02.about/default.md",
        content: "x",
      }),
    });
    assertEquals(res.status, 403);
  } finally {
    await h.dispose();
  }
});

Deno.test("without any admin the site still serves, and nothing admin-related exists", async () => {
  const h = await createAppHarness({ content });
  try {
    assertEquals((await h.request("/")).status, 200);
    assertEquals(h.bootstrap.capabilities.get("editor.session"), undefined);
    assertEquals(h.bootstrap.authz, undefined);
    assertEquals((await h.request("/stub-admin/pages")).status, 404);
    assertEquals((await h.request("/api/inline-edit/ws")).status, 501);
  } finally {
    await h.dispose();
  }
});
