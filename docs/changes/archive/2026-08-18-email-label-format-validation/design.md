<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — field grammars shared between handlers and import

## The shared grammar module

New file `src/utils/field-grammar.ts` — one module, three predicates, zero dependencies:

```ts
export function isValidEmail(email: string): boolean;
export function isValidLanguageLabel(label: string): boolean;
export function isValidLanguageCode(code: string): boolean;
```

- `isValidEmail` — the WHATWG HTML5 `<input type="email">` regular expression
  (`/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/`)
  plus `email.length <= 254`. Linear-time, no ReDoS.
- `isValidLanguageLabel` — non-empty after trim, `label.length <= 80`, and no C0/C1 control
  characters (`/[\u0000-\u001F\u007F-\u009F]/` must not match). Any other unicode is fine.
- `isValidLanguageCode` — the regex currently inlined at `src/api/handlers/languages.ts:61`
  (`/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/`) **moves** here; the handler imports it. Behavior unchanged.

Callers validate the already-normalized value (post trim/lowercase). The module states grammar
only — it never trims, lowercases, or localizes.

## HTTP handlers

- `src/api/handlers/users.ts` (`handlePostUsers`): after the existing non-empty check,
  `if (!isValidEmail(email)) return localizedJsonError(request, 'errors.invalidEmail')`.
  Placed **before** `hashPassword` — no point paying the slow hash for a rejected payload.
- `src/api/handlers/languages.ts`:
  - `handlePostLanguages`: when `body.label` is a non-empty string after trim, reject invalid
    grammar with `errors.invalidLanguageLabel`. Empty/absent label keeps falling back to `code`.
  - `handlePutLanguage`: same check when a non-empty `body.label` arrives; absent/empty keeps
    `current.label` as today.
  - The `code` check switches to `isValidLanguageCode` (import from the shared module).

## Import validators (`src/api/import-validate.ts`)

- `validateUsersUnit`: after the non-empty email check, add
  `isValidEmail(...)` → `reason: 'user "<id>": invalid email format'`.
- New `validateLanguagesFile(data)`: requires `{ languages: [...] }`; each entry must be an object
  with a `code` string passing `isValidLanguageCode`, and — when a `label` key is present — a
  string passing `isValidLanguageLabel`. Lenient about other keys (matches the unit validators'
  structural style).
- **Wiring:** the unit-level loop in `src/api/backup.ts` (`validateStagedImport`, step 3) runs one
  validator per unit against *every* file of that unit, which is why `configuration` accepts
  anything. Add a per-file map exported from `import-validate.ts`:

  ```ts
  export const fileValidators: Record<string, (data: unknown) => ValidationResult> = {
    'data/languages.json': validateLanguagesFile,
  };
  ```

  `validateStagedImport` consults `fileValidators[dataFile]` after the unit validator for each
  staged file. No shape-sniffing inside `validateConfigurationUnit`; the file path is the honest
  discriminator. Import validators keep their existing `{ ok, reason }` English-prose contract
  (not localized) — same as every other reason string.

## i18n

New keys in `src/routes/admin/i18n/en.ts` and `es.ts`:

- `errors.invalidEmail` — en: `Invalid email address.` · es: `Dirección de email no válida.`
- `errors.invalidLanguageLabel` — en: `Invalid language label. Use a single line of up to 80
  characters.` · es: `Etiqueta de idioma no válida. Usa una sola línea de hasta 80 caracteres.`

## Tests (node:test, `withTempProject`)

- `tests/field-grammar.test.js` — unit-tests the three predicates: accepted and rejected samples
  per rule (markup-in-email, >254 email, unicode label accepted, control-char label rejected,
  >80 label rejected).
- Handler door: `POST /users` with `<img src=x onerror=alert(1)>` email → 400
  `errors.invalidEmail`; `POST`/`PUT /languages` with a control-character or 81-char label → 400
  `errors.invalidLanguageLabel`; empty label on `POST` still falls back to `code`.
- Import door: a staged archive with an invalid user email → rejected; `data/languages.json` with
  an invalid `code` or `label` → rejected; a valid archive still imports.

## Explicitly unchanged

- `handlePutUser` (email not updatable), login/auth format handling, stored data, the
  all-or-nothing import contract, and the `label → code` fallback.
