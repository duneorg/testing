/**
 * The conformance suite is only worth something if it fails for an admin that
 * breaks the contract. Each case builds the stub admin, breaks one thing, and
 * asserts that the matching check (and not the whole suite) rejects it.
 */

import { assertRejects } from "@std/assert";
import type { DunePlugin } from "@dune/core/hooks";
import {
  adminConformanceChecks,
  createAppHarness,
  createStubAdmin,
} from "../src/mod.ts";
import type { AdminConformanceDriver, ConformanceApp } from "../src/mod.ts";

type Breaker = (
  admin: DunePlugin,
  helpers: { cookieName: string },
) => DunePlugin;

/** A driver over the stub admin, with `breaker` applied to the admin plugin. */
function driverWith(
  name: string,
  breaker?: Breaker,
  withAuth = true,
  afterSignIn?: (app: ConformanceApp, cookie: string) => Promise<void>,
): AdminConformanceDriver {
  const prefixes = new WeakMap<ConformanceApp, string>();
  const login = async (app: ConformanceApp, username: string) => {
    const res = await app.request(`${prefixes.get(app)}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "pw" }),
    });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error(`login failed: ${res.status}`);
    return cookie;
  };
  return {
    name,
    async createApp({ content, extraPlugins, withAdmin }) {
      const stub = createStubAdmin({
        users: [{ username: "ed", password: "pw" }],
      });
      const admin = breaker
        ? breaker(stub.plugin, { cookieName: stub.cookieName })
        : stub.plugin;
      const h = await createAppHarness({
        content,
        plugins: [...extraPlugins, ...(withAdmin && withAuth ? [admin] : [])],
      });
      const app: ConformanceApp = {
        request: h.request,
        bootstrap: h.bootstrap,
        readText: (p) => h.storage.readText(p),
        dispose: h.dispose,
      };
      prefixes.set(app, stub.prefix);
      return app;
    },
    signInEditor: async (app) => {
      const cookie = await login(app, "ed");
      await afterSignIn?.(app, cookie);
      return cookie;
    },
  };
}

const find = (driver: AdminConformanceDriver, fragment: string) => {
  const check = adminConformanceChecks(driver).find((c) =>
    c.name.includes(fragment)
  );
  if (!check) throw new Error(`no check matching "${fragment}"`);
  return check;
};

/** Run the stub's own setup, then replace `auth.session` with `override`. */
const replaceSession =
  (override: (cookieName: string) => unknown): Breaker =>
  (admin, { cookieName }) => ({
    ...admin,
    setup(api) {
      admin.setup!(api);
      api.capabilities.provide(
        "auth.session",
        () => override(cookieName) as never,
      );
    },
  });

Deno.test("conformance catches an admin that provides no auth.session", async () => {
  const bare: Breaker = (admin) => ({ ...admin, setup: () => {} });
  await assertRejects(() =>
    find(driverWith("no-session", bare), "provides auth.session").run()
  );
});

Deno.test("conformance catches an admin that declares a cookie its sign-in does not set", async () => {
  const wrongCookie = replaceSession(() => ({
    sessionCookies: ["some_other_cookie"],
    authenticate: () => Promise.resolve({ authenticated: false }),
  }));
  await assertRejects(
    () =>
      find(driverWith("wrong-cookie", wrongCookie), "the cookie it declares")
        .run(),
    Error,
    "does not include the cookie sign-in sets",
  );
});

Deno.test("conformance catches an admin that accepts a forged session as the real editor", async () => {
  // Authenticates properly, but any request with a cookie header gets the last
  // editor it saw. (Core's authz still decides pages.update, so the gullible
  // identity has to be a real editor for the problem to show.)
  const gullible: Breaker = (admin) => ({
    ...admin,
    setup(api) {
      let real: {
        authenticate(req: Request): Promise<{ authenticated: boolean }>;
      };
      admin.setup!({
        ...api,
        capabilities: {
          ...api.capabilities,
          provide: (name: string, factory: unknown) => {
            if (name === "auth.session") {
              real = (factory as (ctx: unknown) => typeof real)({});
            } else {
              (api.capabilities.provide as unknown as (
                n: string,
                f: unknown,
              ) => void)(name, factory);
            }
          },
        } as never,
      });
      let last: unknown;
      api.capabilities.provide("auth.session", () => ({
        authenticate: async (req: Request) => {
          const r = await real.authenticate(req);
          if (r.authenticated) {
            last = r;
            return r;
          }
          return req.headers.has("cookie") && last ? last : r;
        },
      } as never));
    },
  });
  const driver = driverWith(
    "gullible",
    gullible,
    true,
    async (app, cookie) => {
      await (await app.request("/about/", { headers: { cookie } })).text(); // teaches it the editor
    },
  );
  await assertRejects(
    () => find(driver, "recognises an editor session").run(),
    Error,
    "is not a session",
  );
});

Deno.test("conformance catches an admin that never recognises its own session", async () => {
  const deaf = replaceSession(() => ({
    authenticate: () => Promise.resolve({ authenticated: false }),
  }));
  await assertRejects(
    () => find(driverWith("deaf", deaf), "recognises an editor session").run(),
    Error,
    "reaches plugins with pages.update",
  );
});

Deno.test("conformance catches an admin whose route cannot tell who the admin is", async () => {
  const deaf = replaceSession(() => ({
    authenticate: () => Promise.resolve({ authenticated: false }),
  }));
  await assertRejects(() =>
    find(driverWith("deaf", deaf), "mounted before the admin").run()
  );
});

Deno.test("conformance catches an admin that writes pages without announcing them", async () => {
  // The writes land on disk but no event is fired: search indexes, webhooks and
  // audit plugins would never hear of them.
  const silent: AdminConformanceDriver = {
    ...driverWith("silent"),
    createPage: async (app, _cookie, { sourcePath, title }) => {
      await app.bootstrap.storage.write(
        sourcePath,
        `---\ntitle: ${title}\n---\n`,
      );
    },
    deletePage: async (app, _cookie, { sourcePath }) => {
      await app.bootstrap.storage.delete(sourcePath);
    },
  };
  await assertRejects(
    () => find(silent, "creating a page").run(),
    Error,
    "fires onPageCreate, once",
  );
  await assertRejects(
    () => find(silent, "deleting a page").run(),
    Error,
    "fires onPageDelete, once",
  );
});
