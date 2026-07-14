<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Bake the schema map, and make its absence impossible to ignore

Vertical slices, TDD order: **red before green, always**. One commit per slice.

Legend: `[ ]` pending · `[x]` done

> **Why Slice 1 exists.** `e2e/global-setup.ts` copies `.astro-blocks/` next to the standalone server
> — in its own words, *"so the standalone server can find block schemas"*. That copy is not test
> scaffolding; it is **the bug, wearing a costume**. No deployed server performs it. Any plan that
> writes the fix before removing the crutch is testing against a world that does not exist, and will
> report green on a defect that ships. Strip it first. Watch it break. *Then* fix it.

---

## Slice 1 — RED: strip the crutch, watch it break

**Goal:** the failing test that *is* the deployment bug — a standalone server with no `.astro-blocks/`
next to it, which is every real deployment.

- [x] **1.1** `e2e/global-setup.ts` — delete the `.astro-blocks/` copy (`src` → `dest`, the
  `fs.cpSync` and its guard). Keep the data-dir wipe: that is genuine test isolation. Rewrite the
  file header, which today explains the copy as a feature.
- [x] **1.2** No new e2e test needed — **Test B** (`e2e/admin-flow.spec.ts:128`, *"create a page with a
  block and it persists"*) already exercises the path. It has been passing on a lie.

**Verify:** `npm run build:playground && npm run e2e` →

- **Test B FAILS.** Expect it to die *early*: the block-select modal is populated from
  `GET /cms/api/block-schemas` (`src/routes/admin/client/page-editor.ts:732`), which now 500s, so the
  modal opens **empty** and `blockItems.first()` never appears — before the save is even attempted.
  This is #101, reproduced on a real server.
- **global-block edit still PASSES** — because its registry *is* baked. That asymmetry, visible in one
  run, is the whole diagnosis: one artifact was baked, its twin was not.

If Test B passes, the copy is still reaching the server somehow — find it before writing any source.

---

## Slice 2 — GREEN: bake the schema map

**Goal:** make Slice 1 green by giving the schema map the resolution strategy the registry already has.

- [x] **2.1** `src/plugin/index.ts` — `generateRuntime()` returns
  `{ globalBlocksRegistry: GlobalBlockRuntimeEntry[]; schemaMap: SchemaMap }` instead of the bare
  array. The `schemaMap` is the value **already computed** at `:260` — return it, never recompute it.
  Update the call site in `astro:config:setup` and the doc comment at `:324-330`.
- [x] **2.2** `src/plugin/index.ts` — bake beside the registry (`:598`), with the **double-encode**:
  ```ts
  vite.define['import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP'] = JSON.stringify(JSON.stringify(schemaMap));
  ```
  A single `JSON.stringify` splices an object **literal** into the source and the `typeof === 'string'`
  guard silently rejects it — that is precisely what caused the `video/mp4` 415 (`:570-578`). Do not
  re-learn this.
- [x] **2.3** `src/api/handlers/schema-loading.ts` — `loadSchemaMap()` reads baked-first, disk-second.
  Mirror `loadGlobalBlocksRegistry` (`src/api/route-table.ts:45-69`) structurally: read
  `import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP`, `JSON.parse`, and fall through to the disk import only if
  the bake is absent or malformed. **Return shape unchanged in this slice** — the union is Slice 3.

**Verify:** `npm run build:playground && npm run e2e` → **the whole suite is green**, with no
`.astro-blocks/` beside the server. That is S-1: a deployed server resolving block schemas from the
bundle. `npm test` still green (unit tests take the disk path — untouched).

---

## Slice 3 — RED→GREEN: make the failure unignorable

**Goal:** close the class. Four of eight call sites ignore the error today; the type is what lets them.

### RED

- [ ] **3.1** `tests/pages-handlers.test.js` — no artifact seeded, assert **`handleGetPages` returns
  500**. Currently returns 200. *(S-4)*
- [ ] **3.2** `tests/global-blocks-handlers.test.js` — same for **`handleGetGlobalBlocks`** and
  **`handleGetGlobalBlock`**. Currently 200.
- [ ] **3.3** `tests/get-languages.test.js` (or the file covering `handleDeleteLanguage`) — no artifact
  seeded, `DELETE` a language → assert **500 and that `pages.json` / `menus.json` / `languages.json`
  are byte-identical afterwards**. Today it proceeds and deletes. *(S-7 — assert the **absence of the
  write**, not just the status. The status is the easy half.)*

**Verify:** `npm test` → all four fail. If any passes, it is asserting nothing.

### GREEN

- [ ] **3.4** `src/api/handlers/schema-loading.ts` — introduce the union and stop swallowing:
  ```ts
  export type SchemaMapResult =
    | { ok: true; schemaMap: SchemaMap }
    | { ok: false; reason: 'unresolved' | 'incomplete'; missing?: string[] };
  ```
  The disk `catch` logs via `console.error('[astro-blocks] …', err)` with the artifact name **and the
  remedy** (see `design.md` §2). `'Failed to load block schemas'` told nobody anything.
  `ensureValidBlocks` consumes the union; its `blocks === undefined | []` skip is retained.
- [ ] **3.5** Branch all **8** call sites. Four are mechanical (`pages.ts:165`, `:184`, `:253`;
  `global-blocks.ts:114`) — same behaviour, new shape. Four change behaviour, all returning 500 with
  the **existing** `errors.schemaLoadFailed` key (no new i18n key, no parity churn):
  `pages.ts:151`, `global-blocks.ts:25`, `global-blocks.ts:63`, `languages.ts:142`.
- [ ] **3.6** `tests/pages-handlers.test.js:54` — the test *"returns 500 when schema-map.mjs is
  missing"* keeps passing untouched. Add a comment: it describes the **`node --test` environment**,
  where there is no bake, and is **no longer a description of production**. Left uncommented, the next
  reader re-learns the bug from it.
- [ ] **3.7** `tests/handlers-export-baseline.test.js` — update if the exported surface moved.

**Verify:** `npm test` green · `npm run typecheck` green — and typecheck is the real assertion here: it
is what proves no call site can read the map without facing the failure.

---

## Slice 4 — The last swallowing catch

- [ ] **4.1** `src/api/route-table.ts:66-69` — `catch { return [] }` silently defaults to an empty
  registry, which reads downstream as *"this project declares no global blocks"*. That is the original
  ADR-0009 symptom, still alive in the fallback. Log with the artifact name and the remedy; do not
  fabricate an empty registry.
- [ ] **4.2** A unit test for it: bake absent, disk artifact absent → the failure is visible, not an
  empty array.

**Verify:** `npm test` green.

---

## Slice 5 — Guard the bake against silent removal

- [ ] **5.1** `tests/schema-map-bake-guard.test.js` (new) — in the idiom of
  `tests/admin-define-vars-bridge.test.js` (a source-grep structural guard): assert `src/plugin/index.ts`
  bakes `import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP` **with the double-encode**.

  It proves nothing about resolution — §5.1 of `design.md` covers that. It stops a future edit from
  quietly deleting the bake and leaving the filesystem as the only strategy again, which is **exactly
  how we got here**. The baked path cannot be exercised at `node --test` (`import.meta.env` does not
  exist there — see #81), so this guard and the e2e are all we get. Both must exist.

**Verify:** `npm test` green. Then delete the bake locally → the guard fails. Restore it.

---

## Slice 6 — Name the thing

**Goal:** the artifact that broke is the artifact the vocabulary never named. Fix the vocabulary, or
it breaks again.

- [ ] **6.1** `docs/CONTEXT.md` — glossary (§3): add **Schema map**. The pure-data twin of the
  registry (`.astro-blocks/schema-map.mjs`), holding block schemas only. It exists as a **separate
  file** because `runtime.mjs` imports real `.astro` components and therefore cannot be loaded outside
  a Vite graph. Resolved baked-first by the precompiled API route; the file on disk is the dev/test
  seam. Amend the **Registry / runtime.mjs** entry (`:97`) to point at its twin.
- [ ] **6.2** `docs/CONTEXT.md:35` — the mental-model diagram shows **both** generated artifacts. Fix
  `:40-41`, which claims the precompiled route *"reads BAKED `import.meta.env` (or filesystem fallback
  in dev)"* — true of the registry, false of the schema map. After this change it is finally true of
  both.
- [ ] **6.3** `docs/CONTEXT.md` §7 (Gotchas) — any new value the precompiled API route must read is
  **baked into `vite.define`, double-encoded**, or it does not exist in production. The filesystem is
  not a resolution strategy: `.astro-blocks/` is gitignored and absent on deployed servers.
- [ ] **6.4** `docs/adr/0009-runtime-registry-resolution.md` — update the compliance note. The gap is
  closed; point at ADR-0025. The **decision** is untouched (ADRs are immutable); the note is a dated
  verification annotation and is now false.

**Verify:** `npm run typecheck` · `npm test` · `npm run features:validate` · `npm run check` (Biome).

---

## Not in this change

- **No version bump, no `CHANGELOG` entry** until you ask to close (AGENTS.md, *Versionado*).
- **`docs/DECISIONS.md` is not touched.** It runs a *second, colliding* ADR numbering scheme
  (`ADR-001`…`ADR-006`) — that is issue **#85**, and dragging it in here would entangle two changes.
- **#81** (no `node --test` seam for baked env values) is **not solved**, only worked around for this
  one artifact. Slice 5 exists because of it.
- **#96** (fire-and-forget variant job) is unrelated.
