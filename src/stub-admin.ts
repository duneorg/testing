/**
 * A minimal replacement admin, used to prove that Dune does not depend on
 * `@dune/plugin-admin`.
 *
 * It implements just enough of an admin to exercise the plugin contract: it
 * authenticates users and keeps sessions through core's injected services,
 * provides the `auth.session` and `scheduler.executor` capabilities, seeds
 * authorisation tuples through `services.authz`, and offers a login, a page
 * listing and a page edit route of its own. It imports nothing from
 * `@dune/plugin-admin`; everything it needs arrives through `PluginApi` and
 * `MountApi`.
 *
 * ```ts
 * import { createAppHarness, createStubAdmin } from "@dune/testing";
 *
 * const admin = createStubAdmin({ users: [{ username: "ed", password: "pw", role: "admin" }] });
 * const h = await createAppHarness({ content: { ... }, plugins: [admin.plugin] });
 * ```
 *
 * @module
 */

import type { DunePlugin } from "@dune/core/hooks";
import type { ScheduledAction } from "@dune/core/workflow";
import type { PluginServices } from "@dune/core/plugin-api";

type UserStore = ReturnType<PluginServices["users"]["createLocalStore"]>;
type SessionManager = Awaited<
  ReturnType<PluginServices["sessions"]["createManager"]>
>;

/** An account the stub seeds at startup. */
export interface StubAdminUser {
  username: string;
  password: string;
  /** Admin-tier role, default `"admin"`. */
  role?: string;
}

/** Options for {@link createStubAdmin}. */
export interface StubAdminOptions {
  /** Accounts to create. Default: none. */
  users?: StubAdminUser[];
  /** Session cookie name. Default `"stub_sid"` (deliberately not the built-in admin's). */
  cookieName?: string;
  /** Route prefix of the stub's own routes. Default `"/stub-admin"`. */
  prefix?: string;
  /**
   * Declare the session cookie to core (`RequestAuthenticator.sessionCookies`).
   * Default true. Pass false to test the conservative behaviour for a provider
   * that does not say which cookie carries its session.
   */
  declareCookie?: boolean;
}

/** The stub plugin plus what it recorded. */
export interface StubAdmin {
  plugin: DunePlugin;
  /** Scheduled actions core handed to the `scheduler.executor` capability. */
  executedActions: ScheduledAction[];
  /** The cookie name sessions use. */
  cookieName: string;
  /** Route prefix of the stub's own routes. */
  prefix: string;
}

/** Create the stub admin. See the module documentation. */
export function createStubAdmin(options: StubAdminOptions = {}): StubAdmin {
  const cookieName = options.cookieName ?? "stub_sid";
  const prefix = options.prefix ?? "/stub-admin";
  const declareCookie = options.declareCookie ?? true;
  const executedActions: ScheduledAction[] = [];

  // Created in setup() from the injected services, used by both capabilities
  // and routes. Seeding finishes before the first request is served: mount()
  // awaits `ready`.
  let state: {
    users: UserStore;
    sessions: SessionManager | null;
    passwords: PluginServices["passwords"];
    ready: Promise<void>;
  } | null = null;

  const readSessionId = (req: Request): string | null => {
    const cookie = req.headers.get("cookie") ?? "";
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
    return m ? m[1] : null;
  };

  const authenticate = async (req: Request) => {
    const sid = readSessionId(req);
    if (!sid || !state) return { authenticated: false };
    await state.ready;
    const session = await state.sessions!.get(sid); // set before `ready` resolves
    if (!session) return { authenticated: false };
    const user = await state.users.getById(session.userId);
    if (!user || user.enabled === false) return { authenticated: false };
    return {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
      },
    };
  };

  const plugin: DunePlugin = {
    name: "stub-admin",
    version: "1.0.0",
    description:
      "A minimal replacement admin built on core's services and capabilities only.",
    hooks: {},

    setup(api) {
      const { services, capabilities } = {
        services: api.services,
        capabilities: api.capabilities,
      };
      const usersDir = `${services.paths.dataDir}/stub-admin/users`;
      const users = services.users.createLocalStore({ usersDir });
      const sessionsReady = services.sessions.createManager({
        sessionsDir: `${services.paths.runtimeDir}/stub-admin/sessions`,
        lifetimeMs: 60 * 60 * 1000,
      });

      const ready = (async () => {
        const sessions = await sessionsReady;
        state!.sessions = sessions;
        for (const u of options.users ?? []) {
          if (await users.getByUsername(u.username)) continue;
          await users.create({
            email: `${u.username}@stub-admin.test`,
            username: u.username,
            name: u.username,
            provider: "local",
            passwordHash: await services.passwords.hash(u.password),
            roles: [u.role ?? "admin"],
          });
        }
        const all = await users.list();
        await services.authz.seedAdminTuples(
          all.map((u) => ({ id: u.id, role: u.roles[0] })),
        );
      })();
      state = { users, sessions: null, passwords: services.passwords, ready };

      capabilities.provide("auth.session", () => ({
        ...(declareCookie ? { sessionCookies: [cookieName] } : {}),
        authenticate,
      }));
      capabilities.provide("scheduler.executor", () => ({
        execute: (action) => {
          executedActions.push(action);
          return Promise.resolve();
        },
      }));
    },

    async mount({ app, bootstrap }) {
      await state!.ready;
      const { users, passwords } = state!;
      const sessions = state!.sessions!;
      const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
        Response.json(body, { status, headers });

      app.post(`${prefix}/login`, async (fc) => {
        const body = await fc.req.json().catch(() => ({}));
        const user = typeof body.username === "string"
          ? await users.getByUsername(body.username)
          : null;
        // Verify against a dummy hash for unknown users so both paths cost the same.
        const ok = await passwords.verify(
          String(body.password ?? ""),
          user?.passwordHash ?? passwords.dummyHash,
        );
        if (!user || !ok || user.enabled === false) {
          return json({ error: "Invalid credentials" }, 401);
        }
        const session = await sessions.create(user.id);
        return json({ ok: true }, 200, {
          "Set-Cookie":
            `${cookieName}=${session.id}; Path=/; HttpOnly; SameSite=Lax`,
        });
      });

      app.get(`${prefix}/pages`, async (fc) => {
        const who = await authenticate(fc.req);
        if (!who.authenticated) return json({ error: "Unauthorized" }, 401);
        return json({
          pages: bootstrap.engine.pages.map((p) => ({
            route: p.route,
            title: p.title,
            sourcePath: p.sourcePath,
          })),
        });
      });

      // The stub is a writer, so it fires the matching event itself. Events
      // carry the path relative to the content directory, as core reports it.
      const contentDir = bootstrap.config.system.content.dir;
      const relative = (p: string) =>
        p.startsWith(`${contentDir}/`) ? p.slice(contentDir.length + 1) : p;

      /** Authenticated, allowed to update pages, and a well-formed body; else the error response. */
      const guarded = async (
        fc: { req: Request },
        needs: Array<"content" | "title">,
      ): Promise<
        Response | { sourcePath: string; content: string; title: string }
      > => {
        const who = await authenticate(fc.req);
        if (!who.authenticated || !who.user) {
          return json({ error: "Unauthorized" }, 401);
        }
        const allowed = bootstrap.authz
          ? await bootstrap.authz.check({
            who: { type: "user", id: who.user.id },
            // deno-lint-ignore no-explicit-any
            canThey: "pages.update" as any,
            onWhat: { type: "app", id: "admin" },
          })
          : false;
        if (!allowed) return json({ error: "Forbidden" }, 403);
        const body = await fc.req.json().catch(() => ({}));
        if (typeof body.sourcePath !== "string") {
          return json({ error: "sourcePath is required" }, 400);
        }
        for (const key of needs) {
          if (typeof body[key] !== "string") {
            return json({ error: `${key} is required` }, 400);
          }
        }
        return {
          sourcePath: body.sourcePath,
          content: body.content ?? "",
          title: body.title ?? "",
        };
      };

      app.post(`${prefix}/pages/edit`, async (fc) => {
        const g = await guarded(fc, ["content"]);
        if (g instanceof Response) return g;
        await bootstrap.storage.write(g.sourcePath, g.content);
        await bootstrap.hooks.fire("onPageUpdate", {
          sourcePath: relative(g.sourcePath),
        });
        return json({ ok: true });
      });

      app.post(`${prefix}/pages/create`, async (fc) => {
        const g = await guarded(fc, ["title"]);
        if (g instanceof Response) return g;
        await bootstrap.storage.write(
          g.sourcePath,
          `---\ntitle: ${g.title}\n---\n${g.content}`,
        );
        await bootstrap.hooks.fire("onPageCreate", {
          sourcePath: relative(g.sourcePath),
          title: g.title,
        });
        return json({ ok: true });
      });

      app.post(`${prefix}/pages/delete`, async (fc) => {
        const g = await guarded(fc, []);
        if (g instanceof Response) return g;
        await bootstrap.storage.delete(g.sourcePath);
        await bootstrap.hooks.fire("onPageDelete", {
          sourcePath: relative(g.sourcePath),
        });
        return json({ ok: true });
      });
    },
  };

  return { plugin, executedActions, cookieName, prefix };
}
