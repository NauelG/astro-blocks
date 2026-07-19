<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Migrate to Astro 7

All of it verified by building on a probe worktree with `astro@7.1.1` + `@astrojs/node@11`.

## 1. The cache read (`src/plugin/index.ts:527`)

Before:

```ts
const cacheProvider = (config as { experimental?: { cache?: { provider?: unknown } } })
  .experimental?.cache?.provider;
```

After:

```ts
const cacheProvider = (config as { cache?: { provider?: unknown } }).cache?.provider;
```

No `??` fallback to the experimental path: `peerDependencies` is `^7.0.0`, so `experimental.cache`
cannot be reached by a supported consumer, and a dead branch that looks like support is worse than
none (`AGENTS.md` *Compatibilidad*).

The warning at `:629` changes text only — `experimental.cache.provider` → `cache.provider`. It stays
a warning: the integration still does **not** configure the provider, the consumer does.

Nothing else in the codebase touches the cache config. The runtime invalidation path
(`src/api/backup.ts`, `context.cache.invalidate({ path, tags })`) is unchanged in Astro 7 and is not
edited.

## 2. Version contract (`package.json`)

```jsonc
"peerDependencies": { "astro": "^7.0.0" },   // was ^6.0.0
"engines": { "node": ">=22.12.0" }           // was >=18.0.0 — copied from astro@7's engines
```

`>=22.12.0`, not `>=22.0.0`: on Node 22.0–22.11 Astro 7 refuses to start, so a rounder floor would
declare support that does not exist.

Dev dependencies move with it: `astro@^7.1.1`, `@astrojs/node@^11.0.2` (#91, #93).

## 3. Playground (`playgrounds/basic/`)

`astro.config.mjs` — `cache` moves out of `experimental`; the `memoryCache` import is unchanged:

```js
// before                     // after
experimental: {               cache: {
  cache: {                      provider: memoryCache(),
    provider: memoryCache(),  },
  },
},
```

`package.json` — pins its own copies, which the root bump does not reach:

```jsonc
"astro": "^7.0.0",           // was ^6.0.5
"@astrojs/node": "^11.0.0"   // was ^10.0.5
```

`src/components/ContentList.astro:26,37` — the literal `<string>` / `<object>` in body text are read
by the Rust compiler as unclosed JSX tags. Escape to `&lt;string&gt;` / `&lt;object&gt;`. The markup
was always invalid; only the new compiler says so.

## 4. Consumer surface

**`README.md`** — four `experimental.cache` samples (`:172`, `:365-371`, `:573`, `:688`) move to the
top-level shape. The Node badge (`:22`) and the requirements table (`:115`) go to 22.12+. Two
additions:

- A **compatibility table**, the mechanism Astro's own adapter docs use, and the answer to "which
  astro-blocks do I use?" without spending a major on it (ADR-0029):

  | AstroBlocks | Astro | Node |
  | --- | --- | --- |
  | `4.x` | 7.x | ≥ 22.12 |
  | `3.x` | 6.x | ≥ 18 |

- A short **migration note** for 3.x → 4.x: move `cache` / `routeRules` out of `experimental`, raise
  Node, and a heads-up that Astro 7's Rust compiler rejects invalid HTML **in the consumer's own
  templates**. That last one will bite people, and without the note it reads as our regression.

**`AGENTS.consumer.md`** — *Node.js version requirement* → 22.12; *Required Astro version
(peerDependency)* → Astro 7.0+. Release is blocked while these disagree with `package.json`.

## 5. What is deliberately not touched

- **`src/**/*.astro`** — all 21 shipped templates compile clean on the Rust compiler. Verified by
  building, not by grep. No speculative escaping.
- **TypeScript 7 (#92)** — an unrelated major, out of scope.
- **CI Node version** — already `22` in both workflows.
- **`context.cache` runtime usage** — unchanged API.

## 6. Verification

The unit suite cannot see this change: it never compiles a `.astro` template, which is exactly why
the defect was invisible. The meaningful gates are the playground build and e2e.

1. `npm run build && npm test && npm run typecheck` — regression floor, must stay green.
2. `npm run build:playground` — **the gate that matters**; it compiles the 21 shipped templates plus
   the playground's own.
3. `npm run test:e2e` — the only gate that drives the admin in a browser against Astro 7. Not run
   during the probe; the first full run happens here.
4. `npm run features:validate`.
5. Manual: `npm run dev:playground`, load `/cms`, confirm the admin renders and that no
   `[astro-blocks] ... requires Astro cache.provider` warning appears with the provider configured.
