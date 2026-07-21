<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — The deep bake module

Two targets. Most of the change lands on `docs/specs/runtime-artifact-resolution.md`, which already
governs the bake — R4 and R8 describe the mechanism this change centralises, and are reworded from
"every reader does X" to "one module does X, every reader calls it". A smaller clause lands on
`docs/specs/media-uploads.md` for the admin/server allowlist-agreement behaviour change.

## MODIFIED: runtime-artifact-resolution.md R4 — The bake mechanism lives in one module

R4 today states the double-encode as a rule every reader upholds by hand. It becomes:

> **R4 — Baked values are double-encoded, and the encode/decode lives in one module.** `vite.define`
> splices its value in as raw source, so a structured value is `JSON.stringify`'d **twice**: the
> outer call emits a string literal the runtime parses back with `JSON.parse`. A single stringify
> emits an object/array literal that the `typeof raw === 'string'` guard rejects — the failure that
> shipped the `video/mp4` 415.
>
> This asymmetry is no longer re-implemented per reader. The writer (`defineBakedValue`) owns which
> keys are structured, and the readers decode through one isomorphic module (`src/utils/baked.ts`):
> `decodeBaked` performs the guard + `JSON.parse` + a caller-supplied validator and never throws
> (a malformed bake is `{ ok: false }`, not an exception). The module carries **no** `node:*` import
> and **no** i18n import, so the two readers that run in the browser can use it without pulling server
> code into the client bundle.

## MODIFIED: runtime-artifact-resolution.md R8 — One union, defined once

R8 today names the union twice, once per loader. It becomes:

> **R8 — The failure is unignorable by construction, via one shared union.** Both class-A loaders
> return `BakedResolution<T> = { ok: true; value } | { ok: false; reason: 'unresolved' }`, defined
> **once** in `src/utils/baked.ts` and imported — not re-declared per loader. The type checker still
> rejects any call site that reads a registry without branching on the failure. The module owns *how
> you know a value is unresolved*; the caller still owns *what unresolved means* — for class-A keys, a
> dev/test filesystem read and, only if that also fails, a 500. R9's `Response` is built at the
> server call site, never inside the module.

## ADDED: runtime-artifact-resolution.md R12 — Two key classes, chosen by the reader entrypoint

(R11 already exists — "The admin surfaces the failure; it does not absorb it". This is R12.)

> **R12 — A baked key is either an artifact or a config, and the reader picks the matching
> entrypoint.** Absence means different things for different keys, and it is a property of the key,
> not the call site:
>
> - **Artifacts** (`GLOBAL_BLOCKS_REGISTRY`, `SCHEMA_MAP`) — absence is a broken deployment. Read via
>   `readBakedArtifact`, which returns the union so the caller can run its disk-seam fallback and
>   then fail loudly (R7–R9). There is no default.
> - **Configs** (`ALLOWED_FILE_TYPES`, `CUSTOM_FILE_TYPES`, `MAX_UPLOAD_BYTES_BY_CATEGORY`) — absence
>   means dev/test, where a documented default is correct. Read via `readBakedConfig`, which returns
>   the default on `{ ok: false }`.
>
> No single entrypoint takes both a `fallback` and a hard-fail callback: that would return to the
> call site the decision the classes exist to settle. An empty structured value is still a value, not
> a failure (R6): `"{}"` and `"[]"` decode successfully, so an empty allowlist resolves to empty
> rather than falling back.

## MODIFIED: media-uploads.md — the admin allowlist agrees with the server

Under the allowlist/configuration behaviour, add:

> **The admin panel resolves `allowedFileTypes` through the same decoder as the server.** All three
> readers decode the baked allowlist with the one shared validator (`decodeAllowlist`), so they can
> no longer drift: the two admin readers used to check only `length > 0` and fall back to the full
> default catalog, and cast `as string[]` uncoerced. Now they honour whatever the server honours,
> and a non-string element (`[123]`) is rejected rather than reaching the `accept` attribute as
> garbage.
>
> **The upload `accept` attribute is a picker hint, never the gate — the server enforces the
> allowlist.** One consequence of the empty allowlist (`allowedFileTypes: []`, which warns "all
> uploads will be rejected"): the resolved list is `[]`, so `accept` renders empty, which HTML treats
> as *accept-anything* at the OS file dialog. The picker therefore cannot express "offer nothing" for
> this config. That is a cosmetic mismatch only: every selected file is still rejected by the server,
> which is and always was the enforcement point. The refactor's delivered value is the single shared
> decoder (no more per-reader drift) and the rejection of malformed elements — not a claim that the
> picker offers nothing for an empty allowlist.

## Coverage delta

- `runtime-artifact-resolution.md` Coverage gains: a direct round-trip unit test
  (`defineBakedValue` → simulated vite substitution → `decodeBaked`) replaces the source-regex guard
  in `schema-map-bake-guard.test.js`, which its own tail comment concedes cannot reliably fail.
- `media-uploads.md` Scenarios gains: `decodeAllowlist([])` → `[]` (empty is a value, shared by all
  three readers) and `decodeAllowlist([123])` → `null` (garbage rejected, not cast through). The
  server rejecting an empty-allowlist upload is unchanged and already covered.
  (one assertion pinning both); `"[123]"` ⇒ fallback, not a garbage `accept` attribute.
