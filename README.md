# @dune/testing

Test harness for [Dune CMS](https://getdune.org) plugins and themes.

Provides `createTestHarness()` — spins up a full in-process Dune instance backed
by an in-memory storage adapter. No filesystem access, no running server.
Plugins participate in the complete hook chain exactly as in production.

## Installation

```ts
import { createTestHarness } from "jsr:@dune/testing";
```

## Usage

```ts
import { createTestHarness } from "@dune/testing";
import { assertEquals } from "@std/assert";
import myPlugin from "./src/plugin.ts";

Deno.test("plugin registers a search engine", async () => {
  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Home\n---\nHello world",
      "02.blog/blog.md": "---\ntitle: Blog\ntemplate: listing\n---\n",
    },
    plugins: [myPlugin({ apiKey: "test" })],
  });

  try {
    const results = await h.search.search("hello");
    assertEquals(results[0].page.route, "/home");

    const res = await h.fetch("/api/pages");
    assertEquals(res.status, 200);
  } finally {
    await h.dispose();
  }
});
```

## API

### `createTestHarness(options?)`

Returns a `TestHarness` with:

| Member                | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `engine`              | The bootstrapped `DuneEngine` — inspect `engine.pages` for indexed content |
| `search`              | The active `SearchManager` — call `search(q)` and `suggest(p)` directly    |
| `hooks`               | The `HookRegistry` — inspect or subscribe to plugin events                 |
| `config`              | The resolved `DuneConfig`                                                  |
| `storage`             | The `MemoryStorageAdapter` pre-populated with fixture files                |
| `fetch(path, init?)`  | Send an in-process HTTP request to the content REST API                    |
| `render(path, init?)` | `fetch` shorthand returning response body as text                          |
| `rebuild()`           | Trigger a full content rebuild and search index update                     |
| `dispose()`           | Tear down the harness — safe to call multiple times                        |

### `createAppHarness(options?)`

`createTestHarness()` reaches only the read-only content API.
`createAppHarness()` also builds the app `dune serve` builds, so a plugin's
`mount()` routes, the response-transform pipeline and the inline-edit WebSocket
route are all reachable in process. Same options as `createTestHarness()`; the
result adds `request(path, init?)`, which goes through the whole app.

```ts
const h = await createAppHarness({ content, plugins: [myPlugin()] });
const res = await h.request("/about/");
```

Folder pages are served at their canonical path with a trailing slash
(`/about/`); `/about` answers 301.

### `createStubAdmin(options?)`

A minimal replacement admin, built only on the services, capabilities and mount
API core hands every plugin (it imports nothing from `@dune/plugin-admin`). It
keeps users and sessions through `services.users` and `services.sessions`,
provides the `auth.session` and `scheduler.executor` capabilities, seeds authz
tuples through `services.authz`, and offers its own `POST /stub-admin/login`,
`GET /stub-admin/pages` and `POST /stub-admin/pages/edit` (which, as the writer,
fires `onPageUpdate`). Use it to check that your plugin works with an admin that
is not the built-in one, or to build a conformance test for an admin of your
own. `declareCookie: false` makes it a provider that does not say which cookie
carries its session.

```ts
const admin = createStubAdmin({ users: [{ username: "ed", password: "pw" }] });
const h = await createAppHarness({
  content,
  plugins: [admin.plugin, myPlugin()],
});
```

### `runAdminConformance(driver)`

What "meets the contract" means for an admin. Dune does not depend on
`@dune/plugin-admin`: any plugin that provides the `auth.session` capability is
the admin as far as core is concerned. Give the suite a driver (how to build an
app with your admin, how to sign an editor in) and it registers these tests:

- the admin provides `auth.session` (exactly one provider, active);
- the public site serves, and anonymous visitors are not admins;
- core's response pipeline recognises an editor session and **only** a real one:
  no cookie, an unrelated cookie and a forged session cookie get no auth and
  have editing markers scrubbed; the editor gets `pages.update` and keeps the
  markers;
- the cookie the admin declares in `sessionCookies` is the cookie its sign-in
  sets (otherwise core would never consult it, and its pages could enter the
  shared cache);
- an account without editing rights gets no editing chrome (`signInViewer`);
- a route in a plugin mounted before the admin can still tell who the admin is
  through `auth.session`;
- editing a page through the admin writes it and fires `onPageUpdate` exactly
  once (`editPage`);
- `admin.pages` and `admin.routes` contributed by another plugin are mounted
  behind the login, the CSRF check and the permission (`adminPrefix`);
- with no admin at all the site serves and nothing admin-related exists.

```ts
runAdminConformance({
  name: "my-admin",
  async createApp({ content, extraPlugins, withAdmin }) {
    /* build the app; register extraPlugins BEFORE your admin */
  },
  signInEditor: async (app) => "my_session=abc123", // the Cookie header value of an editor
});
```

The optional hooks (`signInViewer`, `editPage`, `adminPrefix`) enable the checks
that need them. `adminConformanceChecks(driver)` returns the checks without
registering them, which is how the package tests that the suite rejects a broken
admin. The stub admin (`createStubAdmin()`) is the reference run.

### Options

| Option         | Default            | Description                                                          |
| -------------- | ------------------ | -------------------------------------------------------------------- |
| `content`      | `{}`               | Fixture content keyed by path relative to `content/`                 |
| `files`        | `{}`               | Extra files at arbitrary paths (config overrides, flex data, etc.)   |
| `plugins`      | `[]`               | Plugin instances to register before bootstrap                        |
| `siteTitle`    | `"Dune Test Site"` | Site title override                                                  |
| `disableAdmin` | `true`             | Disable the admin plugin (heavy; skip unless testing admin behavior) |

## License

MIT
