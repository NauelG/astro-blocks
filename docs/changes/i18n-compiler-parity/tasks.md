<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Compiler-enforced i18n parity + single-source validation messages

Vertical slices. The behavioural bug goes red first (T1); the shared module and the parity mechanism
land (T2–T6); the redundant runtime test is downgraded (T7); the compiler-side parity is *proven* by
a deliberate break (T8); one commit (T9).

`npm test` runs `npm run build` first (`package.json:70`) and tests import from `../dist/…`, so every
verify step is plain `npm test` unless noted. **`npm run typecheck` is load-bearing in this change** —
it is the safety net being installed, so it is a first-class verify step, not an afterthought.

> **The two-file coupling to keep in view.** `en.ts` *spreads* the shared module, so the module must
> stay `as const` — a `Record<string, string>` annotation would collapse `keyof typeof en` to
> `string` and silently disable the parity (ADR-0034). Between T5 (en gains the 2 keys) and T6 (es
> translates them), `tsc` is **red** — that red *is* the parity working, not a mistake. It goes green
> when es catches up.

## T1 — The localization bug, red (behavioural)

- [x] **File:** `tests/block-validation.test.js` — extend the existing "Slice C: file prop type"
  section. It already has `FILE_SCHEMA` / `FILE_SCHEMA_REQUIRED`. Import `createT` from
  `../dist/routes/admin/i18n/t.js`.
  - Produce an invalid file-field issue two ways: a file value that is not an object
    (`{ brochure: 'not-an-object' }` → `fieldMustBeFile`) and a file object without a URL
    (`{ brochure: {} }` → `fieldFileNeedsUrl`).
  - For each, assert `createT('en')(issue.messageKey, issue.params)` **and**
    `createT('es')(issue.messageKey, issue.params)` return a real message — specifically that the
    result is **not equal to `issue.messageKey`** (the raw-key sentinel `t.ts` returns for a missing
    key). On `main` both keys are absent, so this fails.
  - Keep the existing `.message` assertions untouched — the backward-compat English path already works
    and must keep working.
- **Verify:** `npm test` — the two new assertions fail (raw key returned); nothing else changes.

## T2 — The shared message module

- [x] **File:** `src/utils/block-validation-messages.ts` — new, BSL header. Export
  `BLOCK_VALIDATION_MESSAGES` with all **19** templates verbatim from today's `EN_BLOCK_MESSAGES`
  (the superset, which already includes `fieldMustBeFile` / `fieldFileNeedsUrl`), closed with
  **`as const`**.
  - Doc comment states the `as const` is load-bearing (en.ts spreads it; annotating it disables the
    parity — ADR-0034). Isomorphic: no `node:*`, no i18n, no catalog import.
- **Verify:** `npm run typecheck` green (module compiles standalone; nothing consumes it yet).

## T3 — `block-validation.ts` consumes the shared module

- [x] Import `BLOCK_VALIDATION_MESSAGES` and delete the inline `EN_BLOCK_MESSAGES` (19 entries) plus
  its "Keep in sync" comment (`:239`). `enMessage()` reads `BLOCK_VALIDATION_MESSAGES[...]` — an
  identifier rename, no logic change.
- **Verify:** `npm test` — the `.message` (backward-compat) assertions stay green; T1's `messageKey`
  assertions still fail (the catalog is unchanged). The isomorphic module did not pull in a catalog.

## T4 — `CatalogKey` leaf + bidirectional parity on `es`

- [x] **File:** `src/routes/admin/i18n/catalog-key.ts` — new leaf: `import { en }` and
  `export type CatalogKey = keyof typeof en`. Imports only `en` (no cycle).
- [x] `es.ts` — change the trailing `satisfies Catalog & { [K in keyof typeof en]: string }` to
  `satisfies Record<CatalogKey, string>` (import `CatalogKey` from `./catalog-key.js`).
- **Verify:** `npm run typecheck` green — en and es both still have 17 `blockValidation.*` keys, so
  parity holds at this point. (The mechanism is proven under T8.)

## T5 — `en.ts` spreads the shared module (gains the 2 keys)

- [x] Delete the 17 inline `blockValidation.*` entries; add `...BLOCK_VALIDATION_MESSAGES` at the top
  of the `en` object literal (import from `../../../utils/block-validation-messages.js`). Replace the
  removed block's section comment with a one-line pointer to the shared module.
- **Verify:** `npm run typecheck` is now **red** — `en` has 19 `blockValidation.*` keys, `es` has 17,
  so `Record<CatalogKey, string>` reports es missing `fieldMustBeFile` / `fieldFileNeedsUrl` (TS1360).
  **This red is the parity working.** Do not fix it by touching en; fix it in T6.

## T6 — `es.ts` translates the 2 new keys (parity green)

- [x] Add the two Spanish entries inline, matching the neighbouring register
  (`'Bloque "{blockName}" (índice {blockIndex}): el campo "{label}" …'`; mirror the existing
  `fieldImageNeedsUrl` wording for the URL one):
  - `fieldMustBeFile` → `… el campo "{label}" debe ser un objeto de archivo.`
  - `fieldFileNeedsUrl` → `… el campo "{label}" requiere una URL válida.`
- **Verify:** `npm run typecheck` green again, and `npm test` — T1's `messageKey` assertions now pass
  in both `en` and `es`. The bug is fixed.

## T7 — Downgrade the runtime parity test

- [x] `tests/i18n-catalog.test.js` — remove the key-parity test (`:24`, "en and es have same keys"):
  `tsc` now guarantees it bidirectionally. **Keep** the value assertions (no empty string in en/es,
  all values are strings), which the type system does not cover. Update the file's header comment so
  it no longer claims to verify "same keys".
- **Verify:** `npm test` — suite count drops by one test, the kept value tests stay green.

## T8 — Prove the parity, then full verification

- [x] **Deliberate-break check** (do, observe, revert — do not commit the break): add a junk key to
  `es.ts` → confirm `npm run typecheck` fails with TS2353; remove a key from `es.ts` → confirm
  TS1360. This is the acceptance criterion "both directions fail tsc", verified by hand.
- [x] `npm test && npm run typecheck && npm run check` (`biome ci` separate).
- [x] `npm run features:validate`.
- [x] `grep -rn "blockValidation\." src/routes/admin/i18n/en.ts` returns **0** inline entries (they
  come from the spread now); `es.ts` returns 19.
- **Note:** no `npm run e2e` needed — the change is type-level plus two catalog strings; the bug fix
  is covered by the unit test at T1. (State this in the commit, don't silently skip a gate.)

## T9 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `refactor(i18n): compiler-enforce catalog parity and single-source validation messages`
- Body: the two invariants moving from comment to compiler; that Part 2 *fixed a shipped bug*
  (file-field validation errors rendered the raw key `blockValidation.fieldMustBeFile` in both
  languages because two keys had drifted out of the catalog); and the `as const` coupling that makes
  the parity real (ADR-0034). Reference #40, ADR-0034.
- No version bump, no `CHANGELOG` — at release close this is a `patch` with a `### Fixed` line for the
  file-field message bug.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Deviations from the plan (2026-07-21)

- **Verified the 17 shared EN values were byte-identical before spreading.** The plan assumed the
  17 `blockValidation.*` values in `en.ts` matched `EN_BLOCK_MESSAGES`; a diff confirmed they were
  identical, so the spread changes no existing message — it only adds the 2 previously-missing keys.
  Had they differed, the spread would have been a silent behaviour change; it was not.
- **`enMessage` reads the shared const via an `as Record<string,string>` cast.** The module is
  `as const` (literal keys, load-bearing for parity), so indexing it with a runtime `string` needs
  the widening cast. The cast is at the *read site* only; the source stays literal.
- **Caught a self-inflicted lint warning and removed it.** `catalog-key.ts` first used
  `import { en }`; since `en` is used only in `keyof typeof en`, biome's `useImportType` flagged it
  (30 → 31 warnings). Changed to `import type { en }` — back to the 30 baseline, and it makes the
  leaf's type-only nature explicit. Found by diffing the branch's warning set against main, not by
  trusting the total.
- **No e2e run.** The change is type-level plus two catalog strings; the bug fix is covered by the
  unit tests at T1 (messageKey → createT('en'/'es') resolves, not the raw key). Stated here rather
  than silently skipped.

## Review finding (self, during T8)

The deliberate-break check is the acceptance criterion made real: a junk key in `es.ts` → **TS2353**,
a removed key → **TS1360**, revert → clean. The parity is proven by observing the compiler reject
both drift directions, not by asserting the mechanism exists. This is the whole point of #40 — the
safety net is the compiler now, and the check confirms the compiler actually catches what the
comment used to only claim to.

## Review finding (2026-07-21)

Reviewing the diff against the spec-delta confirmed the substance — the parity is bidirectional
(deliberate break: TS1360 + TS2353), the shared source is `as const` and lean, `en.ts` spreads it
with no inline `blockValidation.*` left, `es.ts` translates the 2 new keys, and the 17 pre-existing
EN values were byte-identical before the spread (no silent message change). It found one gap, between
my own design and my implementation.

- **The exhaustive R7 guard the design promised was missing.** `design.md` §6 said to "iterate the
  messageKeys the validator can produce and assert each is in `en`", but the implementation shipped
  only the two behavioural file-branch tests. Verified during review that the correspondence is in
  fact exact — the 19 `issue('blockValidation.*')` emit sites in the validator match the 19 keys in
  the shared module one-to-one, no missing key and no dead template. Added the standing guard the
  design promised, in a **non-fragile** form: it iterates `Object.keys(BLOCK_VALIDATION_MESSAGES)`
  (the shipped data, which the single-source couples to the emit set) and asserts each resolves
  through `createT('en')`/`createT('es')` to a non-raw-key message. +19 tests.
  - Corrected `design.md` §6 to describe the test that shipped, and to state its residual honestly: it
    proves every key in the shared source is localized, but not that the validator never emits a key
    *outside* the source (a new typo'd emit site would still fall to the sentinel). That residual is
    inherent — the same "did you add the string" class — and is named, not hidden.
