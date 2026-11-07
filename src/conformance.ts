/**
 * Admin conformance suite: checks that an admin plugin meets the contract with
 * core, without knowing anything else about it.
 *
 * Dune does not depend on `@dune/plugin-admin`: any plugin that provides the
 * `editor.session` capability is "the admin" as far as core is concerned. This
 * suite is what "meets the contract" means. Hand it a *driver* that says how to
 * build an app with your admin installed and how to sign an editor in; it
 * registers the tests.
 *
 * ```ts
 * import { createAppHarness, createStubAdmin, runAdminConformance } from "@dune/testing";
 *
 * runAdminConformance({
 *   name: "my-admin",
 *   async createApp({ content, extraPlugins, withAdmin }) {
 *     const admin = createMyAdmin();
 *     const h = await createAppHarness({ content, plugins: [...extraPlugins, ...(withAdmin ? [admin] : [])] });
 *     return { request: h.request, bootstrap: h.bootstrap, readText: (p) => h.storage.readText(p), dispose: h.dispose };
 *   },
 *   signInEditor: async (app) => (await login(app, "ed")).cookie,
 * });
 * ```
 *
 * The suite covers what core relies on: the capabilities the admin provides,
 * that core's response pipeline recognises exactly the admin's sessions (and
 * keeps editing markers only for a valid editing session), that the cookie it
 * declares is the cookie it sets, that a route in a plugin mounted *before* the
 * admin can still tell who the admin is, and that the site serves without it.
 * Optional parts run when the driver supplies the hook for them.
 *
 * @module
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { BootstrapResult } from "@dune/core/bootstrap";
import type { DunePlugin } from "@dune/core/hooks";

/** What the suite needs from a running app. */

/**
 * The registry is keyed by string at runtime; `admin.pages` and `admin.routes`
 * are declared by whichever admin plugin is installed, not by core. The suite
 * checks the protocol, so it calls them through this untyped view instead of
 * depending on one admin's types.
 */
function untyped(registrar: unknown): { contribute(point: string, item: unknown): void } {
  return registrar as { contribute(point: string, item: unknown): void };
}

export interface ConformanceApp {
  /** Send an in-process request through the whole app. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** The bootstrap result: capabilities, authz, hooks. */
  bootstrap: BootstrapResult;
  /** Read a stored file by its site-relative path (for example `content/02.about/default.md`). */
  readText(path: string): Promise<string>;
  /** Tear the app down. */
  dispose(): Promise<void>;
}

/** Options the suite passes to {@link AdminConformanceDriver.createApp}. */
export interface ConformanceAppOptions {
  /** Fixture content, keyed by path relative to `content/`. */
  content: Record<string, string>;
  /**
   * Plugins to register **before** the admin, in this order. Registration order
   * is mount order, and the suite relies on the admin mounting after them.
   */
  extraPlugins: DunePlugin[];
  /** False: build the app with no admin at all. */
  withAdmin: boolean;
}

/** Describes the admin under test. Implement it once per admin. */
export interface AdminConformanceDriver {
  /** Shown in every test name. */
  name: string;
  /** Build an app with (or, for `withAdmin: false`, without) the admin. */
  createApp(options: ConformanceAppOptions): Promise<ConformanceApp>;
  /**
   * Create an account allowed to edit pages (`pages.update`), sign it in, and
   * return the value of the `Cookie` header that authenticates it.
   */
  signInEditor(app: ConformanceApp): Promise<string>;
  /** Optional: an account that signs in but may not edit. Enables the viewer test. */
  signInViewer?(app: ConformanceApp): Promise<string>;
  /**
   * Optional: edit a page through the admin's own routes, as the signed-in
   * editor. Enables the check that the writer fires `onPageUpdate` once.
   * `sourcePath` is the site-relative path of the content file.
   */
  editPage?(
    app: ConformanceApp,
    cookie: string,
    edit: { sourcePath: string; content: string },
  ): Promise<void>;
  /**
   * Optional: create a page through the admin's own routes. `sourcePath` is the
   * site-relative path of the content file to create. Enables the check that
   * the writer fires `onPageCreate` once.
   */
  createPage?(
    app: ConformanceApp,
    cookie: string,
    page: { sourcePath: string; title: string },
  ): Promise<void>;
  /**
   * Optional: delete an existing page through the admin's own routes.
   * Enables the check that the writer fires `onPageDelete` once.
   */
  deletePage?(
    app: ConformanceApp,
    cookie: string,
    page: { sourcePath: string },
  ): Promise<void>;
  /**
   * Optional: true if the admin mounts `admin.pages` and `admin.routes`
   * contributions from other plugins, the extension points
   * `@dune/plugin-admin` declares (they are the admin's convention, not part of
   * core's contract, so an alternative admin chooses whether to host them).
   * Enables those checks. The admin's URL
   * prefix is not part of the driver: the suite reads it from the
   * `admin.prefix` slot the admin must provide.
   */
  hostsContributions?: boolean;
}

const CONTENT = {
  "01.home/default.md": "---\ntitle: Home\n---\nHello world",
  "02.about/default.md": "---\ntitle: About\n---\nAbout us",
};
const ABOUT = "/about/";
const MARKER = "data-dune-field";

/**
 * An admin may fire a page event after it has answered, so give the first one
 * a moment to arrive, then a moment more to show it does not fire twice.
 */
async function settle(events: unknown[]): Promise<void> {
  for (let i = 0; i < 40 && events.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 75));
}

/** What a probe plugin records for each response core hands it. */
interface Seen {
  username?: string;
  canUpdate?: boolean;
}

/** Records `ResponseTransformContext.auth` and adds an editing marker to HTML. */
function probe() {
  const seen: Seen[] = [];
  const plugin: DunePlugin = {
    name: "conformance-probe",
    version: "1.0.0",
    hooks: {},
    async transformResponse({ response, auth }) {
      seen.push(
        auth
          ? {
            username: auth.username,
            canUpdate: auth.hasPermission("pages.update"),
          }
          : {},
      );
      if (!(response.headers.get("Content-Type") ?? "").includes("text/html")) {
        return response;
      }
      const body = await response.text();
      return new Response(
        body.replace("</body>", `<p ${MARKER}="probe">m</p></body>`),
        {
          status: response.status,
          headers: response.headers,
        },
      );
    },
  };
  return { plugin, seen };
}

/** Build an app just to read the prefix the admin provides. */
async function withPrefix(driver: AdminConformanceDriver): Promise<string> {
  let prefix = "";
  await withApp(driver, {}, (app) => {
    prefix = adminPrefixOf(app);
    return Promise.resolve();
  });
  return prefix;
}

async function withApp(
  driver: AdminConformanceDriver,
  options: Partial<ConformanceAppOptions>,
  fn: (app: ConformanceApp) => Promise<void>,
): Promise<void> {
  const app = await driver.createApp({
    content: CONTENT,
    extraPlugins: [],
    withAdmin: true,
    ...options,
  });
  try {
    await fn(app);
  } finally {
    await app.dispose();
  }
}

/** The prefix the admin provides through `admin.prefix`; throws if it provides none. */
function adminPrefixOf(app: ConformanceApp): string {
  const slot = app.bootstrap.capabilities.get("admin.prefix");
  assertExists(slot, "no plugin provides admin.prefix");
  return slot.prefix;
}

const cookieNames = (cookie: string) =>
  cookie.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean);

/** One conformance check: a name and the function that throws when the admin does not conform. */
export interface ConformanceCheck {
  name: string;
  run(): Promise<void>;
}

/**
 * The conformance checks for the admin that `driver` describes, without
 * registering them. {@link runAdminConformance} registers them as tests; call
 * this directly to run them yourself (for example to assert that a deliberately
 * broken admin fails one).
 */
export function adminConformanceChecks(
  driver: AdminConformanceDriver,
): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [];
  const t = (name: string, run: () => Promise<void>) =>
    checks.push({ name: `conformance [${driver.name}]: ${name}`, run });

  t(
    "provides editor.session, the capability that makes it the admin",
    () =>
      withApp(driver, {}, (app) => {
        const providers = app.bootstrap.capabilities.providers();
        const session = providers.find((p) => p.name === "editor.session");
        assertExists(session, "no plugin provides editor.session");
        assertEquals(
          session.status,
          "active",
          "the editor.session factory did not produce a provider",
        );
        assertEquals(
          providers.filter((p) => p.name === "editor.session").length,
          1,
          "exactly one editor.session provider",
        );
        return Promise.resolve();
      }),
  );

  t(
    "provides admin.prefix: a path prefix core can reserve, from exactly one provider",
    () =>
      withApp(driver, {}, (app) => {
        const providers = app.bootstrap.capabilities.providers();
        const slot = providers.filter((p) => p.name === "admin.prefix");
        assertEquals(slot.length, 1, "exactly one admin.prefix provider");
        assertEquals(slot[0].status, "active");
        const prefix = adminPrefixOf(app);
        assertEquals(
          prefix.length > 1 && prefix.startsWith("/") && !prefix.endsWith("/"),
          true,
          `"${prefix}" must start with "/" and have no trailing slash`,
        );
        return Promise.resolve();
      }),
  );

  t(
    "core reserves the admin prefix: a plugin public route under it is refused",
    async () => {
      const prefix = await withPrefix(driver);
      const squatter: DunePlugin = {
        name: "conformance-squatter",
        version: "1.0.0",
        hooks: {},
        publicRoutes: [{
          path: `${prefix}/__conformance-squat`,
          handler: () => new Response("squatted"),
        }],
      };
      await withApp(driver, { extraPlugins: [squatter] }, async (app) => {
        const res = await app.request(`${prefix}/__conformance-squat`);
        assertEquals(
          (await res.text()).includes("squatted"),
          false,
          "a plugin route answered inside the admin's prefix",
        );
      });
    },
  );

  t(
    "the public site serves, and anonymous visitors are not admins",
    () =>
      withApp(driver, {}, async (app) => {
        const home = await app.request("/");
        assertEquals(home.status, 200);
        assertStringIncludes(await home.text(), "<title>Home");

        const auth = app.bootstrap.capabilities.get("editor.session")!;
        const anonymous = await auth.authenticate(
          new Request("http://localhost:8000/"),
        );
        assertEquals(anonymous.authenticated, false);
      }),
  );

  t(
    "core's response pipeline recognises an editor session, and only a real one",
    async () => {
      const { plugin, seen } = probe();
      await withApp(driver, { extraPlugins: [plugin] }, async (app) => {
        const cookie = await driver.signInEditor(app);

        const anonymous = await app.request(ABOUT);
        const anonymousHtml = await anonymous.text();
        assertEquals(seen.at(-1), {}, "no cookie: core hands plugins no auth");
        assertEquals(
          anonymousHtml.includes(MARKER),
          false,
          "editing markers are scrubbed for anonymous visitors",
        );

        await (await app.request(ABOUT, { headers: { cookie: "analytics=1" } }))
          .text();
        assertEquals(seen.at(-1), {}, "an unrelated cookie is not a session");

        const forged = cookieNames(cookie).map((n) => `${n}=forged-value`).join(
          "; ",
        );
        const forgedHtml =
          await (await app.request(ABOUT, { headers: { cookie: forged } }))
            .text();
        assertEquals(
          seen.at(-1),
          {},
          "a forged session cookie is not a session",
        );
        assertEquals(forgedHtml.includes(MARKER), false);

        const editorHtml =
          await (await app.request(ABOUT, { headers: { cookie } })).text();
        assertEquals(
          seen.at(-1)?.canUpdate,
          true,
          "an editor session reaches plugins with pages.update",
        );
        assertEquals(typeof seen.at(-1)?.username, "string");
        assertStringIncludes(
          editorHtml,
          MARKER,
          "editing markers survive for a valid editing session",
        );
      });
    },
  );

  t(
    "the cookie it declares is the cookie its sign-in sets",
    () =>
      withApp(driver, {}, async (app) => {
        const declared = app.bootstrap.capabilities.get("editor.session")
          ?.sessionCookies;
        if (!declared) return; // undeclared is allowed: core then tries every request that has cookies
        const cookie = await driver.signInEditor(app);
        const set = cookieNames(cookie);
        assertEquals(
          declared.some((name) => set.includes(name)),
          true,
          `sessionCookies ${
            JSON.stringify(declared)
          } does not include the cookie sign-in sets (${set.join(", ")}): ` +
            `core would never consult the admin for that session, and its pages could enter the shared cache`,
        );
      }),
  );

  if (driver.signInViewer) {
    t(
      "an account without editing rights is not given editing chrome",
      async () => {
        const { plugin, seen } = probe();
        await withApp(driver, { extraPlugins: [plugin] }, async (app) => {
          const cookie = await driver.signInViewer!(app);
          const html = await (await app.request(ABOUT, { headers: { cookie } }))
            .text();
          assertEquals(
            seen.at(-1)?.canUpdate === true,
            false,
            "pages.update must not be granted",
          );
          assertEquals(
            html.includes(MARKER),
            false,
            "markers are scrubbed without pages.update",
          );
        });
      },
    );
  }

  t(
    "a route in a plugin mounted before the admin can still tell who the admin is",
    async () => {
      const who: DunePlugin = {
        name: "conformance-who",
        version: "1.0.0",
        hooks: {},
        mount({ app, capabilities }) {
          app.get("/__conformance/who", async (fc) => {
            const result = await capabilities.get("editor.session")?.authenticate(
              fc.req,
            );
            return new Response(result?.authenticated ? "admin" : "anonymous");
          });
        },
      };
      await withApp(driver, { extraPlugins: [who] }, async (app) => {
        const cookie = await driver.signInEditor(app);
        assertEquals(
          await (await app.request("/__conformance/who")).text(),
          "anonymous",
        );
        assertEquals(
          await (await app.request("/__conformance/who", {
            headers: { cookie },
          })).text(),
          "admin",
        );
      });
    },
  );

  if (driver.editPage) {
    t(
      "editing a page through the admin writes it and fires onPageUpdate exactly once",
      async () => {
        const updates: unknown[] = [];
        const listener: DunePlugin = {
          name: "conformance-listener",
          version: "1.0.0",
          hooks: { onPageUpdate: ({ data }) => void updates.push(data) },
        };
        await withApp(driver, { extraPlugins: [listener] }, async (app) => {
          const cookie = await driver.signInEditor(app);
          const content = "---\ntitle: About\n---\nEdited by conformance";
          await driver.editPage!(app, cookie, {
            sourcePath: "content/02.about/default.md",
            content,
          });
          assertStringIncludes(
            await app.readText("content/02.about/default.md"),
            "Edited by conformance",
          );
          await settle(updates);
          assertEquals(
            updates.length,
            1,
            "the writer fires onPageUpdate, once",
          );
        });
      },
    );
  }

  if (driver.createPage) {
    t(
      "creating a page through the admin writes it and fires onPageCreate exactly once",
      async () => {
        const created: unknown[] = [];
        const listener: DunePlugin = {
          name: "conformance-listener",
          version: "1.0.0",
          hooks: { onPageCreate: ({ data }) => void created.push(data) },
        };
        await withApp(driver, { extraPlugins: [listener] }, async (app) => {
          const cookie = await driver.signInEditor(app);
          await driver.createPage!(app, cookie, {
            sourcePath: "content/03.fresh/default.md",
            title: "Fresh",
          });
          assertStringIncludes(
            await app.readText("content/03.fresh/default.md"),
            "Fresh",
          );
          await settle(created);
          assertEquals(
            created.length,
            1,
            "the writer fires onPageCreate, once",
          );
          assertEquals(
            (created[0] as { sourcePath?: string }).sourcePath,
            "03.fresh/default.md",
            "the event carries the path relative to the content directory",
          );
        });
      },
    );
  }

  if (driver.deletePage) {
    t(
      "deleting a page through the admin removes it and fires onPageDelete exactly once",
      async () => {
        const deleted: unknown[] = [];
        const listener: DunePlugin = {
          name: "conformance-listener",
          version: "1.0.0",
          hooks: { onPageDelete: ({ data }) => void deleted.push(data) },
        };
        await withApp(driver, { extraPlugins: [listener] }, async (app) => {
          const cookie = await driver.signInEditor(app);
          await driver.deletePage!(app, cookie, {
            sourcePath: "content/02.about/default.md",
          });
          await app.readText("content/02.about/default.md").then(
            () => {
              throw new Error(
                "the page file is still on disk after the delete",
              );
            },
            () => {},
          );
          await settle(deleted);
          assertEquals(
            deleted.length,
            1,
            "the writer fires onPageDelete, once",
          );
          assertEquals(
            (deleted[0] as { sourcePath?: string }).sourcePath,
            "02.about/default.md",
            "the event carries the path relative to the content directory",
          );
        });
      },
    );
  }

  if (driver.hostsContributions) {
    t(
      "admin.pages from another plugin are mounted behind the admin's login",
      async () => {
        const contributor: DunePlugin = {
          name: "conformance-pages",
          version: "1.0.0",
          hooks: {},
          setup(api) {
            untyped(api.capabilities).contribute("admin.pages", {
              path: "/__conformance",
              label: "Conformance",
              permission: "pages.read",
              handler: () => new Response("conformance page"),
            });
          },
        };
        await withApp(driver, { extraPlugins: [contributor] }, async (app) => {
          const prefix = adminPrefixOf(app);
          const cookie = await driver.signInEditor(app);
          const anonymous = await app.request(`${prefix}/__conformance`);
          assertEquals(
            [301, 302, 401, 403].includes(anonymous.status),
            true,
            `anonymous got ${anonymous.status}`,
          );
          assertEquals(
            (await anonymous.text()).includes("conformance page"),
            false,
          );
          const editor = await app.request(`${prefix}/__conformance`, {
            headers: { cookie },
          });
          assertEquals(editor.status, 200);
          assertStringIncludes(await editor.text(), "conformance page");
        });
      },
    );

    t(
      "admin.routes from another plugin run only for a signed-in admin passing the CSRF check",
      async () => {
        let ran = 0;
        const contributor: DunePlugin = {
          name: "conformance-routes",
          version: "1.0.0",
          hooks: {},
          setup(api) {
            untyped(api.capabilities).contribute("admin.routes", {
              method: "POST",
              path: "/api/__conformance/act",
              permission: "pages.update",
              handler: () => {
                ran++;
                return new Response("done");
              },
            });
          },
        };
        await withApp(driver, { extraPlugins: [contributor] }, async (app) => {
          const prefix = adminPrefixOf(app);
          const cookie = await driver.signInEditor(app);
          const url = `${prefix}/api/__conformance/act`;
          const post = (headers: Record<string, string>) =>
            app.request(url, { method: "POST", headers });

          const anonymous = await post({ origin: "http://localhost:8000" });
          assertEquals(
            [301, 302, 401, 403].includes(anonymous.status),
            true,
            `anonymous got ${anonymous.status}`,
          );
          const crossOrigin = await post({
            cookie,
            origin: "https://evil.example",
          });
          assertEquals(
            crossOrigin.status,
            403,
            "a cross-origin POST is refused",
          );
          assertEquals(ran, 0, "the handler did not run for either");

          const ok = await post({ cookie, origin: "http://localhost:8000" });
          assertEquals(ok.status, 200);
          assertEquals(await ok.text(), "done");
          assertEquals(ran, 1);
        });
      },
    );
  }

  t(
    "without the admin the site serves and nothing admin-related exists",
    () =>
      withApp(driver, { withAdmin: false }, async (app) => {
        assertEquals((await app.request("/")).status, 200);
        assertEquals(app.bootstrap.capabilities.get("editor.session"), undefined);
        assertEquals(app.bootstrap.capabilities.get("admin.prefix"), undefined);
        assertEquals(app.bootstrap.authz, undefined);
        assertEquals((await app.request("/api/inline-edit/ws")).status, 501);
      }),
  );

  t(
    "without the admin nothing is reserved: /admin is an ordinary path for plugins",
    () => {
      const open: DunePlugin = {
        name: "conformance-open",
        version: "1.0.0",
        hooks: {},
        publicRoutes: [{
          path: "/admin/__conformance-open",
          handler: () => new Response("open"),
        }],
      };
      return withApp(
        driver,
        { withAdmin: false, extraPlugins: [open] },
        async (app) => {
          const res = await app.request("/admin/__conformance-open");
          assertEquals(res.status, 200);
          assertEquals(await res.text(), "open");
        },
      );
    },
  );

  return checks;
}

/** Register the conformance tests for the admin that `driver` describes. */
export function runAdminConformance(driver: AdminConformanceDriver): void {
  for (const check of adminConformanceChecks(driver)) {
    Deno.test({
      name: check.name,
      fn: check.run,
      sanitizeOps: false,
      sanitizeResources: false,
    });
  }
}
