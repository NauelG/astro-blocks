<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Compiler-enforce i18n parity and single-source the validation messages

_Resolves [#40](https://github.com/NauelG/astro-blocks/issues/40) (P1, refactor + a surfaced bug).
Grilled 2026-07-21._

## Problem

Two invariants in the admin i18n layer are "guarded by a comment, not the compiler" — and one of the
comments has already failed, shipping a live localization bug.

### Part 1 — Catalog parity is only half compiler-enforced

`en.ts` is the key authority. `es.ts` must carry exactly the same keys. Today:

- `es.ts:689` ends with `satisfies Catalog & { [K in keyof typeof en]: string }`. This **already**
  catches a *missing* key (es lacking an en-key) — verified empirically (TS1360). The issue's
  description, written against an earlier `satisfies Catalog`, is stale on this point.
- It does **not** catch an *extra* key. `Catalog = Record<string, string>` admits any string key, so
  a dead `es`-only key passes `tsc` — verified empirically (no error).
- The `i18n-catalog.test.js` runtime test checks *both* directions. So the compiler enforces half of
  what a test enforces fully: parity still rests on the test.

### Part 2 — The validation messages are hand-copied, and the copy has drifted

`utils/block-validation.ts` carries `EN_BLOCK_MESSAGES`, English templates it uses to build the
backward-compat flat `message` string. A comment (`:239`) says *"Keep in sync with blockValidation.\*
keys in en.ts"*. It is not in sync:

| | count |
|---|---|
| `blockValidation.*` keys in `en.ts` | 17 |
| keys in `EN_BLOCK_MESSAGES` | 19 |

The two extra — `fieldMustBeFile` and `fieldFileNeedsUrl` — are **emitted by the validator** as
`messageKey`s (`block-validation.ts:438, 451, 471, 481, 491`) but absent from `en.ts` and `es.ts`.

**This is a live, user-visible bug.** The admin renders a validation issue via
`ct(issue.messageKey, issue.params)` (`page-editor.ts:549`), and `t()` falls back to the **raw key as
a visible sentinel** when it is missing (`t.ts:30`). So when a **file-type block field** fails
validation ("must be a file object" / "requires a valid URL"), the page editor shows the literal
string `blockValidation.fieldMustBeFile` — in **both** English and Spanish. The backward-compat
`.message` is correct (it uses `EN_BLOCK_MESSAGES`); the admin path, which prefers `messageKey`, is
not. The comment-based safety net failed exactly where the issue predicts.

## Why the duplication exists (and why the naive fix is wrong)

`block-validation.ts` is **isomorphic** — imported by server code (`utils/blocks.ts`,
`api/handlers/global-blocks.ts`) *and* by the browser admin bundle (`page-editor.ts`,
`block-form/*`, `global-blocks-editor.ts`). If it imported `en.ts`, it would pull the entire 677-key
admin catalog into every one of those bundles. So the templates were copied to keep the isomorphic
module lean. That is a real layering reason, the same isomorphic boundary as ADR-0033 — not laziness.

This rules out the issue's phrasing "derive one from the other" done naively:

- **block-validation imports en.ts** → drags the 677-key catalog into browser/server bundles. No.
- **en.ts imports a `Record<string,string>` from block-validation** → spreading a value typed as
  `Record<string, string>` collapses `keyof typeof en` to `string`, which **destroys Part 1's
  compile-time parity**. Verified: the parity only holds if the shared keys stay *literal*.

## Proposal

**Part 1 — bidirectional parity at the type level.**

```ts
// types.ts (or catalogs.ts)
export type CatalogKey = keyof typeof en;
```
```ts
// es.ts — was: satisfies Catalog & { [K in keyof typeof en]: string }
} satisfies Record<CatalogKey, string>;
```

Empirically, `Record<CatalogKey, string>` rejects a missing key (TS1360) **and** an extra key
(TS2353). `en.ts` stays `satisfies Catalog` — it is the authority that *defines* the key set.

**Part 2 — one isomorphic source for the validation templates, with literal keys.**

```ts
// src/utils/block-validation-messages.ts  (new, isomorphic, ~19 lines of data)
export const BLOCK_VALIDATION_MESSAGES = {
  'blockValidation.fieldRequired': 'Block "{blockName}" (index {blockIndex}): …',
  // …all 19, including fieldMustBeFile and fieldFileNeedsUrl…
} as const;   // as const, NOT `: Record<string,string>` — literal keys are load-bearing for Part 1
```

- `block-validation.ts` imports it as `EN_BLOCK_MESSAGES`; the module stays lean (no catalog).
- `en.ts` spreads it into the catalog: `export const en = { ...BLOCK_VALIDATION_MESSAGES, /* rest */ }
  satisfies Catalog`. The 17 inline `blockValidation.*` entries are removed — the spread replaces
  them, and it carries all **19**, so the two missing keys enter the catalog.
- `es.ts` translates all 19 inline in Spanish (its existing 17 + the 2 new). Part 1's
  `Record<CatalogKey, string>` **forces** the 2 to exist, so the bug cannot silently return.

Empirically verified end to end: `as const` + spread + `Record<CatalogKey, string>` preserves literal
keys and enforces parity in both directions.

**The bug fix.** Adding the 2 keys to the catalog means file-field validation errors render a real
localized message instead of the raw key, in both languages. This is a **declared behaviour change**,
with a test — not a silent side effect of a refactor.

**The runtime test.** `i18n-catalog.test.js`'s key-parity assertion (`:24`) becomes redundant with
the compiler and is removed; its value checks (no empty string, all values are strings — which `tsc`
does not cover) are kept. A test should assert what the compiler cannot, not duplicate it.

## Non-goals

- The validator's logic — only the templates it consumes move.
- `client.ts` and the rest of the en/es catalogs beyond the `blockValidation.*` subset.
- The `t.ts` raw-key fallback — it stays as the last-resort sentinel for any *future* gap.
- Adding a third UI locale, or any change to `SUPPORTED_UI_LOCALES`.

## Acceptance criteria

- [ ] `type CatalogKey = keyof typeof en` exists; `es.ts satisfies Record<CatalogKey, string>`. A
      missing **or** extra key in `es.ts` fails `tsc` (both verified by a deliberate break during dev).
- [ ] `src/utils/block-validation-messages.ts` is the single source of the ~19 templates, `as const`,
      isomorphic (no i18n/catalog import). `block-validation.ts` and `en.ts` both consume it.
- [ ] `en.ts` no longer hand-lists `blockValidation.*`; it spreads the shared module, and
      `keyof typeof en` still resolves to a literal key union (parity still compiles).
- [ ] `fieldMustBeFile` and `fieldFileNeedsUrl` are in `en.ts` and `es.ts`; a file-field validation
      error renders a localized message, not the raw key. Covered by a test.
- [ ] `i18n-catalog.test.js` key-parity assertion removed; value assertions kept.
- [ ] `npm run typecheck` + `npm test` + `npm run check` green.
