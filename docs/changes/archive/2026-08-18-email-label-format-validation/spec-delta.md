<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — field format validation (#108)

## ADDED: Stored field grammars (new spec `docs/specs/field-validation.md`)

A new capability spec: certain stored fields have a declared grammar, enforced at **every door**
the value can enter through — the HTTP handlers and the import pipeline — and the grammar lives in
one shared module (`src/utils/field-grammar.ts`) so no door can drift from another.

- **R1 — Email grammar.** `users.email` is valid iff it matches the WHATWG HTML5
  `<input type="email">` grammar and is ≤ 254 characters, evaluated after normalization
  (trim + lowercase). Doors: `POST /cms/api/users` (rejects with localized
  `errors.invalidEmail`) and the users import unit (rejects the archive). Login never
  format-validates: an already-stored legacy value cannot be locked out.
- **R2 — Language label grammar.** `languages.label` is a one-line name: non-empty after trim,
  ≤ 80 characters, no C0/C1 control characters, any other unicode allowed. Doors:
  `POST`/`PUT /cms/api/languages` (localized `errors.invalidLanguageLabel`) and the
  `data/languages.json` file on import. The check runs only when a non-empty label is provided —
  the `label → code` fallback on create is preserved behavior.
- **R3 — Language code grammar at import parity.** The code grammar
  (`/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/`), already enforced by HTTP, is now also enforced on
  `data/languages.json` at import. HTTP behavior unchanged.
- **R4 — Import stays all-or-nothing.** A staged archive violating any grammar is rejected whole
  during `validateStagedImport`, before any live write (ADR-0015 posture: import is not a back
  door past the rules). No migration of pre-existing archives or stored data.

## MODIFIED: Session auth & user store (`docs/specs/session-auth.md`)

User creation gains a format precondition: `POST /cms/api/users` rejects an email that fails R1
(above) with the localized `errors.invalidEmail` body, before password hashing. The duplicate-email
guard, the in-lock re-validation, and every other requirement are unchanged. Login and token
verification are explicitly outside R1's doors.
