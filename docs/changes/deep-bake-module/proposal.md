<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Make the bake a deep module

_Resolves [#116](https://github.com/NauelG/astro-blocks/issues/116) (P1, refactor + behaviour fix).
Grilled 2026-07-20._

## Problem

The *bake* — writing build-time values into the SSR bundle via `vite.define` so the precompiled
runtime never reads the gitignored `.astro-blocks/` artifacts at request time — is a **shallow
interface**. Its whole contract is re-implemented at every reader:

- the double-`JSON.stringify` write (`vite.define` splices its value in as raw *source*, so a single
  stringify of an array becomes an array *literal* in the bundle),
- the `typeof raw === 'string'` guard on read,
- `JSON.parse`,
- a shape check,
- a fallback.

This invariant has the worst bug record in the codebase, and every incident is the same shape —
a reader that decoded the bake slightly differently from its siblings:

- global blocks 404'd in production (ADR-0009),
- block schemas 500'd (#101 / ADR-0025),
- `allowedFileTypes` shipped single-encoded and silently fell back to the default in every released
  version — the reported `video/mp4` 415 (`plugin/index.ts:580-592` documents the post-mortem).

## Evidence, re-verified against the code

**Writer:** `src/plugin/index.ts:564-618` — 11 `vite.define` keys: 6 single-encoded scalars
(`PROJECT_ROOT`, `PUBLIC_RENDERING`, `CACHE_*`, `ROUTING_STRATEGY`) and 5 double-encoded structured
values (`ALLOWED_FILE_TYPES`, `CUSTOM_FILE_TYPES`, `MAX_UPLOAD_BYTES_BY_CATEGORY`,
`GLOBAL_BLOCKS_REGISTRY`, `SCHEMA_MAP`).

**7 structured reader sites, each re-implementing the decode** (the issue's line numbers had drifted;
these are current):

| # | File:line | Reads | Class |
|---|---|---|---|
| 1 | `src/api/route-table.ts:51` | `GLOBAL_BLOCKS_REGISTRY` | A — fail loud |
| 2 | `src/api/handlers/schema-loading.ts:55` | `SCHEMA_MAP` | A — fail loud |
| 3 | `src/api/handlers/media.ts:42` | `ALLOWED_FILE_TYPES` | B — default |
| 4 | `src/api/handlers/media.ts:115` | `MAX_UPLOAD_BYTES_BY_CATEGORY` | B — default |
| 5 | `src/utils/file-catalog.ts:256` | `CUSTOM_FILE_TYPES` | B — default |
| 6 | `src/routes/admin/media.astro:20` | `ALLOWED_FILE_TYPES` | B — default |
| 7 | `src/routes/admin/client/block-form/file-accept.ts:25` | `ALLOWED_FILE_TYPES` | B — default |

(#116 cited `block-form.ts:964`; the #38 decomposition moved that reader to
`block-form/file-accept.ts`.)

Sites 1 and 2 are **structurally identical**: baked → dev/test filesystem read of
`.astro-blocks/*.mjs` → the same `{ ok: false, reason: 'unresolved' }` union → the same
`console.error` naming ADR-0009/ADR-0025 → a `localizedJsonError(..., 500)` at the caller. Two
independent adapters of one seam is the signal that the seam is real.

## Two classes, not one — and this is why the issue's interface is wrong

#116 proposes a single `readBakedValue<T>({ decode, fallback, onUnresolved })`. Handing every caller
both a `fallback` *and* an `onUnresolved` gives back the exact decision the deep module was supposed
to absorb: "is this key allowed to be missing?" There are two answers, and they are a property of the
**key**, not the call site:

- **Class A** (`GLOBAL_BLOCKS_REGISTRY`, `SCHEMA_MAP`) — absent means a **broken deployment**. There
  is no legitimate fallback; it must fail loudly (ADR-0009, ADR-0025).
- **Class B** (`ALLOWED_FILE_TYPES`, `CUSTOM_FILE_TYPES`, `MAX_UPLOAD_BYTES_BY_CATEGORY`) — absent
  means **dev/test**, and falling back to a documented default is correct.

So: **two functions**, and the class is encoded in which one you call.

## Two more things the issue's interface breaks

**`onUnresolved: () => Response` is not browser-safe.** Two of the seven readers run in the browser
— `file-accept.ts` (via `field-renderers.ts` → the admin `<script>` bundle) and `media.astro`'s
client island. `localizedJsonError` pulls the i18n catalogs; a module that can build a `Response`
drags them into the client bundle. The unresolved *result* must be a plain value the **server**
caller turns into a 500 — not a `Response` the module constructs.

**Class A's fallback is a filesystem read, which is Node-only.** Sites 1 and 2 do not go
baked → fail. They go baked → `import()` of `.astro-blocks/*.mjs` from disk → fail. That middle step
uses `path`, `pathToFileURL` and a dynamic `import()` — none of which can exist in a browser-safe
module. So the deep module absorbs the **mechanism** (double-encode knowledge, the guard, parse,
validate-or-fall) and the **`{ ok: false }` union shape**, but *not* the disk seam and *not* the
`Response`. Those stay at the two server call sites, where they already are.

## The behaviour change, named on purpose

This is filed `refactor`, but unifying the three `ALLOWED_FILE_TYPES` readers **must** change
behaviour, because they do not agree today. `plugin/index.ts:352` permits `allowedFileTypes: []` with
the warning *"all file uploads will be rejected"*, so the empty allowlist is a supported config. With
it:

- `media.ts:42` accepts the empty array (`[].every(...)` is `true`), leaves `resolved = []`, and the
  **server rejects every upload** — the documented behaviour.
- `media.astro:20` and `file-accept.ts:25` require `length > 0`, so both fall to
  `DEFAULT_ALLOWED_FILE_TYPES` and **the admin offers the full catalog**.

A user picks a PNG the picker advertised as valid and the server refuses it. Unifying the readers
fixes this — the panel comes to respect the empty allowlist the way the server does — but that is a
**behaviour change in two of the three sites**, not a reorganisation. Calling it "just a refactor" is
how a refactor breaks production. It is in scope, and it gets its own spec-delta clause and test.

The same unification kills a second latent divergence: `file-accept.ts` and `media.astro` cast
`JSON.parse(raw) as string[]` without checking the elements, so a bake of `[123]` would reach the
`accept` attribute as garbage. Only `media.ts` validates each element. The shared decoder validates
once, for all three.

## Proposed shape

```ts
// src/utils/baked.ts — isomorphic: no node builtins, no i18n, safe in the browser bundle

// Writer. Knows which keys are structured (double-encode) vs scalar (single).
export function defineBakedValue(define: Record<string, string>, key: BakedKey, value: unknown): void

// Class B: absent → the documented default. Isomorphic.
export function readBakedConfig<T>(key: BakedKey, opts: { decode: (parsed: unknown) => T | null; fallback: T }): T

// The decode step both classes share, and the one union shape sites 1+2 stop reinventing.
export type BakedResolution<T> = { ok: true; value: T } | { ok: false; reason: 'unresolved' }
export function decodeBaked<T>(raw: unknown, decode: (parsed: unknown) => T | null): BakedResolution<T>
```

Class A stays in `route-table.ts` and `schema-loading.ts`: they call `decodeBaked`, and on
`{ ok: false }` they keep their existing disk-read fallback, and only if *that* also fails do they
build the 500. The module owns the encode/decode and the union; the server owns the seam and the
`Response`. This is the split ADR-0033 records — and it is exactly what #116's single-function,
`Response`-returning interface would have destroyed.

## Non-goals

- The 6 scalar keys. They are single-encoded and have never had this bug; leaving them as direct
  `import.meta.env` reads keeps the module's surface to the values that actually share the hazard.
- `MAX_UPLOAD_BYTES` (`process.env`, read at boot to allow lowering without a rebuild) — not baked,
  out of scope.
- #121 (decomposing the `astro:config:setup` hook). It *feeds* `defineBakedValue` but is a separate
  change; this one does not touch the hook's structure.
- The `localizedJsonError(..., 500)` responses and the `.astro-blocks/` disk seam — both correct,
  both stay where they are.

## Acceptance criteria

- [ ] `src/utils/baked.ts` exists, is isomorphic (no node builtins, no i18n import), and owns the
      double-encode, the guard, the parse and the `BakedResolution` union.
- [ ] `defineBakedValue` replaces the 5 hand-written structured `vite.define` assignments; a single
      list decides structured-vs-scalar.
- [ ] All 7 structured readers decode through the module (`readBakedConfig` for the 5 class-B sites,
      `decodeBaked` for the 2 class-A sites).
- [ ] The `{ ok: false, reason: 'unresolved' }` union is defined once; `route-table` and
      `schema-loading` import it instead of each declaring it.
- [ ] The admin's `ALLOWED_FILE_TYPES` readers respect an empty allowlist identically to the server,
      with a regression test for the empty-allowlist divergence.
- [ ] Non-string array elements are rejected by the shared decoder (the `[123]` case).
- [ ] A direct unit test exercises encode → decode against a simulated `import.meta.env`; the
      source-regex guard in `schema-map-bake-guard.test.js` is retired or downgraded.
- [ ] `npm run typecheck` + `npm test` + `npm run check` green.
