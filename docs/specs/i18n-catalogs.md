<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Admin i18n catalogs: parity and single-source validation messages

> Living specification. Describes how the admin panel's translation catalogs stay in parity and how
> block-validation messages are sourced. Changed via the cycle's `spec-delta.md` mechanism (see
> `AGENTS.md`). History: inaugurated by change `i18n-compiler-parity` (#40, ADR-0034), which moved
> both invariants from a comment to the compiler and fixed a file-field localization bug that the
> drifted comment had shipped.

## Capability

The admin panel renders in a fixed set of UI locales (`SUPPORTED_UI_LOCALES` = `en`, `es`). `en` is
the **key authority**; every other catalog must carry exactly its keys. Block-validation messages
have **one source**, shared between the isomorphic validator and the catalog. Both invariants are
enforced by `tsc`, not by a runtime test or a comment — the difference this spec exists to record,
because the comment version had already failed silently in production.

---

## Requirements

- **R1 — `en` is the key authority.** `en.ts` defines the full key set as an object literal
  (`satisfies Catalog`). `type CatalogKey = keyof typeof en` (in the leaf `catalog-key.ts`, which
  imports only `en`) derives from it.

- **R2 — Every non-authority catalog matches the key set exactly, at compile time.** `es.ts` ends
  with `satisfies Record<CatalogKey, string>`. A **missing** key fails `tsc` (TS1360); an **extra**
  key fails `tsc` (TS2353). Parity is total and compiler-enforced in both directions — not the one
  direction the earlier `satisfies Catalog & { [K in keyof typeof en]: string }` caught, and not the
  runtime-test-only guarantee it leaned on. `Catalog = Record<string, string>` is why the earlier
  form admitted extra keys; `CatalogKey` is a closed literal union, which does not.

- **R3 — The runtime catalog test asserts only what the compiler cannot.** `i18n-catalog.test.js`
  keeps the value-level checks (no key maps to an empty string; all values are strings; `es` is
  actually translated; expected namespaces exist) and does **not** re-check key parity — that would
  duplicate R2 and invite a reader to stop trusting the compiler.

- **R4 — Block-validation messages have a single source.** The English templates the validator emits
  live once, in `src/utils/block-validation-messages.ts`. The isomorphic validator
  (`utils/block-validation.ts`) imports them; the admin catalog (`en.ts`) spreads them. There is no
  second hand-maintained copy kept in sync by a comment.

- **R5 — The shared module keeps literal keys, and this is load-bearing.** It is `as const`, never
  annotated `Record<string, string>`. `en.ts` spreads it, so annotating it would collapse `keyof
  typeof en` to `string` and silently disable R2 — the compiler would stop checking parity and every
  test would stay green. This coupling is not visible from either file alone (ADR-0034); the `as
  const` carries a comment naming the consequence.

- **R6 — The validator's messages are lean by construction.** `block-validation.ts` is isomorphic —
  imported by the browser admin bundle and by server handlers — so it must not import the admin
  catalog (~677 keys). The shared module carries only the validation templates and no i18n
  machinery, so importing it drags nothing extra into a bundle (the same layer boundary as ADR-0033).

- **R7 — Every `messageKey` the validator can emit resolves in every catalog.** Because the validator
  and the catalog share R4's source, a key the validator produces is a key the catalog has, in both
  languages (R2). The admin renders a validation issue via `ct(issue.messageKey, issue.params)`;
  `t()` falls back to the raw key as a visible sentinel when a key is missing, and `ct()` also emits a
  development-only warning. This is the localization bug this spec's change fixed for file-field
  errors.

- **R8 — A client module obtains its strings through `ct`.** Client-side admin text resolves in the
  browser, by catalog key. No `.astro` page publishes already translated strings to a client module.
  The key is the only identifier of a string and exists in one place: the catalog. (ADR-0039)

- **R9 — The i18n bridge transports data, never translated strings.** The two-script pattern remains
  the correct way to pass page data to a client module — `window.getCmsUiLocale()` is its live
  example and is R8's foundation. It must not carry text resolved by SSR: the `.astro` object and the
  client type sit on opposite sides of a boundary that `tsc` cannot verify, and hand-maintained key
  lists can silently diverge.

- **R10 — An unresolved client key is noisy in development.** The raw-key fallback remains visible in
  every build. `ct()` additionally warns in a Vite development build. It is silent in a consumer
  production bundle: end-user consoles must not carry diagnostics they cannot act on.

- **R11 — Client and SSR resolve the same UI locale.** `resolveUiLocale` chooses the locale once on
  the server with precedence cookie → `Accept-Language` → `en`; `layout.astro` publishes that value
  and `ct()` reads it. A visitor without a cookie and with `Accept-Language: es` sees both SSR and
  client text in Spanish.

## Scenarios

- **S-1 — A file-field validation error is localized, not raw.** A block whose file field is invalid
  (not a file object → `fieldMustBeFile`; missing a URL → `fieldFileNeedsUrl`) produces a
  `messageKey` that, through `createT('en')` and `createT('es')`, yields a real localized message —
  never the raw key. Before change `i18n-compiler-parity`, both keys were absent from the catalogs
  and the admin showed the literal `blockValidation.fieldMustBeFile` in both languages.

- **S-2 — Drift fails the build.** Removing a key from `es.ts` fails `tsc` (TS1360); adding a key
  `es.ts` has that `en.ts` lacks fails `tsc` (TS2353). Neither can reach a green build.

- **S-3 — An editor resolves Spanish in the browser.** `/cms/languages`, `/cms/users`, and
  `/cms/import-export` load without a locale cookie under `Accept-Language: es`. Text written by
  their client modules is Spanish, not a raw key.

- **S-4 — A missing key remains visible and becomes audible in development.** A module calls `ct()`
  with a key outside the catalog. The UI receives the raw key in every build; Vite development also
  emits a warning naming it, while a consumer production bundle does not.

## Coverage

- Compile-time: R1, R2, R5 — proven by a deliberate break during development (TS1360 for a missing
  key, TS2353 for an extra one), and standing on every `npm run typecheck`.
- `tests/i18n-catalog.test.js` — R3: value quality and `es`-is-translated, the checks the type system
  does not cover.
- `tests/block-validation.test.js` — R7/S-1: the file-branch regression tests (raw key on `main`),
  plus a guard that iterates `Object.keys(BLOCK_VALIDATION_MESSAGES)` and asserts each resolves
  non-raw in both languages. This iterates the shipped data, not source text, so it is not the
  fragile source-grep class this change retired.
- `e2e/admin-i18n-es.spec.ts` — R8/R11/S-3: loads the three migrated editors without a locale cookie
  under Spanish `Accept-Language`, then asserts text written by each client module. This distinguishes
  a resolved string from a raw key, which the former bridge failure did accidentally by throwing.
- `tests/import-export-admin-ui.test.js` — R9: the three migrated editors import `ct()` and none may
  read a `window.__cms*I18n` global or hide an i18n bridge cast.

## Boundaries & residual

- The R7 guard proves every key in the shared source is localized. It does **not** prove the
  validator never emits a key *outside* the shared source — a brand-new emit site with a mistyped key
  falls to the raw-key sentinel and its development warning. That residual is inherent (closing it
  needs a source scan or exhaustive branch invocation, neither cheap nor non-fragile); the exact
  emit-to-source correspondence was verified once at change time (19 emit sites ↔ 19 keys).
- Adding a third locale changes nothing here: the new catalog declares `satisfies Record<CatalogKey,
  string>` like `es` and inherits bidirectional parity. The authority stays `en`.
- The `t.ts` raw-key fallback is kept deliberately as the last-resort sentinel — R7 makes it
  unreachable for known keys, and it remains the visible failure mode for any future gap. R10 makes
  it audible during development; it does not make `ct(key: string)` type-safe. That cross-layer type
  question is tracked separately in #173.
