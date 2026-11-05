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
