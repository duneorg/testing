# @dune/testing

Test harness for [Dune CMS](https://getdune.org) plugins and themes.

Provides `createTestHarness()` — spins up a full in-process Dune instance backed by an in-memory storage adapter. No filesystem access, no running server. Plugins participate in the complete hook chain exactly as in production.

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

| Member | Description |
|--------|-------------|
| `engine` | The bootstrapped `DuneEngine` — inspect `engine.pages` for indexed content |
| `search` | The active `SearchManager` — call `search(q)` and `suggest(p)` directly |
| `hooks` | The `HookRegistry` — inspect or subscribe to plugin events |
| `config` | The resolved `DuneConfig` |
| `storage` | The `MemoryStorageAdapter` pre-populated with fixture files |
| `fetch(path, init?)` | Send an in-process HTTP request to the content REST API |
| `render(path, init?)` | `fetch` shorthand returning response body as text |
| `rebuild()` | Trigger a full content rebuild and search index update |
| `dispose()` | Tear down the harness — safe to call multiple times |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `content` | `{}` | Fixture content keyed by path relative to `content/` |
| `files` | `{}` | Extra files at arbitrary paths (config overrides, flex data, etc.) |
| `plugins` | `[]` | Plugin instances to register before bootstrap |
| `siteTitle` | `"Dune Test Site"` | Site title override |
| `disableAdmin` | `true` | Disable the admin plugin (heavy; skip unless testing admin behavior) |

## License

MIT
