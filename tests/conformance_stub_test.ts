/**
 * The reference run of the admin conformance suite: the stub admin, which is
 * built only on core's contract, must pass it.
 */

import {
  createAppHarness,
  createStubAdmin,
  runAdminConformance,
} from "../src/mod.ts";
import type { ConformanceApp } from "../src/mod.ts";
import type { StubAdmin } from "../src/mod.ts";

const admins = new WeakMap<ConformanceApp, StubAdmin>();

async function login(app: ConformanceApp, username: string): Promise<string> {
  const admin = admins.get(app)!;
  const res = await app.request(`${admin.prefix}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "pw" }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error(`stub login failed for ${username}: ${res.status}`);
  }
  return cookie;
}

runAdminConformance({
  name: "stub admin",
  async createApp({ content, extraPlugins, withAdmin }) {
    const admin = createStubAdmin({
      users: [
        { username: "ed", password: "pw", role: "admin" },
        { username: "viewer", password: "pw", role: "member" },
      ],
    });
    const h = await createAppHarness({
      content,
      plugins: [...extraPlugins, ...(withAdmin ? [admin.plugin] : [])],
    });
    const app: ConformanceApp = {
      request: h.request,
      bootstrap: h.bootstrap,
      readText: (path) => h.storage.readText(path),
      dispose: h.dispose,
    };
    admins.set(app, admin);
    return app;
  },
  signInEditor: (app) => login(app, "ed"),
  signInViewer: (app) => login(app, "viewer"),
  async editPage(app, cookie, { sourcePath, content }) {
    const admin = admins.get(app)!;
    const res = await app.request(`${admin.prefix}/pages/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ sourcePath, content }),
    });
    if (res.status !== 200) throw new Error(`stub edit failed: ${res.status}`);
  },
  async createPage(app, cookie, { sourcePath, title }) {
    const admin = admins.get(app)!;
    const res = await app.request(`${admin.prefix}/pages/create`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ sourcePath, title }),
    });
    if (res.status !== 200) {
      throw new Error(`stub create failed: ${res.status}`);
    }
  },
  async deletePage(app, cookie, { sourcePath }) {
    const admin = admins.get(app)!;
    const res = await app.request(`${admin.prefix}/pages/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ sourcePath }),
    });
    if (res.status !== 200) {
      throw new Error(`stub delete failed: ${res.status}`);
    }
  },
});
