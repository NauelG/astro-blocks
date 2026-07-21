<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Compiler-enforced i18n parity + single-source validation messages

## 1. `CatalogKey` and the bidirectional `satisfies`

`CatalogKey` goes in a **leaf module** that imports only `en` — not in `catalogs.ts` (which imports
`es`, so `es → catalogs → es` would be a cycle) and not in `types.ts` (which `en.ts` imports, so
`en → types → en`). A dedicated leaf avoids the question:

```ts
// src/routes/admin/i18n/catalog-key.ts  (new leaf)
import { en } from './en.js';
/** The authoritative catalog key set, derived from en. Every catalog must match it exactly. */
export type CatalogKey = keyof typeof en;
```

```ts
// es.ts — change only the trailing satisfies
import type { CatalogKey } from './catalog-key.js';
export const es = {
  /* … */
} satisfies Record<CatalogKey, string>;   // was: satisfies Catalog & { [K in keyof typeof en]: string }
```

Dependency chain is acyclic: `es → catalog-key → en → block-validation-messages` (a leaf). Verified
under `--strict --module nodenext`: compiles clean, missing key → TS1360, extra key → TS2353. `en.ts`
keeps `satisfies Catalog` — it defines the authoritative key set, and there is nothing to check it
against.

## 2. The shared message module

```ts
// src/utils/block-validation-messages.ts  (new)
/* BSL header */

/**
 * The English validation-message templates, the single source for both the isomorphic validator
 * (utils/block-validation.ts) and the admin catalog (routes/admin/i18n/en.ts).
 *
 * `as const` is load-bearing, not stylistic: a `Record<string, string>` annotation would erase the
 * literal keys, and en.ts spreads this — collapsing `keyof typeof en` to `string` and silently
 * disabling the catalog parity check (ADR-0034). Do not annotate it.
 */
export const BLOCK_VALIDATION_MESSAGES = {
  'blockValidation.fieldRequired': 'Block "{blockName}" (index {blockIndex}): field "{label}" is required.',
  // …all 19, verbatim from today's EN_BLOCK_MESSAGES (the superset)…
  'blockValidation.fieldMustBeFile': 'Block "{blockName}" (index {blockIndex}): field "{label}" must be a file object.',
  'blockValidation.fieldFileNeedsUrl': 'Block "{blockName}" (index {blockIndex}): field "{label}" requires a valid URL.',
} as const;
```

Isomorphic: it is pure data, no `node:*`, no i18n, no catalog import — so `block-validation.ts` stays
importable in the browser bundle without pulling the 677-key catalog.

## 3. `block-validation.ts`

```ts
import { BLOCK_VALIDATION_MESSAGES } from './block-validation-messages.js';
// delete the inline EN_BLOCK_MESSAGES (19 entries) and the "Keep in sync" comment (:239).
// enMessage() reads BLOCK_VALIDATION_MESSAGES[messageKey] ?? messageKey — one identifier rename.
```

No logic changes. `interpolate` / `enMessage` are untouched beyond the source of the table.

## 4. `en.ts`

The 17 inline `blockValidation.*` entries are deleted and replaced by a spread at the top of the
object literal:

```ts
import { BLOCK_VALIDATION_MESSAGES } from '../../../utils/block-validation-messages.js';

export const en = {
  ...BLOCK_VALIDATION_MESSAGES,   // carries all 19 — the 2 previously-missing keys now enter the catalog
  'auth.loading': 'Loading…',
  // … the rest, unchanged …
} satisfies Catalog;
```

`keyof typeof en` still resolves to a literal union (verified: spread of an `as const` object
preserves literal keys). The block-validation section comment in `en.ts` is replaced by a one-line
pointer to the shared module, so a reader knows why those keys are not inline.

## 5. `es.ts` — the two new translations

`es.ts` keeps all `blockValidation.*` **inline in Spanish** (the shared module is English; es is a
different language). It currently has 17; it gains 2, matching the neighbouring register
(`'Bloque "{blockName}" (índice {blockIndex}): el campo "{label}" …'`):

```ts
'blockValidation.fieldMustBeFile':
  'Bloque "{blockName}" (índice {blockIndex}): el campo "{label}" debe ser un objeto de archivo.',
'blockValidation.fieldFileNeedsUrl':
  'Bloque "{blockName}" (índice {blockIndex}): el campo "{label}" requiere una URL válida.',
```

The `fieldFileNeedsUrl` wording mirrors the existing `fieldImageNeedsUrl` Spanish entry for
consistency. Part 1's `Record<CatalogKey, string>` makes these two non-optional: omit either and
`tsc` fails (TS1360). That is the mechanism that stops the drift from recurring.

## 6. Tests

`tests/i18n-catalog.test.js`

- **Remove** the key-parity test (`:24`, "en and es have same keys") — `tsc` now guarantees it, in
  both directions, which the test could only check at runtime.
- **Keep** the value assertions: no empty string in either catalog, all values are strings. These
  assert what the type system does not.

`tests/block-validation.test.js` (or the validation suite) — the bug fix, behaviourally:

- Validate a block whose **file field** is present-but-invalid and whose file field is
  missing-a-URL; assert the emitted `messageKey`s (`fieldMustBeFile`, `fieldFileNeedsUrl`) each
  resolve through `createT('en')` **and** `createT('es')` to a real message, **not** to the raw key.
  This is the assertion that fails on `main` (the keys are absent) and is the regression guard.
- **Every validation message resolves in every catalog** (R7): iterate `Object.keys(
  BLOCK_VALIDATION_MESSAGES)` — the single source, which *is* the set of keys the validator emits
  (verified: the 19 emit sites in `block-validation.ts` correspond one-to-one to the module's 19
  keys) — and assert each resolves through `createT('en')` and `createT('es')` to something other
  than the raw-key sentinel. This iterates the shipped data, not the source text, so it is not the
  fragile source-grep class this change retires. It closes the loop the comment left open.

  Note what this does and does not guard. It guarantees every key in the shared source is localized
  in both languages. It cannot, by itself, prove the validator never emits a key *outside* the shared
  source — a brand-new emit site with a typo'd key would still fall to the raw sentinel. That residual
  is inherent (proving it needs either a source scan or exhaustive branch invocation) and is stated
  rather than papered over; the exact-correspondence was verified once at implementation.

## 7. What is deliberately not touched

- The validator's control flow and the `messageKey`/`params` issue shape.
- `t.ts`'s raw-key fallback — kept as the last-resort sentinel for any future missing key.
- `client.ts`, `resolve.ts`, and every non-`blockValidation` catalog key.
- `SUPPORTED_UI_LOCALES` / adding a locale.
