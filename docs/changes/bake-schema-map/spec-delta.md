<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Bake the schema map, and make its absence impossible to ignore

`docs/specs/` holds no specification for how the generated runtime artifacts are resolved, so this
delta **inaugurates** `docs/specs/runtime-artifact-resolution.md`. Everything below describes the
behaviour after the change; where it differs from today, the difference is called out.

---

## ADDED: Runtime artifact resolution

### Capability

The plugin generates two artifacts into the consumer's gitignored `.astro-blocks/` directory. Both
must be readable at request time by code that runs on **either side of the build boundary**. This
capability specifies which artifact each side reads, and what happens when it cannot be read.

### Requirements

- **R1 — Two artifacts, one computation.** `generateRuntime()` computes the block/global-block
  entries and the schema map **once**, and emits them as: `runtime.mjs` (component map, schema map,
  global-blocks registry — imports real `.astro` components, so it is loadable **only** inside a Vite
  graph) and `schema-map.mjs` (the schema map alone, as pure data, therefore loadable from plain
  Node). The two files never diverge, because they are two emissions of the same value.

- **R2 — Two resolution regimes, one per side of the build boundary.**
  - Astro pages and components import from the `astro-blocks-runtime` Vite alias. Never a relative
    path, never `new URL(…, import.meta.url)`.
  - The precompiled API route cannot use that alias. It reads values **baked at config time** into
    `import.meta.env` via `vite.define`.

- **R3 — Every registry the precompiled route needs is baked.** Both the global-blocks registry
  (`ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY`) and the schema map (`ASTRO_BLOCKS_SCHEMA_MAP`) are baked.
  No artifact the API route depends on may have the filesystem as its only resolution strategy.
  *(Today the schema map does — this is the change.)*

- **R4 — Baked values are double-encoded.** `vite.define` splices its value in as raw **source**, so
  the value is `JSON.stringify`'d twice: the outer call emits a string literal that the runtime parses
  back with `JSON.parse`. A consumer that guards with `typeof raw === 'string'` therefore receives a
  string, not a spliced object literal.

- **R5 — The filesystem read is a fallback, never the mechanism.** `.astro-blocks/` is a gitignored
  build artifact, routinely absent on a deployed server. Its absence must not break any request path.
  The disk read exists for dev and for `node --test`, where `import.meta.env` does not exist.

- **R6 — An empty registry is a value; an unresolvable one is a failure.** A project that declares no
  blocks bakes `"{}"`, which resolves successfully to an empty map. Resolution failure is therefore
  never ambiguous with emptiness, and must never be represented as an empty result.

- **R7 — A resolution failure is loud.** No code path may swallow it. Specifically it may not:
  return an empty registry, return `null`/`undefined` in place of the map, or discard the underlying
  error. Failures are logged with the artifact name and the remedy, and surfaced to the caller as a
  failure the caller **cannot ignore**.

- **R8 — The failure is unignorable by construction.** **Both** loaders return a discriminated union —
  `{ ok: true; schemaMap } | { ok: false; reason: 'unresolved' }` for the schema map,
  `{ ok: true; entries } | { ok: false; reason: 'unresolved' }` for the global-blocks registry — so the
  type checker rejects any call site that reads either without branching on the failure. A convention
  that each caller must remember is not a guarantee.

- **R9 — Unresolvable registry ⇒ 500, on every path, including reads.** All eight schema-map call
  sites fail with `errors.loadBlockSchemasFailed`; the three global-block routes fail with
  `errors.loadGlobalBlocksRegistryFailed`. Reads do **not** degrade to a partial render, and mutations
  (notably deleting a language) do **not** proceed. See ADR-0025 for the trade-off.

  The failure is a **500 response, never a `throw`**: `dispatch()` (`src/routes/api/catchall.ts`) has
  no error boundary, so a throw would escape as Astro's HTML error page and break the JSON contract
  every admin `fetch` depends on.

- **R10 — There is exactly ONE way to fail: `unresolved`.** The loader carries no second reason
  and no `missing[]` payload. An `incomplete` variant (declared blocks with no schema) was drafted
  and removed as **unreachable**: `buildSchemaMap` OMITS a key it cannot serialize rather than
  assigning `undefined`, and the baked path cannot express it either — JSON drops `undefined`. No
  emitted artifact can trip it, nothing consumed its payload, and no test covered it. A branch no
  input can reach is not defensive; it is a green light that means nothing. A block whose schema is
  genuinely absent still surfaces — `validateBlocks` rejects it as an unknown type.

- **R11 — The admin surfaces the failure; it does not absorb it.** A server that fails loudly into a
  client that shrugs is still a silent failure. No admin controller may swallow a resolution error:
  the page editor reports it rather than merely disabling *Add block*, the global-block editor reports
  it rather than falling through to *"schema not found"*, and no fire-and-forget call may drop the
  rejection. The message shown is the **server's** — it already names the real fault.

  **A load failure is never reported as a "not found".** The schemas did not fail to *contain* the
  block; they failed to *load*. Reporting the former sends the owner debugging a schema that is fine
  — the same confident-wrong answer, in a new costume.

  One deliberate exception: the global-block editor's **pre-submit** schema fetch is a courtesy
  validation preflight, and the `PUT` it precedes fails loudly with the real reason. Skipping the
  preflight defers to that truth instead of inventing a verdict without a schema.

### Scenarios

- **S-1 — Deployed server, artifact absent.** `.astro-blocks/` does not exist next to the server.
  Both registries resolve from their baked values. Rendering, the page list, the block editor, page
  save and global-block edit all work.
  *(Today: rendering and global blocks work; block schemas do not resolve, so page save returns 500
  and the page list returns 200 with unprojected image props.)*

- **S-2 — Dev server.** `.astro-blocks/` exists on disk **and** the bake is present (measured:
  `vite.define` reaches the precompiled route under `astro dev`). The baked value wins; the disk read
  is not reached.

- **S-3 — `node --test`.** `import.meta.env` does not exist, so the schema map resolves from
  `.astro-blocks/schema-map.mjs` seeded by the test fixture. This is the supported test seam.

- **S-4 — Unit test, no artifact seeded.** Neither bake nor disk resolves. `loadSchemaMap()` returns
  `{ ok: false, reason: 'unresolved' }`, the error is logged, and every handler returns 500.

- **S-5 — Zero-block project.** The consumer declares `blocks: []`. The bake is `"{}"`. Resolution
  **succeeds** with an empty map. Every handler serves normally; a page carrying a block of any type
  fails validation as an unknown type.

- **S-7 — Language deletion with an unresolvable schema map.** `handleDeleteLanguage` returns 500 and
  **writes nothing**. The language, its pages and its menus are left intact.
  *(Today: it proceeds and deletes.)*

- **S-8 — The owner opens the page editor on a broken deployment.** `GET /cms/api/block-schemas`
  500s. The admin shows an **error toast carrying the server's message**, and *Add block* is disabled.
  *(Today: the button is disabled and nothing is said. The e2e RED for this change caught exactly that
  — `element is not enabled`, with no explanation anywhere on the screen.)*

- **S-9 — The owner opens a global block on a broken deployment.** The edit modal reports the **load
  failure**. It does **not** say *"schema not found for `<name>`"*.
  *(Today: it says exactly that, and the schema is fine.)*

### Coverage

- **e2e (load-bearing).** `e2e/global-setup.ts` no longer copies `.astro-blocks/` into `.e2e-data/`.
  The standalone e2e server therefore runs against a project root where the artifact **does not
  exist** — S-1. Login, page-with-blocks create/save and global-block edit passing under that
  condition is the proof. *(The copy exists today precisely because this does not currently work.)*
- **Structural guard** (`tests/schema-map-bake-guard.test.js`). Asserts `src/plugin/index.ts` bakes
  **both** registries, each with the double-encode of R4 — guarding R3 against silent removal. Validated
  by sabotage: deleting the bake, and downgrading it to a single `JSON.stringify`, each turn it red.

  The **reader** side is deliberately *not* source-grepped. Two such assertions were written and both
  proved incapable of failing — one matched the identifier inside the loader's own `console.error`
  string, the other measured comment order. A guard that cannot fail is worse than no guard: it is a
  green light that means nothing. The e2e covers that side behaviourally instead (a server with no
  artifact on disk can only work if the bake is primary). See #81.
- **Unit.** S-4 and S-5 at all eight schema-map call sites; S-7 asserts no write occurred;
  `tests/registry-resolution.test.js` covers R6 for both registries — an unresolvable one is a 500, a
  genuinely empty one is a 200.
- **e2e, R11** (`e2e/schema-map-failure.spec.ts`). S-8 and S-9, forced by intercepting
  `GET /cms/api/block-schemas` with a 500 — the real fault can no longer be reproduced naturally, which
  is the point of the fix. Validated by reverting the client change: one test catches the missing
  toast, the other catches the *"not found"* lie.

---

## MODIFIED: `docs/CONTEXT.md` — the schema map enters the vocabulary

The mental-model diagram (`:35`) shows exactly one generated artifact, `runtime.mjs`. `schema-map.mjs`
appears nowhere in the document, and `:40-41` claims the precompiled API route *"reads BAKED
`import.meta.env` (or filesystem fallback in dev)"* — which is true of the registry and false of the
schema map.

That gap is not incidental. **The artifact that broke is the artifact the vocabulary never named.**

- **Glossary (§3)** gains a **Schema map** entry: the pure-data twin of `runtime.mjs`
  (`.astro-blocks/schema-map.mjs`), holding block schemas only. It exists as a separate file because
  `runtime.mjs` imports real `.astro` components and therefore cannot be loaded outside a Vite graph.
  Resolved baked-first by the precompiled API route (ADR-0009, ADR-0025); the file on disk is the
  dev/test seam.
- The **Registry / runtime.mjs** entry (`:97`) is amended to point at its twin.
- The **diagram** (`:35`) shows both artifacts, and `:40-41` becomes true of both.
- **Gotchas (§7)** gains: a new value the precompiled API route must read is baked into
  `vite.define`, double-encoded, or it does not exist in production. The filesystem is not a
  resolution strategy — `.astro-blocks/` is gitignored and absent on deployed servers.
