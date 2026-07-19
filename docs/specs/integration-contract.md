<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Integration contract

Living specification. Describes what the integration requires of its host project and what it
promises in return. Inaugurated by change `astro-7-migration` (2026-07-19, #55, ADR-0029).

## Capability

AstroBlocks is an Astro integration. It declares the Astro and Node versions it supports, and it
reads — but never configures — the host's route-cache provider.

## Requirements

**R1 — One Astro major at a time.** `peerDependencies.astro` names exactly one major (`^7.0.0`),
never a union. It is the **single machine-checked** statement of the coupling; the integration's
own version number does not encode it (ADR-0029). Code reads only the current Astro's config
shape — there is no fallback branch for a previous major, so no unsupported version can appear
supported.

**R2 — The Node floor is copied, not chosen.** `engines.node` equals the supported Astro's
`engines.node` (`>=22.12.0` for Astro 7). Rounding it down would declare support for a Node on
which the peer dependency refuses to start.

**R3 — Requiring a new Astro major is a `major` here.** It breaks consumers — both the peer
requirement and, usually, the Node floor — so it earns a major on its own merits. It is never a
`minor`, and an Astro release that changes nothing for our surface never forces one (ADR-0029).

**R4 — The consumer wires the cache; the integration only reads it.** Route caching is configured
by the host at top-level `cache.provider` (Astro 7; it was `experimental.cache.provider` before
the feature graduated). The integration reads that value in one place, solely to warn when
`publicRendering: "server"` is combined with caching enabled and no provider configured. It never
installs a provider, never defaults one, and degrades to SSR-without-caching rather than failing
the build. Runtime invalidation goes through Astro's `context.cache.invalidate({ path, tags })`.

**R5 — An SSR adapter is mandatory and the failure is ours.** Unchanged from ADR-0010: a missing
adapter fails `astro build` fast with an actionable `[astro-blocks]` error rather than a cryptic
Astro one; under `astro dev` it warns.

**R6 — The compatibility mapping is published.** The README carries an AstroBlocks ↔ Astro ↔ Node
table, refreshed at each release. Because the version numbers deliberately do not align
(ADR-0029), this table is the only human-readable statement of the mapping.

**R7 — Coverage.** The unit suite does **not** exercise this contract: it never compiles a
`.astro` template. The gates that do are the playground build (which compiles every shipped
template) and the Playwright e2e (which drives the admin in a browser). A version-contract change
that passes only `build` / `typecheck` / `npm test` is **unverified** — during the Astro 7
migration all three passed with a template that did not compile.

## Boundaries & unchanged behaviour

- The integration never writes to the host's `astro.config.*`.
- `publicRendering: "static"` still requires an adapter, because admin routes are SSR regardless.
- Nothing here constrains the host's own templates — except that Astro 7's Rust compiler rejects
  invalid HTML, which is the host's markup to fix, not ours.
