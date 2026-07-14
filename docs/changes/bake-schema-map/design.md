<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Bake the schema map, and make its absence impossible to ignore

## 1. The plugin: compute once, emit three times

`generateRuntime()` already computes `schemaMap` once (`src/plugin/index.ts:260`) and emits it twice:
inline in `runtime.mjs` (`:305-309`) and standalone in `schema-map.mjs` (`:311-317`). The bake becomes
the third emission of the **same** computed value — never a re-derivation.

Its return type widens from `GlobalBlockRuntimeEntry[]` to a record:

```ts
export async function generateRuntime(
  projectRoot: string,
  options: AstroBlocksOptions,
): Promise<{ globalBlocksRegistry: GlobalBlockRuntimeEntry[]; schemaMap: SchemaMap }>
```

This is safe: `generateRuntime` is exported from the package entry but is not documented, not in
`AGENTS.consumer.md`, and its only external caller is `tests/global-blocks-plugin.test.js`, which
**ignores the return value** (`:123`, `:155`, `:174`).

The bake sits beside the registry's, and uses the same double-encode. That encoding is not
decoration — `src/plugin/index.ts:570-578` records what a single `JSON.stringify` cost last time
(the `video/mp4` 415: `vite.define` splices its value in as raw **source**, so a single stringify
becomes an array literal, which the `typeof raw === 'string'` guard then silently rejects):

```ts
vite.define['import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP'] = JSON.stringify(JSON.stringify(schemaMap));
```

A zero-block project bakes `"{}"` — a 2-character string, truthy, `JSON.parse`-able to `{}`. The
`length > 0` guard holds. **Empty is a valid value, not a failure.** This is the property that makes
the uniform hard-fail safe.

## 2. `loadSchemaMap()`: baked-first, disk-second, loud on failure

The resolution order mirrors `loadGlobalBlocksRegistry` (`src/api/route-table.ts:45-69`) exactly.
The return type is the change that matters:

```ts
export type SchemaMapResult =
  | { ok: true; schemaMap: SchemaMap }
  | { ok: false; reason: 'unresolved' | 'incomplete'; missing?: string[] };
```

- **`unresolved`** — neither the baked value nor the disk artifact yielded a schema map. The
  deployment is broken. This is the ADR-0009 failure mode.
- **`incomplete`** — the map resolved, but declared entries are `undefined` (today's
  `error: 'Missing block schema'` + `missing[]`). A consumer configuration error, not a deployment
  one. Kept distinct because the `missing[]` payload is actionable and already flows to the client.

Both are `ok: false`. Both produce a 500. The distinction exists for the operator, not the branch.

**Failure is logged, not swallowed.** The disk `catch` stops discarding its error and follows the
repo's convention (`src/api/handlers/backup-routes.ts:163`):

```ts
console.error(
  '[astro-blocks] Could not resolve the block schema map. Neither the baked value ' +
  '(import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP) nor .astro-blocks/schema-map.mjs resolved. ' +
  'If this is a deployed server, the integration was not present at build time (see ADR-0009/ADR-0025).',
  err,
);
```

The message names the remedy. `'Failed to load block schemas'` never told anyone anything.

## 3. The eight call sites

The union makes the compiler do the enforcing: nothing type-checks until every site branches.

**Already correct — mechanical rewrite to the union, no behaviour change:**

| Site | Handler | Today |
|---|---|---|
| `pages.ts:165` | `handleGetBlockSchemas` | explicit 500 |
| `global-blocks.ts:114` | `handleUpdateGlobalBlock` | explicit 500, `errors.schemaLoadFailed` |
| `pages.ts:184` | `handlePostPages` | guarded upstream by `ensureValidBlocks` (`:178`) |
| `pages.ts:253` | `handlePutPage` | guarded upstream by `ensureValidBlocks` (`:247`) |

**Behaviour change — these four gain a hard fail:**

| Site | Handler | Today | After |
|---|---|---|---|
| `pages.ts:151` | `handleGetPages` | 200, unprojected images | 500 `errors.schemaLoadFailed` |
| `global-blocks.ts:25` | `handleGetGlobalBlocks` | 200, unprojected | 500 |
| `global-blocks.ts:63` | `handleGetGlobalBlock` | 200, unprojected | 500 |
| `languages.ts:142` | `handleDeleteLanguage` | proceeds, deletes | 500 — **refuses to mutate** |

`languages.ts` deserves the note: `removeLocaleFromPage` happens to survive a null schema map because
it branches on value shape, not schema (`src/utils/locale-projection.ts:118-127`). That is luck, not
design. A destructive, irreversible operation must not run on a resolution the system could not make.
It now refuses.

`errors.schemaLoadFailed` already exists in both i18n catalogs — no new key, no parity churn.

`ensureValidBlocks` (`schema-loading.ts:37-62`) keeps its shape and simply consumes the union. Note
its existing skip: `blocks === undefined` or `blocks === []` bypasses validation entirely. That is
retained — there is nothing to validate, and the merge has nothing to corrupt.

## 4. `route-table.ts`: the empty-registry default goes

```ts
} catch {
  return [];   // ← silently defaults to an empty registry
}
```

This is the original ADR-0009 symptom, alive in the fallback. `loadGlobalBlocksRegistry` gains the
same treatment: log with a named remedy, and let the absence be visible rather than shipping an empty
array that reads as *"this project declares no global blocks"*.

## 5. Proving it

Three layers, in descending order of what they actually prove.

### 5.1 e2e — remove the crutch (this is the proof)

`e2e/global-setup.ts` copies `.astro-blocks/` into `.e2e-data/`. **Delete the copy.** The standalone
server then runs with `ASTRO_BLOCKS_PROJECT_ROOT` pointing at a directory where the artifact does not
exist — which is precisely a deployed server.

A green suite (login → create a page with blocks → save → edit a global block) then proves the bake
resolves the schema map with the artifact absent. Today, that same suite would fail; it passes only
because of the copy.

If anything else silently depended on that copy, e2e goes red and we learn what. That is the point.

### 5.2 Structural guard — the bake cannot be removed silently

A source-grep test in the idiom of `tests/admin-define-vars-bridge.test.js`: assert
`src/plugin/index.ts` bakes `import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP` with the double-encode. It
proves nothing about resolution; it stops a future edit from quietly deleting the bake and leaving the
disk read as the only strategy again — which is exactly how we got here.

### 5.3 Unit — the union, at every site

These run under `node --test`, where `import.meta.env` does not exist, so `loadSchemaMap()` takes the
**disk** path. An absent artifact therefore yields `ok: false` — which is exactly the fixture we need.
The seam that made the bug invisible is the seam that tests the fix.

- The four newly-strict sites: artifact absent → 500.
- `tests/pages-handlers.test.js:54` (*"returns 500 when schema-map.mjs is missing"*) keeps passing
  unchanged. It stays true of the **unit** environment — it just stops being a description of
  production. That is the whole point of the change, and worth a comment on the test saying so.
- `incomplete` (a declared block with an `undefined` schema) still returns `missing[]`.

The baked path itself remains untestable at `node --test` — that is #81's wall, and this change does
not pretend to breach it. §5.1 is what covers it, and it covers it better.

## 6. Vocabulary

The bug's deepest cause is that `schema-map.mjs` is not in the domain vocabulary. `docs/CONTEXT.md`
gains:

- a **glossary** entry for the *schema map* — the pure-data twin of the registry, importable outside
  Vite (which is *why* it exists as a second file), with its resolution regime;
- the artifact in the **mental-model diagram** (`:35`), so the picture shows both generated files;
- a correction to `:40-41`, which today claims the precompiled route reads a baked value **or** falls
  back to the filesystem. That will finally be true of both artifacts instead of one.

## 7. Files touched

| File | Change |
|---|---|
| `src/plugin/index.ts` | `generateRuntime()` returns `{ globalBlocksRegistry, schemaMap }`; bake `ASTRO_BLOCKS_SCHEMA_MAP` |
| `src/api/handlers/schema-loading.ts` | Baked-first resolution; discriminated union; loud failure |
| `src/api/handlers/pages.ts` | 2 sites to the union; `handleGetPages` hard-fails |
| `src/api/handlers/global-blocks.ts` | 3 sites to the union; both GETs hard-fail |
| `src/api/handlers/languages.ts` | 1 site to the union; `handleDeleteLanguage` refuses to mutate |
| `src/api/route-table.ts` | `catch { return [] }` → loud failure |
| `e2e/global-setup.ts` | Delete the `.astro-blocks/` copy |
| `tests/*` | Union assertions at the 8 sites; structural bake guard |
| `docs/CONTEXT.md` | Glossary + diagram: name the schema map |
| `docs/adr/0009-*.md` | Update the compliance note — the gap is closed |
