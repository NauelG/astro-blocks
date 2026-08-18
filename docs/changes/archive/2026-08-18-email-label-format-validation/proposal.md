<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — `users.email` and `languages.label` get a real grammar, at every door

_Resolves [#108](https://github.com/NauelG/astro-blocks/issues/108). Grilled 2026-08-18._

## The problem

Two stored fields accept anything that is a non-empty string:

- `users.email` (`src/api/handlers/users.ts:35`) — only `trim().toLowerCase()` plus a non-empty
  check. `POST /cms/api/users` with `email: "<img src=x onerror=alert(1)>"` stores that verbatim.
  An email field that accepts markup is wrong on its own merits, independently of any sink
  (the stored-XSS sink itself was fixed in #99 — this is the domain-correctness half).
- `languages.label` (`src/api/handlers/languages.ts:56,105`) — free-form text with only a trim,
  on both `POST` and `PUT`.

And the import path is a wider hole than the issue described: `validateUsersUnit` only requires a
non-empty email string, and the `configuration` unit (which carries `data/languages.json`) accepts
**any non-null object** — so on import, not even the language-`code` regex that HTTP enforces is
applied. ADR-0015 exists precisely so a bootstrap zip is not a back door past the rules.

## Agreed rules

1. **`users.email`** is valid iff it matches the WHATWG HTML5 `<input type="email">` grammar and is
   at most **254** characters, checked after the existing `trim().toLowerCase()`. The browser-side
   form and the server agree by construction. Doors: `POST /cms/api/users` and import.
   (`PUT` cannot change email — verified; login never validates format, so a legacy record cannot
   be locked out.)
2. **`languages.label`** is a one-line human-readable name: any printable unicode, **no C0/C1
   control characters**, at most **80** characters after trim. Applied on `POST` and `PUT` only
   when a non-empty label is provided — the existing `label → code` fallback on create is a
   deliberate feature and stays. Doors: `POST`/`PUT /cms/api/languages` and import.
3. **Import parity.** `validateUsersUnit` gains the email grammar; the `configuration` unit gains a
   per-file validator for `data/languages.json` covering structure, the existing `code` regex, and
   the new `label` grammar. Import stays all-or-nothing: an archive violating any rule is rejected
   whole, with no migration (repo breaking-change policy).

## Non-goals

- Not the XSS fix — that was #99, at the sink. This change owes nothing to any sink.
- No validation at login, and no migration or rewriting of already-stored data.
- No grammar for other free-text fields (site title, menu labels, …) — out of #108's scope.
- No ADR: the rules are reversible, unsurprising, and not the result of a hard trade-off.

## Deliverables

- Shared grammar module used by both the HTTP handlers and the import validators.
- New localized error keys (`errors.invalidEmail`, `errors.invalidLanguageLabel`) in `en`/`es`.
- Tests: one rejected payload per rule, on both the HTTP and the import doors.
- Glossary entries for *User email* and *Language label* in `docs/CONTEXT.md`.
