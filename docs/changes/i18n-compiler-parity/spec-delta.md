<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Compiler-enforced i18n parity

There is no living spec for the admin i18n layer today, so this **adds** one. It records the two
invariants the change makes compiler-guaranteed, so a future reader knows they are load-bearing and
not incidental.

## ADDED: new spec `docs/specs/i18n-catalogs.md`

### Capability

The admin panel renders in a fixed set of UI locales (`SUPPORTED_UI_LOCALES` = `en`, `es`). `en` is
the **key authority**; every other catalog must carry exactly its keys. Block-validation messages
have **one source** shared between the isomorphic validator and the catalog. Both invariants are
enforced by `tsc`, not by a runtime test or a comment.

### Requirements

- **R1 — `en` is the key authority.** `en.ts` defines the full key set as an object literal
  (`satisfies Catalog`). `type CatalogKey = keyof typeof en` (in the leaf `catalog-key.ts`) derives
  from it.

- **R2 — Every non-authority catalog matches the key set exactly, at compile time.** `es.ts` ends
  with `satisfies Record<CatalogKey, string>`. A **missing** key fails `tsc` (TS1360); an **extra**
  key fails `tsc` (TS2353). Parity is therefore total and compiler-enforced in both directions — not
  the one direction the earlier `satisfies Catalog & { [K in keyof typeof en]: string }` caught, and
  not the runtime-test-only guarantee it leaned on.

- **R3 — The runtime catalog test asserts only what the compiler cannot.** `i18n-catalog.test.js`
  keeps the value-level checks (no key maps to an empty string; all values are strings) and does
  **not** re-check key parity — that would duplicate R2. A test that asserts what the compiler
  guarantees is noise that invites you to stop reading the compiler.

- **R4 — Block-validation messages have a single source.** The English templates the validator emits
  live once, in `src/utils/block-validation-messages.ts`, `as const`. The isomorphic validator
  (`utils/block-validation.ts`) imports them directly; the admin catalog (`en.ts`) spreads them.
  There is no second hand-maintained copy kept in sync by a comment.

- **R5 — The shared module keeps literal keys, and this is load-bearing.** It is `as const`, never
  annotated `Record<string, string>`. `en.ts` spreads it, so annotating it would collapse `keyof
  typeof en` to `string` and silently disable R2. This coupling is why the two live where they do
  (ADR-0034).

- **R6 — The validator's messages are lean by construction.** `block-validation.ts` is isomorphic —
  imported by the browser admin bundle and by server handlers — so it must not import the admin
  catalog (677 keys). The shared module carries only the ~19 validation templates and no i18n
  machinery, so importing it drags nothing extra into a bundle.

- **R7 — Every `messageKey` the validator can emit resolves in `en`.** Because the validator and the
  catalog share R4's source, a key the validator produces is a key the catalog has. The admin renders
  a validation issue via `ct(issue.messageKey, issue.params)` and would otherwise show the raw key as
  a visible sentinel (`t.ts`), which is the localization bug this change fixes for file-field errors.

### Scenario

- A block whose **file field** is invalid (not a file object, or missing a URL) produces
  `messageKey` `blockValidation.fieldMustBeFile` / `fieldFileNeedsUrl`. Resolved through
  `createT('en')` and `createT('es')`, each yields a real localized message — never the raw key.
  Before this change both keys were absent from the catalogs and the admin showed the raw key in both
  languages.

## Behaviour change

Adding `fieldMustBeFile` and `fieldFileNeedsUrl` to `en.ts`/`es.ts` changes what a file-field
validation error renders in the admin: a localized sentence instead of the literal string
`blockValidation.fieldMustBeFile`. This is a bug fix carried by the refactor, declared here and
covered by a regression test, not a silent side effect.
