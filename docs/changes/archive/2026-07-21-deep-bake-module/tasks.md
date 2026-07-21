<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — The deep bake module

Vertical slices. The module and its decoder land first with direct unit tests (T1–T2); the writer
and the 7 readers migrate onto it (T3–T6); the fragile source-regex guard is retired (T7); full
verification including e2e (T8); one commit (T9).

`npm test` runs `npm run build` first (`package.json:70`) and tests import from `../dist/…`, so every
verify step is plain `npm test` unless noted.

> **The one hard constraint, verified.** `import.meta.env` is `undefined` under `node --test` and is
> **per-module** — a test cannot reach the `import.meta.env` that `baked.js` reads. So the round trip
> and every decode branch are tested through `decodeBaked(raw, …)`, which takes the raw string as an
> argument. The `import.meta.env` read stays a thin wrapper proven by e2e, the same stance
> `schema-map-bake-guard.test.js` and ADR-0025 already take. No test seam is added to a production
> signature to dodge this.

## T1 — Module + allowlist-decoder tests (red)

- [x] **File:** `tests/baked.test.js` — new. Imports from `../dist/utils/baked.js`.
  - **round trip**: `defineBakedValue(define, key, value)` writes a string; parsing it as vite would
    (the value is spliced as source, so `JSON.parse` of the define string yields the inner string,
    which `decodeBaked` then `JSON.parse`s again) returns `value`. This is the double-encode contract
    as an executable assertion.
  - **single-encode is rejected**: `decodeBaked` on an array *literal* (what a single stringify emits)
    → `{ ok: false }`. This is the `video/mp4` bug's exact shape.
  - malformed JSON / `undefined` / `''` / wrong shape → `{ ok: false }`, never a throw.
  - **empty structured value resolves**: `"{}"` → `{}`, `"[]"` → `[]` are `{ ok: true }`, not
    fallbacks (spec R6).
- [x] **File:** `tests/file-catalog.test.js` — extend. Tests the shared allowlist validator
    `decodeAllowlist` directly, since all three `ALLOWED_FILE_TYPES` readers will share it.
  - `["image/png"]` → `["image/png"]`; mixed case / whitespace → lowercased, trimmed, deduped.
  - **`[]` → `[]`** (a valid empty allowlist, *not* null — this is the behaviour change: it must not
    trigger a fallback).
  - **`[123]` → `null`** (non-string element rejected, not cast through as garbage).
  - `"not an array"` shape → `null`.
- **Verify:** `npm test` — the new tests fail (`baked.js` and `decodeAllowlist` do not exist).

## T2 — The module (`src/utils/baked.ts`)

- [x] **File:** `src/utils/baked.ts` — new, BSL header. `defineBakedValue`, `decodeBaked`,
  `readBakedConfig`, `readBakedArtifact`, `BakedResolution<T>`, `STRUCTURED_KEYS` per `design.md` §1.
  - **Isomorphic**: no `node:*` import, no i18n import, no `Response`. `decodeBaked` never throws.
  - Doc comment carries the two non-inferable facts: the double-encode reason (moved from
    `plugin/index.ts:580-589`), and that the module owns *how you know* a value is unresolved while
    the caller owns *what unresolved means* (ADR-0033).
- [x] **File:** `tests/baked.test.js` — add the isomorphism guard: assert the built
  `dist/utils/baked.js` source contains no `node:` import and no `handlers/shared` / i18n import. A
  crude source check, but here it *can* fail (unlike the retired schema-map regex): adding such an
  import changes the source deterministically.
- **Verify:** `npm test && npm run typecheck` — the `baked.test.js` round-trip + isomorphism tests
  pass; `file-catalog.test.js`'s `decodeAllowlist` tests still fail (T4 adds it).

## T3 — Writer migration (`src/plugin/index.ts`)

- [x] Replace the 5 structured `vite.define[...] = JSON.stringify(JSON.stringify(...))` assignments
  (`:590-618`) with `defineBakedValue(vite.define, KEY, value)` calls. The 6 scalar assignments stay
  verbatim.
- **Verify:** `npm test` — `plugin-resolve-options.test.js` (which asserts the define strings arrive
  as double-encoded via `assertJsonBridge`) stays green untouched. That suite is the proof the writer
  migration changed nothing observable.

## T4 — The three `ALLOWED_FILE_TYPES` readers (green + behaviour change)

- [x] **File:** `src/utils/file-catalog.ts` — add `export function decodeAllowlist(parsed: unknown):
  string[] | null` (the validator T1 tests: array of non-empty strings → lowercased/trimmed/deduped;
  `[]` → `[]`; anything else → `null`).
- [x] Migrate the three readers to `readBakedConfig('ASTRO_BLOCKS_ALLOWED_FILE_TYPES', { decode:
  decodeAllowlist, fallback: DEFAULT_ALLOWED_FILE_TYPES })`:
  - `src/api/handlers/media.ts:42` (`getAllowedFileTypes`) — then the existing catalog intersection
    (ADR-0023) is unchanged.
  - `src/routes/admin/media.astro:20` — **behaviour change**: drops the `length > 0` check, so `[]`
    is honoured (offer nothing) instead of falling back to the full catalog.
  - `src/routes/admin/client/block-form/file-accept.ts:25` — same behaviour change, and drops the
    `as string[]` cast.
- [x] **File:** `tests/media-handlers.test.js` (or the allowlist suite) — the behaviour-change test:
  with `decodeAllowlist([])` the resolved list is empty on all three paths' shared decoder. The
  end-to-end "server rejects all AND panel offers none" is covered by e2e in T8; here assert the
  shared decoder, which is what makes the three agree.
- **Verify:** `npm test` — `decodeAllowlist` tests pass; `allowed-file-types.test.js` stays green
  (its only env case is the `undefined`→fallback path, unaffected).

## T5 — The other two class-B readers

- [x] `src/utils/file-catalog.ts:256` (`resolveCatalog`, `CUSTOM_FILE_TYPES`) and
  `src/api/handlers/media.ts:115` (`getCategoryPolicy`, `MAX_UPLOAD_BYTES_BY_CATEGORY`) →
  `readBakedConfig` with their existing per-entry validators as the `decode` callback. **No behaviour
  change** — these were already the strict readers.
- **Verify:** `npm test` — media + catalog suites green.

## T6 — The two class-A readers (fail-loud, shared union)

- [x] `src/api/route-table.ts:51` and `src/api/handlers/schema-loading.ts:55` — replace the baked
  head with `readBakedArtifact(KEY, decode)`; on `decoded.ok` return the value, else fall through to
  the **unchanged** disk read → `console.error` → `{ ok: false, reason: 'unresolved' }`.
- [x] `RegistryResult` / `SchemaMapResult` re-use `BakedResolution`'s `{ ok: false; reason:
  'unresolved' }` arm imported from `baked.ts`, so the union is declared once (acceptance criterion).
- [x] The `localizedJsonError(..., 500)` responses and the disk seam are **untouched**.
- **Verify:** `npm test` — `registry-resolution.test.js` and the schema-map suites green; the union
  change is type-level and must not alter the 500 behaviour.

## T7 — Retire the source-regex guard

- [x] `tests/schema-map-bake-guard.test.js` — the round trip in `baked.test.js` is the real assertion
  it stood in for (its own tail comment concedes a source grep "cannot fail" reliably). Delete it, or
  downgrade to a one-line pointer at `baked.test.js`. Prefer delete; note the choice in the commit.
- **Verify:** `npm test` — suite count drops by the retired tests, nothing else changes.

## T8 — Full verification

- [x] `npm test && npm run typecheck && npm run check` (`biome ci` is a separate gate).
- [x] `npm run features:validate`.
- [x] `npm run e2e` — the standalone server resolves registry + schema map with no `.astro-blocks/`
  beside it (the class-A behavioural proof), and the media/upload flows exercise the allowlist.
  Rebuild the playground first (`npm run build:playground`) or it tests a stale `dist`. **Port 4321
  must be free** — a stray `astro dev` there makes `reuseExistingServer` test the wrong app.
- [x] Confirm every structured reader goes through the module: `grep -rn "readBakedConfig\|readBaked
  Artifact\|decodeBaked" src/` shows 7 reader sites + the module; no `JSON.parse` of a raw
  `import.meta.env.ASTRO_BLOCKS_*` survives outside `baked.ts`.

## T9 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `refactor(plugin): make the bake a deep module (defineBakedValue/readBaked*)`
- Body: the shallow-interface problem and its three-incident record; that the module is isomorphic
  and returns a union rather than a `Response` (so the two browser readers stay clean, ADR-0033); and
  that this also **fixes** the empty-allowlist divergence between the admin and the server — a
  behaviour change, not a pure refactor, called out explicitly. Reference #116, ADR-0033.
- No version bump, no `CHANGELOG` — those happen only when the human asks to close (`AGENTS.md`
  *Versionado*). At close this is a `patch` (a refactor plus a contained fix, no new capability); the
  empty-allowlist fix earns a `### Fixed` line.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Deviations from the plan (2026-07-21)

Small, all recorded rather than worked around.

**The behaviour-change test landed in `file-catalog.test.js`, not `media-handlers.test.js`.** The
plan (T4) named the media suite, but the honest unit-testable seam is the shared validator
`decodeAllowlist`, which lives in `file-catalog.ts`. Testing it there (`[]` → `[]`, `[123]` → `null`)
is what proves all three readers agree, since all three import it. The end-to-end "server rejects all
AND panel offers none" is proven by e2e, exactly as `design.md` §6 states — the `import.meta.env`
path is not unit-reachable. No test was placed where it could not actually assert what it claimed.

**T7 (retiring the guard) happened during T3, not after T6.** Removing `defineBakedValue`'s literal
`vite.define['import.meta.env.…']` text made `schema-map-bake-guard.test.js` go red immediately — it
greps the plugin source for exactly that string. That is the test proving its own thesis (a source
grep tracks text, not behaviour), so it was deleted the moment it failed rather than left red across
three tasks. `baked.test.js`'s round trip is the real assertion it stood in for.

**The schema-map validator was pinned to the *old* guard exactly.** `readBakedArtifact`'s decode for
`SCHEMA_MAP` uses `parsed && typeof parsed === 'object'` — matching the prior check verbatim, not the
stricter `!Array.isArray` I first wrote. Tightening it would have been an undeclared behaviour change
in a refactor whose only declared change is the empty-allowlist agreement.

**Warnings dropped 36 → 30.** Migrating the readers removed four `biome-ignore lint/suspicious/
noExplicitAny` comments (the `(import.meta as any)` casts), since `baked.ts` narrows through `unknown`
once. Incidental, and in the ratchet's favour (#65).

### Coverage note

`readBakedConfig` / `readBakedArtifact` themselves — the one-line glue that reads `import.meta.env` —
are not unit-covered, by design (`design.md` §5): that read is unreachable under `node --test`. They
are proven by the e2e, where the standalone server resolves the registry and schema map with no
`.astro-blocks/` present, and the upload flows exercise the allowlist. This is stated, not hidden.

## Review finding (2026-07-21)

Reviewing the diff against `spec-delta.md` confirmed the substance — one decoder for all 7 readers,
the class-A disk fallback and 500s untouched, `media.ts`/`schema-loading`/`route-table` behaviour
preserved case by case, the union defined once. It found one real defect, in a claim I had written.

- **`accept=""` means accept-anything, not "offer nothing".** The spec-delta and ADR-0033 claimed an
  empty allowlist makes the admin picker "offer nothing, matching the server". It does not:
  `decodeAllowlist([])` → `[]` → `[].join(',')` → `accept=""`, which HTML treats as *accept-anything*
  at the OS file dialog (`media.astro:99`; the block-form picker's `data-file-accept` is the same via
  `intersectAccept(def.accept, [])` → `[]`). So for `allowedFileTypes: []` the picker offers **more**
  than before (all types vs the old 6 defaults), not nothing. The server still rejects every upload —
  `accept` was never the gate — so it is a cosmetic mismatch, not a security or data issue.
  - Resolution (user decision): correct the over-claim rather than build UI to truly disable the
    dropzone. The refactor's delivered value is the single shared decoder (no per-reader drift) and
    the rejection of malformed elements (`[123]`), not a picker that offers nothing for an empty
    allowlist. spec-delta, ADR-0033, and the `media.astro` / `file-accept.ts` comments are corrected
    to say `accept` is a best-effort picker hint and the server is the enforcement point.

**Worth naming:** the false claim passed every gate — 1311 tests, typecheck, biome, 14 e2e — because
no test asserted the *admin picker's* empty-allowlist output (the `import.meta.env` read is not
unit-reachable, and the e2e uses a non-empty allowlist). It was found by tracing what `[].join(',')`
actually renders, not by re-reading the claim that said otherwise.
