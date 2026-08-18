<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — email/label format validation (#108)

TDD discipline per slice: failing test → minimum code to pass → refactor → commit.

## Slice 1 — the grammar module

- [x] **T1. Predicates, test-first.**
  - Files: `tests/field-grammar.test.js` (new), `src/utils/field-grammar.ts` (new).
  - Red: unit tests for the three predicates — email accepts `a@b.co`, rejects
    `<img src=x onerror=alert(1)>`, whitespace, missing `@`, and a 255-char address; label accepts
    `Español`, `中文`, `Português (BR)` and an 80-char name, rejects empty-after-trim, 81 chars,
    `\n`/`\t`/`\u0000`/`\u009F`; code accepts `es`, `pt-br`, rejects `ES`, `<script>`.
  - Green: implement `isValidEmail` (WHATWG regex + ≤254), `isValidLanguageLabel`,
    `isValidLanguageCode` (regex copied verbatim from `src/api/handlers/languages.ts:61`).
  - Verify: `node --test tests/field-grammar.test.js` passes.

## Slice 2 — email door (HTTP)

- [x] **T2. `POST /users` rejects a malformed email, localized.**
  - Files: `tests/users-handlers.test.js`, `src/api/handlers/users.ts`,
    `src/routes/admin/i18n/en.ts`, `src/routes/admin/i18n/es.ts`.
  - Red: `handlePostUsers` with `email: "<img src=x onerror=alert(1)>"` and with a 255-char email
    → 400, body `errors.invalidEmail` (both locales); a valid email still creates.
  - Green: `isValidEmail` check in `handlePostUsers` after the non-empty check and **before**
    `hashPassword`; add the `errors.invalidEmail` key to both catalogs.
  - Verify: `node --test tests/users-handlers.test.js tests/i18n-api-errors.test.js` passes.

## Slice 3 — label door (HTTP)

- [x] **T3. `POST`/`PUT /languages` reject a malformed label; fallback intact.**
  - Files: `tests/languages-handlers.test.js`, `src/api/handlers/languages.ts`,
    `src/routes/admin/i18n/en.ts`, `src/routes/admin/i18n/es.ts`.
  - Red: POST with label `"x\ny"` or 81 chars → 400 `errors.invalidLanguageLabel`; PUT same;
    POST with empty/absent label still falls back to `code`; PUT with absent label keeps the
    current label.
  - Green: guard in both handlers (only when a non-empty trimmed label arrives); switch the
    inline code regex to `isValidLanguageCode`; add `errors.invalidLanguageLabel` to both catalogs.
  - Verify: `node --test tests/languages-handlers.test.js` passes (existing code-regex cases
    untouched).

## Slice 4 — import doors

- [x] **T4. Users unit validates email format.**
  - Files: `tests/import-export-validators.test.js`, `src/api/import-validate.ts`.
  - Red: `validateUsersUnit` with a user whose email is `"<img src=x>"` → `{ ok: false }` with a
    reason naming the user id; valid unit still passes.
  - Green: `isValidEmail` check after the existing non-empty check.
  - Verify: `node --test tests/import-export-validators.test.js` passes.
- [x] **T5. `data/languages.json` gets a per-file validator, wired into staging validation.**
  - Files: `tests/import-export-validators.test.js`, `tests/import-export-import-pipeline.test.js`,
    `src/api/import-validate.ts`, `src/api/backup.ts`.
  - Red: `validateLanguagesFile` rejects a missing `languages` array, a `code` failing the
    grammar, and a present `label` failing the grammar; accepts a valid file and entries with
    extra keys. Pipeline: `validateStagedImport` over a staged archive whose `languages.json`
    carries `code: "<script>"` → rejected before any write; a valid archive still validates.
  - Green: `validateLanguagesFile` + exported `fileValidators` map in `import-validate.ts`;
    `validateStagedImport` (step 3) consults `fileValidators[dataFile]` after the unit validator.
  - Verify: `node --test tests/import-export-validators.test.js tests/import-export-import-pipeline.test.js` passes.

## Slice 5 — full gate

- [x] **T6. Whole-suite verification.**
  - Verify: `npm run typecheck` · `npm test` · `npx biome ci .` all green; no incidental
    playground/data changes in the diff.
