<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0010 — SSR adapter required via config-time guard, not peerDependency

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-07-06
- **Source:** engram observations #1950, #1949

## Context

astro-blocks injects several `prerender = false` routes into the consumer's Astro project (admin pages, `/cms/api/[...path]`, uploads, sitemap, robots). All of these render on demand, which requires an SSR adapter to be configured — but nothing in the integration enforced that requirement, so a consumer who forgot (or never knew) to configure an adapter got a cryptic Astro build error instead of a clear, actionable one from astro-blocks itself.

The non-obvious part is *how* to enforce it. The integration is deliberately adapter-agnostic — it must work with `@astrojs/node`, `@astrojs/vercel`, `@astrojs/netlify`, `@astrojs/cloudflare`, or any future adapter — and `peerDependencies` cannot express "any one of N packages," so declaring `@astrojs/node` as a peer dependency would over-constrain every consumer not on Node (breaking Vercel/Cloudflare users) rather than actually solving the problem. The other subtlety is *when* to check: `config.adapter` is not reliably populated during `astro:config:setup`, because another integration could inject an adapter dynamically via `updateConfig` during its own `config:setup`, and integration execution order isn't guaranteed — checking too early risks a false negative. The resolved config is only guaranteed complete by `astro:config:done`, but that hook doesn't expose `command`, which the guard needs to decide throw-vs-warn.

## Decision

We will enforce the adapter requirement with a config-time guard, not a peer dependency:

- `assertAdapterConfigured(command, adapter)` (`plugin/index.ts`) throws if no adapter is configured **and** `command === 'build'`; for `dev`/`preview`/`sync` it only warns, so local development (which doesn't need an adapter for on-demand rendering) keeps working.
- This guard runs from the `astro:config:done` hook (not `config:setup`), so it inspects the final, fully-resolved config regardless of integration ordering.
- Since `config:done` doesn't expose `command`, `astroCommand` is captured into a closure variable during `config:setup` and read back inside `config:done`. Each `astroBlocks()` call produces a fresh closure, so a dev-server restart (which re-imports the config) can't leave a stale command value behind.
- `@astrojs/node` remains a playground-only dependency (`playgrounds/basic/package.json`), never added to the published package's `peerDependencies`.

## Consequences

- Easier: consumers who forget an adapter get an immediate, specific error at build time ("[astro-blocks] No SSR adapter is configured... Add one via the `adapter` option in astro.config.") instead of a generic Astro failure; the integration stays usable with any current or future adapter.
- Harder / watch for: this guard is now a second config-time invariant check alongside the existing `options.blocks` validation in `astro:config:setup` — future contributors adding new required-config checks should be conscious of which hook (`config:setup` vs `config:done`) actually has the data they need, since this is an easy mistake to repeat (it's exactly the mistake this ADR's fix corrects).
- The guard is independent of the still-pending Astro 7 migration and works today on Astro 6; it does not decide or depend on the separate `peerDependencies` version-range question (dual-major vs. major bump), which remains an open, unrelated decision tied to the experimental-cache API surface.

## Evidence (current repo)

- `plugin/index.ts:284-300` (`assertAdapterConfigured`) — exported function; throws only when `command === 'build'` and `adapter` is falsy, otherwise warns.
- `plugin/index.ts:304, 310` — `astroCommand` closure variable declared per-integration-instance, assigned from `command` inside `astro:config:setup`.
- `plugin/index.ts:470-471` — the `astro:config:done` hook calls `assertAdapterConfigured(astroCommand, config.adapter)`.
- `tests/plugin-adapter-guard.test.js` — exists, covering the guard's throw/warn behavior.
- `package.json` — `peerDependencies` is `{ "astro": "^6.0.0" }` only; no `@astrojs/node` (or any adapter) entry.
- `playgrounds/basic/package.json:10` — `@astrojs/node` is a playground-only dependency, confirming it is not published as part of the package's own dependency surface.
