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

- **R4 — Baked values are double-encoded, and the encode/decode lives in one module.** `vite.define`
  splices its value in as raw **source**, so a structured value is `JSON.stringify`'d **twice**: the
  outer call emits a string literal the runtime parses back with `JSON.parse`. A single stringify
  emits an object/array *literal*, which the `typeof raw === 'string'` guard rejects — falling back to
  a default as if the consumer had configured nothing (the `video/mp4` 415).

  This asymmetry is not re-implemented per reader. The writer (`defineBakedValue`) owns which keys
  are structured, and readers decode through one isomorphic module (`src/utils/baked.ts`):
  `decodeBaked` performs the guard + `JSON.parse` + a caller-supplied validator and never throws (a
  malformed bake is `{ ok: false }`, not an exception). The module carries **no** `node:*` import and
  **no** i18n import, so the two readers that run in the browser (the admin block-form island,
  `media.astro`) can use it without pulling server code into the client bundle. A test asserts the
  isomorphism.

- **R5 — The filesystem read is a fallback, never the mechanism.** `.astro-blocks/` is a gitignored
  build artifact, routinely **absent** on a deployed server. Its absence must not break any request
  path. The disk read exists for dev and for `node --test`, where `import.meta.env` does not exist.

- **R6 — An empty registry is a value; an unresolvable one is a failure.** A project that declares no
  blocks bakes `"{}"` and resolves successfully to an empty map. Resolution failure is therefore never
  ambiguous with emptiness, and **must never be represented as an empty result**.

- **R7 — A resolution failure is loud.** No code path may swallow it. Specifically it may not: return
  an empty registry, substitute `null` for the map, or discard the underlying error. Failures are
  logged with the artifact name and the remedy.

- **R8 — The failure is unignorable by construction, via one shared union.** Both artifact loaders
  read through `readBakedArtifact`, which returns `BakedResolution<T> = { ok: true; value } | { ok:
  false; reason: 'unresolved' }`. The failure arm (`BakedUnresolved`) is defined **once** in
  `src/utils/baked.ts` and imported — `SchemaMapResult` and `RegistryResult` reuse it rather than each
  re-declaring `{ ok: false; reason: 'unresolved' }`. The type checker still rejects any call site
  that reads either without branching on the failure; this is the same stance `defineRoute<A>` takes
  on authorization. The module owns *how you know* a value is unresolved; the caller still owns *what
  unresolved means* — for an artifact, a dev/test filesystem read and, only if that also fails, a 500
  (R9). That `Response` is built at the server call site, never inside the module.

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

- **R12 — A baked key is either an artifact or a config, and the reader picks the matching
  entrypoint.** Absence means different things for different keys, and it is a property of the key,
  not the call site:

  - **Artifacts** (`GLOBAL_BLOCKS_REGISTRY`, `SCHEMA_MAP`) — absence is a broken deployment. Read via
    `readBakedArtifact`, which returns the union so the caller runs its disk-seam fallback (R5) and
    then fails loudly (R7–R9). There is no default.
  - **Configs** (`ALLOWED_FILE_TYPES`, `CUSTOM_FILE_TYPES`, `MAX_UPLOAD_BYTES_BY_CATEGORY`) — absence
    means dev/test, where a documented default is correct. Read via `readBakedConfig`, which returns
    the default on `{ ok: false }`.

  No single entrypoint takes both a `fallback` and a hard-fail callback: that would return to the call
  site the decision the classes exist to settle (ADR-0033). An empty structured value is still a
  value, not a failure (R6): `"{}"` and `"[]"` decode successfully, so an empty allowlist resolves to
  empty rather than falling back.

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
- `tests/baked.test.js` — R4, R8. The double-encode round trip as an executable assertion:
  `defineBakedValue` → simulated vite substitution → `decodeBaked` returns the value, and a
  *single*-encoded value (an array literal) resolves to `{ ok: false }` — the `video/mp4` shape. Also
  asserts the module's isomorphism (no `node:` / i18n import in `dist/utils/baked.js`). This replaced
  `schema-map-bake-guard.test.js`, a plugin-side source-grep whose own tail comment conceded a source
  grep "cannot fail" reliably; the reader side is still proven behaviourally by S-1.
- `tests/registry-resolution.test.js` — R6 for both registries: unresolvable is a 500, genuinely empty
  is a 200.
- `tests/pages-handlers.test.js`, `tests/global-blocks-handlers.test.js`, `tests/languages-handlers.test.js`
  — R9 at every call site; S-7 asserts the **absence of the write**, not merely the status.
- The baked path cannot be exercised under `node --test` (#81). S-1 is what covers it, and covers it
  better.
