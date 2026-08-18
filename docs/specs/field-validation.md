<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Stored field grammars

> Living specification. Describes the format rules certain stored fields must satisfy and the doors
> they are enforced at. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`).
> History: inaugurated by change `email-label-format-validation` (#108).

## Capability

Certain stored fields have a declared grammar, enforced at **every door** a value can enter
through — the HTTP handlers and the import pipeline. All grammars live in one shared module,
`src/utils/field-grammar.ts`, so no door can drift from another. Input validation here is a
domain-correctness rule, not an XSS defense: HTML sinks are handled by output encoding
(`admin-html-rendering.md`, ADR-0022).

## Requirements

- **R1 — Email grammar.** `users.email` is valid iff it matches the WHATWG HTML5
  `<input type="email">` grammar and is at most **254** characters, evaluated after normalization
  (trim + lowercase). Doors: `POST /cms/api/users` (rejects with the localized
  `errors.invalidEmail` body, before password hashing) and the users import unit (rejects the
  archive). Login **never** format-validates — an already-stored legacy value cannot be locked
  out. `PUT /cms/api/users/:id` cannot change email, so it is not a door.
- **R2 — Language label grammar.** `languages.label` is a one-line human-readable name: non-empty
  after trim, at most **80** characters, no C0/C1 control characters, any other unicode allowed.
  Doors: `POST`/`PUT /cms/api/languages` (localized `errors.invalidLanguageLabel`) and the
  `data/languages.json` file on import. The check runs only when a non-empty label is provided:
  the `label → code` fallback on create is deliberate behavior, not an omission.
- **R3 — Language code grammar at import parity.** The code grammar
  (`/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/`), already enforced by the HTTP handlers, is also enforced
  on `data/languages.json` at import. HTTP behavior is unchanged.
- **R4 — Import stays all-or-nothing.** A staged archive violating any grammar is rejected whole
  during `validateStagedImport`, before any live write (ADR-0015 posture: import is not a back
  door past the rules). Import validators keep their `{ ok, reason }` English-prose contract —
  they are not localized. The import validates values **as stored** (no normalization pass), so it
  is deliberately at least as strict as HTTP; legitimate exports only contain
  handler-normalized values.
- **R5 — No migration.** Already-stored data is never rewritten or re-validated in place. The
  grammar gates entry, not existence.

## Scenarios

- `POST /cms/api/users` with `email: "<img src=x onerror=alert(1)>"` → 400, localized
  `errors.invalidEmail`; nothing stored, no hash computed.
- `POST /cms/api/languages` with a two-line or 81-character label → 400, localized
  `errors.invalidLanguageLabel`; with `label: "   "` → created with `label === code`.
- An import archive whose `data/languages.json` carries `code: "<script>"` → the whole archive is
  rejected at staging validation.
- A pre-#108 stored user with a malformed email still logs in.

## Coverage

- `tests/field-grammar.test.js` — the three predicates, accepted and rejected samples per rule.
- `tests/users-handlers.test.js` — R1 at the HTTP door, both locales, 254-cap.
- `tests/languages-handlers.test.js` — R2 at POST and PUT, fallback preserved.
- `tests/import-export-validators.test.js` — R1/R2/R3 at the validator level, `fileValidators`
  wiring.
- `tests/import-export-import-pipeline.test.js` — R4: rejection happens inside
  `validateStagedImport`, valid archives still pass.
