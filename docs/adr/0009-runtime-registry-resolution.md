<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0009 — Runtime registry resolution for injected & precompiled routes

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-04-21
- **Source:** engram observations #139, #1907

> **Compliance note (2026-07-14, updated).** Verified against the code, then **closed**.
>
> The first pass found the decision fully implemented for the **global-blocks registry** (Vite alias for
> pages, `import.meta.env` bake for the precompiled API route) but only half-implemented for the **schema
> map**: `generateRuntime()` emits `schema-map.mjs` too, yet it was never baked — resolved from disk
> alone, behind a swallowing `catch`. That was the exact deployment failure mode this ADR exists to
> eliminate, reproduced one layer over, and it broke page-save validation and the admin block picker on
> every deployed server. Tracked as **#101**.
>
> **#101 is now fixed.** The schema map is baked (`ASTRO_BLOCKS_SCHEMA_MAP`) and resolves baked-first.
> Both swallowing catches are gone, including `loadGlobalBlocksRegistry`'s `catch { return [] }` — the
> original symptom, which had survived inside this ADR's own fallback path.
>
> Two things this ADR did **not** settle were decided in **ADR-0025**: what an API handler does when
> resolution fails anyway (a 500 on every path, reads included — no degraded projections), and how that
> is enforced (a discriminated union, so the type checker rejects any call site that ignores the
> failure). This ADR's Decisión is unchanged.
>
> One consequence worth carrying: the e2e suite used to copy `.astro-blocks/` next to the standalone
> server "so the standalone server can find block schemas". That copy was the defect wearing test
> scaffolding — it is why this class of bug stayed invisible in a green suite. **It has been removed and
> must not come back.**

## Context

astro-blocks is an npm package that both injects Astro pages/components into the consumer's build AND ships a precompiled API route (the CMS catchall). Both need to read the consumer-project-specific generated file `.astro-blocks/runtime.mjs` (component map, schema map, global-blocks registry) — but they run under two different resolution regimes, and conflating them is the recurring bug source.

The non-obvious part: `import.meta.url` for an injected Astro page/component resolves to that file's location *inside the installed package* (e.g. under `node_modules/@astroblocks/astro-blocks/...`), not the consumer project root. A relative path or `new URL(..., import.meta.url)` from inside the package therefore can never reach the consumer's generated runtime file — it silently resolves to a path that doesn't exist. This caused a real bug: an admin page's dynamic import via `import.meta.url` failed, was swallowed by a `try/catch`, and defaulted to an empty array, so declared global blocks silently disappeared from the admin UI. Separately, the precompiled API route has the opposite failure mode: `.astro-blocks/` is a gitignored build artifact that is frequently *absent* on deployed servers, so a filesystem read rooted at `process.cwd()`/`ASTRO_BLOCKS_PROJECT_ROOT` throws in production even though the same registry works fine for rendering (which uses the bundled alias) — causing global-block admin GET/PUT/DELETE to 404 while rendering that same block worked.

## Decision

We will resolve the runtime registry differently depending on which side of the build boundary the consumer is on, and never let one side's resolution strategy leak into the other:

- **Astro pages/components** (built as part of the consumer's Vite build) import from the `astro-blocks-runtime` Vite alias, which the plugin registers in `addVite`/`vite.resolve.alias` (`plugin/index.ts`) pointing at the consumer's `.astro-blocks/runtime.mjs`. This is the only way these modules read component maps, schema maps, or the global-blocks registry — never a relative path, never `new URL(..., import.meta.url)`.
- **The precompiled API route** cannot use that alias (it ships as injected/precompiled code, not part of the consumer's Vite graph). For the global-blocks registry specifically, it instead reads a value baked at build time into `import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY` via `vite.define` (the plugin JSON-stringifies the registry twice, mirroring the existing cache-config baking pattern), falling back to a legacy filesystem read of `.astro-blocks/runtime.mjs` only for dev/legacy cases where the bake isn't present.
- We will not hide import/resolution failures behind a swallowing `try/catch` on the Astro-page side; if the alias isn't present, the build/runtime should fail loudly rather than silently defaulting to an empty registry.

## Consequences

- Easier: there is now exactly one correct pattern per side of the build boundary, which is enumerable and testable (alias for pages/components, baked env value + fallback for the precompiled API route). New injected routes/components have a clear rule to follow.
- Harder / watch for: the two resolution strategies must be kept in sync whenever the registry shape changes — a change to `generateRuntime()`'s output must be reflected in both the alias-based module the plugin generates AND the `vite.define` bake, or the two sides can silently diverge again. Also, the fallback filesystem read (dev/legacy path) is still coupled to `.astro-blocks/` existing on disk; it is not a substitute for the primary baked-value path in deployed environments.
- The e2e test that proves this (opening/editing a global block whose registry-serving path failed before the fix) is a useful guard to keep, since this class of bug does not surface in unit tests or in local dev where `.astro-blocks/` typically exists.

## Evidence (current repo)

- `routes/page.astro:13` and `components/GlobalBlock.astro:11` — both statically import `componentMap`, `globalBlocksRegistry`/`schemaMap` from `'astro-blocks-runtime'` (the alias), not a relative path.
- `plugin/index.ts:368` — registers `alias['astro-blocks-runtime'] = path.join(projectRoot, '.astro-blocks', 'runtime.mjs')`.
- `plugin/index.ts:355, 417-418` — computes `globalBlocksRegistry` via `generateRuntime()` and bakes it into `vite.define['import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY']` as a double-JSON-stringified value.
- `plugin/index.ts:185` — comment explicitly documents that the precompiled API route (`catchall.js`) cannot import the `astro-blocks-runtime` alias, which is why the baked env value exists.
- `api/route-table.ts:34-69` (`loadGlobalBlocksRegistry`) — reads `import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY` first, JSON-parses it, and only falls back to a filesystem read of `.astro-blocks/runtime.mjs` (rooted at `ASTRO_BLOCKS_PROJECT_ROOT || process.cwd()`) if the baked value is absent or malformed — matching the decision exactly.

> Reviewer note: the source memories (obs #139, #1907) and this task's own verification pointer both describe the registry-loading fallback logic as living in `routes/api/catchall.ts`. It no longer does. Since those memories were recorded, `routes/api/catchall.ts` was rewritten into a thin `dispatch()` shim (route-table-auth-gating refactor, see its header comment referencing "ADR-5"), and the `loadGlobalBlocksRegistry` function — baked-env-first, filesystem-fallback-second, exactly as described in the source — was moved to `api/route-table.ts` (see its own comment: "moved here from `routes/api/catchall.ts` — only the 3 global-block adapters below consume it"). The decision and mechanism verified above are unchanged; only the file path is stale.
