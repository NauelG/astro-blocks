<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0029 — The integration's version does not track Astro's

- **Status:** Accepted — 2026-07-19
- **Date:** 2026-07-19
- **Decisores:** Nauel Gómez
- **Source:** Issue [#55](https://github.com/NauelG/astro-blocks/issues/55), grilled 2026-07-19

## Contexto

AstroBlocks depends on Astro totally — it is an Astro integration, not a library that happens to run
inside one. Migrating to Astro 7 raised the question directly: should the integration's **major**
track Astro's, so `astro-blocks 7.x` means "the Astro 7 line"? Several ecosystems do exactly that,
and the coupling here is real enough that the idea is not obviously wrong.

Two facts decided it.

**The ecosystem's own answer.** Astro's first-party adapters, maintained by the core team, with a
coupling at least as total as ours:

| Package | Astro 5 | Astro 6 | Astro 7 |
| --- | --- | --- | --- |
| `@astrojs/node` | 9 | 10 | 11 |
| `@astrojs/vercel` | — | — | 11 |
| `@astrojs/cloudflare` | — | — | 14 |

They do not align with Astro, and they do not align with each other. Where alignment *is* the norm —
`@angular/*`, `@storybook/*`, `eslint-config-next` — the aligned packages are released together, by
one team, as one product. That is monorepo cohesion, not a downstream plugin tracking an upstream.

**What a major is for.** SemVer's major answers one question for a consumer: *will my code break if I
upgrade?* That question is about **our** contract. Spending majors on Astro releases leaves nothing
with which to signal our own breaking changes — and two are already queued
([#116](https://github.com/NauelG/astro-blocks/issues/116),
[#40](https://github.com/NauelG/astro-blocks/issues/40)). Under an aligned scheme they would have to
break the public API inside a `minor`, which is precisely the lie SemVer exists to prevent.

## Decisión

**The integration versions its own contract. The Astro coupling is expressed in
`peerDependencies`, and nowhere else.**

- `peerDependencies.astro` names the supported Astro majors and is the **single machine-checked**
  statement of the coupling. npm enforces it; a version number cannot.
- The integration's `major` is spent only on **our** breaking changes. Requiring a new Astro major is
  one such change — it breaks consumers — so it earns a major on its own merits, not by alignment.
- **One Astro major at a time.** `peerDependencies` names a single major (`^7.0.0`), never a union.
  Per `AGENTS.md` *Compatibilidad*, a breaking change ships without fallback: the code reads only the
  current Astro's shape, so no dead compatibility branch can pretend to be supported.
- `engines.node` is **copied from the supported Astro's `engines`**, not rounded. Declaring a Node on
  which our peer dependency refuses to start is a false guarantee.
- The consumer-facing mapping lives in a **README compatibility table**, refreshed at each release —
  the same mechanism Astro's adapter documentation uses.

## Consecuencias

- Version numbers stay informative: a `major` always means *our* surface changed. A consumer reading
  `3.8.0 → 4.0.0` learns something true, and `#116` / `#40` still have a way to be honest.
- The coupling is stated once, machine-checked. A duplicated encoding in the version number would
  drift silently the first time a patch shipped without touching `peerDependencies`.
- **Cost accepted:** the mapping is not inferable from the numbers. A consumer on Astro 7 cannot know
  they need `4.x` without reading the table or letting npm's peer check tell them. This is the price
  of the decision, and the table is the mitigation.
- Astro majors will keep producing majors here for as long as they carry breaking changes — which is
  correct, because they do break consumers. What is avoided is the reverse: a forced major on an
  Astro release that changes nothing for us.
- The numbers will diverge (AstroBlocks `4.x` ↔ Astro `7.x`) and are expected to keep diverging.
  Anyone reading a version pair as a mismatch should be sent here.
