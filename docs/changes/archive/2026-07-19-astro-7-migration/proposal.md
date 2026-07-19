<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Migrate to Astro 7

_Resolves [#55](https://github.com/NauelG/astro-blocks/issues/55) (P1). Unblocks Dependabot
[#91](https://github.com/NauelG/astro-blocks/pull/91) (astro 7.1.1) and
[#93](https://github.com/NauelG/astro-blocks/pull/93) (`@astrojs/node` 11.0.2). Grilled 2026-07-19._

## Problem

`peerDependencies` declares `astro: ^6.0.0`. Astro 7 has been out for months, two Dependabot majors
are blocked behind it, and a consumer already on Astro 7 has no compatible version of this
integration.

## What the issue got wrong

The issue frames the cache API as the hard part — *"find the Astro 7 equivalent (graduated/renamed/
removed) and migrate all three, **or drop the cache integration if Astro 7 removed the capability
outright**"*. Verified against the upgrade guide and the 7.0.0 release, and confirmed by building:

**Nothing was removed. Route caching graduated out of experimental.** `experimental.cache` became
top-level `cache`, `experimental.routeRules` became `routeRules`, `memoryCache()` still ships, and
the runtime API (`context.cache.invalidate({ path, tags })`) is unchanged. The integration reads the
provider in exactly **one** place, to emit a warning:

```ts
// src/plugin/index.ts:527 — the only use; feeds the console.warn at :629
const cacheProvider = (config as { experimental?: { cache?: { provider?: unknown } } })
  .experimental?.cache?.provider;
```

The cache migration is **one line** plus the warning text. The "drop the capability" branch is moot.

## What the issue missed

Probed on a throwaway worktree with `astro@7.1.1` + `@astrojs/node@11` installed:

| Gate | Result |
| --- | --- |
| `npm run build` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass — 1285/1285 |
| `npm run build:playground` | **fail**, then pass after the fixes below |

**1. Astro 7 replaces the Go compiler with a Rust one that rejects invalid HTML.** The playground
build died on:

```astro
<p>Tags (array<string>)</p>   <!-- <string> parses as an unclosed JSX tag -->
```

This is not an Astro bug. The markup was always invalid; the old compiler tolerated it. Two lines in
`playgrounds/basic/src/components/ContentList.astro`. **The 21 shipped `.astro` templates are clean**
— verified by compiling them, not by grepping.

Worth recording *why* this was invisible: `build`, `typecheck` and all 1285 tests passed **with the
defect present**, because none of them compile `.astro` templates. Only the playground does. Green
was the absence of a check, not the presence of coverage.

**2. `playgrounds/basic/package.json` pins its own `astro: ^6.0.5` and `@astrojs/node: ^10.0.5`.**
Bumping the root leaves the playground on Astro 6.

**3. Astro 7 requires Node `>=22.12.0`; we declare `>=18.0.0`.** This is the largest consumer-facing
break in the change and the issue does not mention it. `>=18` is claimed in four places:
`package.json` `engines`, the README badge (`:22`), the README requirements table (`:115`), and
`AGENTS.consumer.md`. CI already runs Node 22, so no pipeline change is needed.

## Proposed change

1. **`peerDependencies: { astro: "^7.0.0" }`** — Astro 7 only, no dual support. Per `AGENTS.md`
   *Compatibilidad*: breaking changes ship without fallback or migration shims. The plugin reads
   `config.cache.provider` and the README teaches one configuration.
2. **`engines: { node: ">=22.12.0" }`** — copied from Astro 7 exactly, not rounded to `>=22.0.0`.
   Claiming a Node where our peer dependency refuses to start is the same class of false guarantee
   the `restore-session-revocation` review just removed from the session spec.
3. **Cache wiring** — one line in the plugin, the warning text, the playground config.
4. **Playground** — bump its own deps, escape the two invalid-HTML lines.
5. **Consumer surface** — README compatibility table + a short migration note; `AGENTS.consumer.md`
   Node and Astro prerequisites updated (release is blocked otherwise).
6. **Land #91 and #93 together.** `@astrojs/node` is dev/playground-only and does not affect
   consumers, but its peer requires `astro ^7`, so neither can merge alone.
7. **Release `4.0.0`** — a `major`: the peer requirement and the Node floor both break consumers.

## Alternatives considered

- **Widen to `^6.0.0 || ^7.0.0` (minor)** — rejected. Technically near-free (`config.cache?.provider
  ?? config.experimental?.cache?.provider` is one expression, since the plugin only reads the value
  for a warning), but it contradicts the no-fallback policy, forces the README to teach two
  configurations selected by Astro version, and leaves one of the two branches untested by e2e. The
  Node floor makes it worse: `^6` consumers on Node 18 would install a package whose `engines`
  excludes them.
- **Align our major with Astro's (ship `7.0.0`)** — rejected; see ADR-0029. Astro's own first-party
  adapters are the counter-evidence: for Astro 7 they are `@astrojs/node@11`, `@astrojs/vercel@11`
  and `@astrojs/cloudflare@14` — not aligned with Astro, and not with each other.
- **Defer and bundle the major with #116 / #40** — rejected. Astro 7 has shipped; consumers who
  migrated have no compatible integration today, and the two refactors are not ready.
- **Include TypeScript 7 ([#92](https://github.com/NauelG/astro-blocks/pull/92))** — rejected.
  An unrelated major. Bundling them makes it impossible to attribute a failure to either.

## Risk left open

The **Playwright e2e was not run** during the probe. It is the only gate that exercises the admin in
a browser against Astro 7, and the compiler failure surfaced only when templates were compiled — so
this is where a further surprise would appear. It runs on CI for the PR.
