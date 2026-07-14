<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Bake the schema map, and make its absence impossible to ignore

- **Trigger:** issue #101, raised by the ADR-0009 compliance pass. `generateRuntime()` emits two
  gitignored artifacts; only one of them is baked into the bundle.
- **Follow-ups deliberately left out:** #96 (fire-and-forget variant job), #81 (the `node --test`
  seam for baked env values in general — this change works around it for the schema map only,
  it does not solve it).

## The gap

ADR-0009 exists because a single resolution strategy for a generated runtime artifact breaks in
deployment. `.astro-blocks/` is a **gitignored build artifact**, routinely absent on a deployed
server. The decision: Astro pages resolve through the `astro-blocks-runtime` Vite alias; the
precompiled API route reads a value **baked** into `import.meta.env` at config time, with the
filesystem read demoted to a dev/legacy fallback. And explicitly: no swallowing `try/catch` that
hides a resolution failure.

`generateRuntime()` emits **two** artifacts (`src/plugin/index.ts:317-322`):

| Artifact | Baked into `vite.define`? | Resolution at request time |
|---|---|---|
| `.astro-blocks/runtime.mjs` (global-blocks registry) | **Yes** — `src/plugin/index.ts:598` | Baked-first, disk fallback (`src/api/route-table.ts:45-69`) ✅ |
| `.astro-blocks/schema-map.mjs` | **No** | **Disk only, behind a swallowing catch** (`src/api/handlers/schema-loading.ts:19-33`) ❌ |

The schema map got only the fragile half. `loadSchemaMap()` does a filesystem-only dynamic import
rooted at `getProjectRoot()` and ends in:

```ts
catch { return { error: 'Failed to load block schemas', missing: [] } }
```

This is the exact deployment failure mode ADR-0009 was written to eliminate — reproduced one layer
over, for the schema map instead of the registry.

## Why this has not been caught

Three independent guards should have caught it. Each one is neutralised.

**1. The e2e harness compensates for the bug.** `e2e/global-setup.ts:1-9` copies `.astro-blocks/`
(`schema-map.mjs`, `runtime.mjs`) from the playground build into `.e2e-data/` — in its own words,
*"so the standalone server can find block schemas"*. In a real deployment nobody performs that copy.
The suite is green **because the harness hand-carries the artifact the code cannot find.**

**2. The test suite codifies the symptom as the specification.**
`tests/pages-handlers.test.js:54` asserts `handleGetBlockSchemas returns 500 when schema-map.mjs is
missing`. The bug's behaviour is written down as expected.

**3. The mental model names only one artifact.** `docs/CONTEXT.md:35` draws a single generated file
(`runtime.mjs`). `schema-map.mjs` appears nowhere in `CONTEXT.md`. Worse, `docs/CONTEXT.md:40-41`
states that the precompiled API route *"reads BAKED `import.meta.env` (or filesystem fallback in
dev)"* — true of the registry, **false of the schema map**. The documentation asserts the correct
behaviour that the code does not implement.

The schema map was never given a name in the domain vocabulary. An unnamed concept is a concept
nobody guards.

## What is actually broken, measured

Verified empirically, not assumed:

- **The bake reaches the precompiled catchall in `astro build`** — zero unsubstituted
  `import.meta.env.ASTRO_BLOCKS_*` occurrences in `dist/server/`, baked values present.
- **The bake reaches it in `astro dev` too** — a temporary module-scope probe in `route-table.ts`
  printed `baked-registry-type=string len=259` on the first request to the dev server. The dev
  fallback is a belt, not the mechanism.
- **Cost of baking the schema map:** 1812 bytes for the playground's 7 blocks (~260 B/block).
  A 50-block project bakes ~13 KB. Not a consideration.

### Blast radius

`loadSchemaMap()` has **8 handler call sites**. They split cleanly:

| Call site | Handler | Honours the error? |
|---|---|---|
| `pages.ts:165` | `handleGetBlockSchemas` | Yes — explicit 500 |
| `pages.ts:184` | `handlePostPages` | Yes — via `ensureValidBlocks` (`:178`) |
| `pages.ts:253` | `handlePutPage` | Yes — via `ensureValidBlocks` (`:247`) |
| `global-blocks.ts:114` | `handleUpdateGlobalBlock` | Yes — explicit 500 |
| `pages.ts:151` | `handleGetPages` | **No** |
| `global-blocks.ts:25` | `handleGetGlobalBlocks` | **No** |
| `global-blocks.ts:63` | `handleGetGlobalBlock` | **No** |
| `languages.ts:142` | `handleDeleteLanguage` | **No** |

So when the schema map cannot resolve: **writes fail loudly (500); reads degrade silently (200).**

The four lax call sites pass `schemaResult.schemaMap || null` onward. Nothing in the type stops
them: the return shape is `{ schemaMap?: SchemaMap; error?: string; missing?: string[] }` — both
fields optional, the error purely advisory.

**The swallowing catch is the symptom. The type that permits ignoring the failure is the disease.**

### What the silent degradation actually costs — and what it does not

Two hypotheses were checked against the code and **both were wrong**; recording them so they are not
re-raised:

- **Page save does not corrupt data.** `ensureValidBlocks` runs *before* the merge in both
  `handlePostPages` (`pages.ts:178`) and `handlePutPage` (`:247`) and returns 500. The destructive
  path through `mergeBlockPropsForLocale` — which with a null schema map would flatten a localized
  map into a scalar — **is not reachable**.
- **Deleting a language does not corrupt pages.** `removeLocaleFromPage`
  (`src/utils/locale-projection.ts:118-127`) computes `shouldLocalize` as
  `isSchemaPropLocalizable(def) || isLocalizedMapValue(value, localeKeys)`. With `def` undefined the
  **value shape** rescues it. That function is schema-independent in practice.

The real silent cost is a single one: in `projectBlockProps`
(`src/utils/locale-projection.ts:14-45`) every `def` is `undefined`, so `def?.type === 'image'` never
matches and **`toImageValue()` never runs**. Image props leak to the admin in their raw legacy shape
instead of an `ImageFieldValue`.

Small — but it is the visible tip of a state in which the admin *reads* and cannot *write*. An admin
that renders a page list it will 500 on saving is a trap, not a degradation.

## Proposed change

1. **Bake the schema map.** `generateRuntime()` returns the computed `schemaMap` alongside the
   registry; the plugin bakes it into `import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP` next to the
   registry, using the same double-encode (`src/plugin/index.ts:598`).

2. **`loadSchemaMap()` resolves baked-first, disk-second** — an exact mirror of
   `loadGlobalBlocksRegistry` (`src/api/route-table.ts:45-69`). `schema-map.mjs` survives, demoted to
   what it actually is: the dev/test seam. It is not gratuitous duplication — `runtime.mjs` imports
   real `.astro` components and therefore **cannot be imported from plain Node**, which is why the
   pure-data twin exists and why four test files seed it.

3. **The failure becomes unignorable in the type.** `loadSchemaMap()` returns a discriminated union:
   `{ ok: true; schemaMap } | { ok: false; reason; missing? }`. The compiler forces every call site
   to branch. This is the repo's own idiom — `route-table.ts:12-15` documents `defineRoute<A>`
   existing so that *"the handler's `RouteContext<A>.user` nullability is checked against its
   declared `auth` literal at compile time"*. Authorization was not left to each handler
   remembering. Neither is this.

4. **All 8 call sites fail loudly**, reusing the existing `errors.schemaLoadFailed` i18n key. A
   project with zero blocks bakes `"{}"` → `ok: true` with an empty map, so `ok: false` can only ever
   mean *unresolvable*. There is no legitimate-empty ambiguity to trade against.

5. **`route-table.ts:66-69`'s `catch { return [] }` goes too.** It silently defaults to an empty
   registry — the original symptom ADR-0009 set out to kill, still alive in the fallback three lines
   from the fix.

6. **Delete the `e2e/global-setup.ts` copy.** With the bake in place, `.astro-blocks/` is not needed
   at runtime by anything: the only two runtime readers are `route-table.ts:60` and
   `schema-loading.ts:19`, and both will be baked-first. Removing the copy turns the e2e suite into
   the proof — a green run then demonstrates the schema map resolving on a standalone server where
   the artifact **does not exist**.

7. **Name the schema map** in `docs/CONTEXT.md` — glossary entry and mental-model diagram — with its
   two resolution regimes. See the spec delta.

## Alternatives considered

- **Bake and delete `schema-map.mjs` entirely (single resolution strategy).** Now technically viable,
  since the bake was measured present in dev. Rejected: it forces a redesign of the test seam in four
  files — `import.meta.env` cannot be injected at `node --test` runtime (#81) — and buys **zero**
  runtime benefit over baked-first, because the bake is already the primary path in dev and build
  alike.
- **Log the error and keep the return shape.** Rejected: it fixes the diagnosability of the catch
  while leaving the four lax call sites free to keep degrading silently. It treats the symptom.
- **Throw on unresolvable.** Rejected: it destroys the localized-error contract
  (`localizedJsonError`) at every call site and scatters `try/catch` through the handlers.
- **Memoize `loadSchemaMap()`.** Rejected as out of scope. It is a ~2 KB `JSON.parse` next to the JSON
  file I/O every handler already does, and memoizing would add a `reset()` for the tests — new
  surface for an unmeasured gain. `loadGlobalBlocksRegistry` does not memoize either.

## Decision that needs an ADR

Failing hard on **read** paths is a real trade-off taken deliberately: a resolution failure turns the
pages screen into an error instead of a list with broken images. ADR-0009's no-swallow rule is scoped
explicitly to *"the Astro-page side"*; extending it to the API side, uniformly including reads, and
enforcing it through the type system is a new decision. → **ADR-0025**.
