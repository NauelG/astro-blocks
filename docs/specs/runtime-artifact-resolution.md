<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Runtime artifact resolution

> Living specification. Describes how the two generated `.astro-blocks/` artifacts reach the code
> that needs them, on each side of the build boundary, and what happens when they cannot.
> Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`).
> History: inaugurated by change `bake-schema-map` (#101). See ADR-0009 and ADR-0025.

## Capability

The plugin generates two artifacts into the consumer's **gitignored** `.astro-blocks/` directory.
Both must be readable at request time by code that runs on **either side of the build boundary** —
and the two sides cannot use the same mechanism. This spec governs which artifact each side reads,
and what the system does when it cannot read one.

The stakes are not theoretical. Getting this wrong has shipped twice: global-block admin routes 404'd
in production (ADR-0009), and then block schemas failed to resolve there too (#101), each time while
public rendering kept working — so the failure looked like an admin bug rather than a build one.

---

## Requirements

- **R1 — Two artifacts, one computation.** `generateRuntime()` computes the block/global-block entries
  and the schema map **once**, and emits:
  - `runtime.mjs` — component map, schema map, global-blocks registry. It **imports the consumer's
    real `.astro` components**, so it loads **only** inside a Vite graph.
  - `schema-map.mjs` — the schema map alone, as **pure data**, therefore loadable from plain Node.
    That is the only reason this second file exists.

  The two never diverge, because they are two emissions of the same computed value.

- **R2 — Two resolution regimes, one per side of the build boundary.**
  - **Astro pages and components** import from the `astro-blocks-runtime` Vite alias. Never a relative
    path, never `new URL(…, import.meta.url)` — inside an installed package that resolves to the
    package's own directory, not the consumer's project.
  - **The precompiled API route** cannot use that alias: it ships as injected code, outside the
    consumer's Vite graph. It reads values **baked at config time** into `import.meta.env` via
    `vite.define`.

- **R3 — Every registry the precompiled route needs is baked.** Both the global-blocks registry
  (`ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY`) and the schema map (`ASTRO_BLOCKS_SCHEMA_MAP`). No artifact
  the API route depends on may have the filesystem as its only resolution strategy.

- **R4 — Baked values are double-encoded.** `vite.define` splices its value in as raw **source**, so
  the value is `JSON.stringify`'d **twice**: the outer call emits a string literal that the runtime
  parses back with `JSON.parse`. A single stringify emits an object/array *literal*, which every
  reader's `typeof raw === 'string'` guard silently rejects — falling back to a default as if the
  consumer had configured nothing. That is not hypothetical: it is what shipped the `video/mp4` 415.

- **R5 — The filesystem read is a fallback, never the mechanism.** `.astro-blocks/` is a gitignored
  build artifact, routinely **absent** on a deployed server. Its absence must not break any request
  path. The disk read exists for dev and for `node --test`, where `import.meta.env` does not exist.

- **R6 — An empty registry is a value; an unresolvable one is a failure.** A project that declares no
  blocks bakes `"{}"` and resolves successfully to an empty map. Resolution failure is therefore never
  ambiguous with emptiness, and **must never be represented as an empty result**.

- **R7 — A resolution failure is loud.** No code path may swallow it. Specifically it may not: return
  an empty registry, substitute `null` for the map, or discard the underlying error. Failures are
  logged with the artifact name and the remedy.

- **R8 — The failure is unignorable by construction.** Both loaders return a discriminated union —
  `{ ok: true; schemaMap } | { ok: false; reason: 'unresolved' }` for the schema map, and
  `{ ok: true; entries } | { ok: false; reason: 'unresolved' }` for the global-blocks registry — so the
  type checker rejects any call site that reads either without branching on the failure. A convention
  each caller must remember is not a guarantee; this is the same stance `defineRoute<A>` already takes
  on authorization.

- **R9 — Unresolvable registry ⇒ 500, on every path, including reads.** The eight schema-map call sites
  fail with `errors.loadBlockSchemasFailed`; the three global-block routes with
  `errors.loadGlobalBlocksRegistryFailed`. Reads do **not** degrade to a partial render, and mutations
  — notably deleting a language — do **not** proceed. See ADR-0025 for the trade-off.

  It is a **500 response, never a `throw`**: `dispatch()` has no error boundary, so a throw would
  escape as Astro's HTML error page and break the JSON contract every admin `fetch` depends on.

- **R10 — There is exactly ONE way to fail: `unresolved`.** No second reason, no `missing[]` payload.
  A block whose schema is genuinely absent surfaces elsewhere — `validateBlocks` rejects it as an
  unknown type.

- **R11 — The admin surfaces the failure; it does not absorb it.** A server that fails loudly into a
  client that shrugs is still a silent failure. No admin controller may swallow a resolution error, and
  no fire-and-forget call may drop the rejection. The message shown is the **server's** — it names the
  real fault.

  **A load failure is never reported as a "not found".** The schemas did not fail to *contain* the
  block; they failed to *load*. Reporting the former sends the owner debugging a schema that is fine.

  One deliberate exception: the global-block editor's **pre-submit** schema fetch is a courtesy
  validation preflight, and the `PUT` it precedes fails loudly with the real reason.

---

## Scenarios

- **S-1 — Deployed server, artifact absent.** `.astro-blocks/` does not exist next to the server. Both
  registries resolve from their baked values. Rendering, the page list, the block editor, page save and
  global-block edit all work.

- **S-2 — Dev server.** The artifact exists on disk **and** the bake is present — `vite.define` reaches
  the precompiled route under `astro dev` (measured). The baked value wins; the disk read is not
  reached.

- **S-3 — `node --test`.** No `import.meta.env`, so the schema map resolves from
  `.astro-blocks/schema-map.mjs` seeded by the fixture. This is the supported test seam, and the reason
  `schema-map.mjs` is pure data.

- **S-4 — No artifact at all.** Neither bake nor disk resolves. The loader returns
  `{ ok: false, reason: 'unresolved' }`, logs the artifact and the remedy, and every handler 500s.

- **S-5 — Zero-block project.** The consumer declares `blocks: []`. The bake is `"{}"`. Resolution
  **succeeds** with an empty map; a page carrying a block of any type fails validation as an unknown
  type.

- **S-7 — Language deletion with an unresolvable schema map.** `handleDeleteLanguage` returns 500 and
  **writes nothing**: the language, its pages and its menus are left intact.

- **S-8 — The owner opens the page editor on a broken deployment.** The admin shows an error toast
  carrying the server's message, and *Add block* is disabled. The disabled button is not the
  explanation; the toast is.

- **S-9 — The owner opens a global block on a broken deployment.** The edit modal reports the **load
  failure**. It does **not** say *"schema not found"*.

---

## Coverage

- **e2e is load-bearing here.** `e2e/global-setup.ts` deliberately does **not** place `.astro-blocks/`
  next to the standalone server, so every e2e run exercises S-1 — a deployed server, artifact absent.
  A previous version copied it in *"so the standalone server can find block schemas"*: that copy was
  the defect wearing test scaffolding, and it is why this class of bug survived a green suite. **It
  must not be reintroduced.**
- `e2e/schema-map-failure.spec.ts` — S-8, S-9 (R11), forced by intercepting the endpoint.
- `tests/schema-map-bake-guard.test.js` — R3, R4. Deliberately guards only the *plugin* side: two
  reader-side source-greps were written and both proved incapable of failing (one matched the
  identifier inside the loader's own log message), so they were dropped rather than kept as green
  lights that mean nothing. The reader side is proven behaviourally by S-1.
- `tests/registry-resolution.test.js` — R6 for both registries: unresolvable is a 500, genuinely empty
  is a 200.
- `tests/pages-handlers.test.js`, `tests/global-blocks-handlers.test.js`, `tests/languages-handlers.test.js`
  — R9 at every call site; S-7 asserts the **absence of the write**, not merely the status.
- The baked path cannot be exercised under `node --test` (#81). S-1 is what covers it, and covers it
  better.
