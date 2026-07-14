<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0022 — Admin HTML escaping is enforced by a source guard, not by the linter

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Nauel Gómez
- **Source:** issue #99 (stored XSS in `languages.astro` / `users.astro`), found while verifying ADR-0011

## Context

ADR-0011 established a single canonical, context-aware HTML escaper (`escapeHtml` / `escapeAttr` in
`src/utils/html-escape.ts`) and repointed every admin client call site at it. That decision answered
**which** escaper exists. It did not answer **how the codebase is kept honest about using it** — and
the gap was not theoretical. Issue #99 found five stored-XSS sinks that had shipped through a green
CI, in code that ADR-0011's own header comment claimed to cover ("the single canonical HTML-escaping
pair for the whole codebase").

Three facts, none of them obvious from reading the code, stack into that blind spot:

1. **`define:vars` implies `is:inline`.** `languages.astro` and `users.astro` kept their logic inside
   a `<script define:vars>`. In Astro that forces the script inline: no bundling, no `import`, no
   TypeScript. The files were therefore *structurally incapable* of reaching the canonical escaper.
   There was no import to forget — there was no import to write. The code that resulted was ES5
   string concatenation with no escaping at all.

2. **Biome cannot see `.astro`.** `biome.json` carries `"!**/*.astro"` in `files.includes`. Several
   hundred lines of inline TypeScript across the admin pages are neither linted nor formatted. A
   reader of `package.json` sees `"check": "biome ci ."` and reasonably concludes the admin is
   linted. It is not. (ADR-0013's compliance note records the same over-estimation.)

3. **The existing guard enumerated its own scope.** `tests/html-escape-attr-guard.test.js` hardcoded
   six `client/*.ts` paths. A rule enforced over a hardcoded list of files is not a codebase rule; it
   is a subdirectory rule that *reads* like a codebase rule. Worse, its regex (`="${escapeHtml(`)
   detects the *wrong escaper in an attribute* — it is constitutionally unable to detect *no escaper
   at all*, which is the actual defect. Pointing it at the `.astro` files, as issue #99 first
   proposed, would have passed green and found nothing.

The naive conclusion — "escape the two call sites" — treats the symptom. The five sinks are what the
blind spot cost; the blind spot is the defect.

## Decision

Admin HTML-escaping compliance is enforced by a **hand-rolled source guard**,
`tests/html-escape-guard.test.js`, which **discovers** its own scope by walking
`src/routes/admin/**` for `*.ts` and `*.astro`. No file list is hardcoded, because a hardcoded list is
the mechanism by which #99 stayed hidden. It fails CI on three rules:

- **R1** — `escapeHtml` used in an attribute-value position (carried over from the old guard, now
  applied repo-wide instead of to six files).
- **R2** — a **dynamic** HTML sink (`innerHTML` / `outerHTML` / `insertAdjacentHTML` written from
  anything other than a static literal) inside an `.astro` file. Rendering belongs in `client/*.ts`,
  where the linter and the tests can reach it. `src/routes/admin/layout.astro` is allowlisted from
  **R2 only** — never from R1/R3 — until #106 moves its ~600 lines out; the allowlist entry carries
  that issue number and is deleted with it.
- **R3** — a file containing a dynamic HTML sink that does not use the canonical escaper. This is the
  rule that catches #99's actual defect.

The guard **lexes before it matches**: it strips comments, extracts only `<script>` blocks from
`.astro` files, and masks string contents while preserving code structure. A plain regex is unsound
here, and we established that empirically rather than by intuition — the admin client mixes quoting
styles inside single expressions (`` '</div>' + `<div class="x${a ? '' : ' y'}">` ``), so the quotes
*inside* a template literal make any quote-counting regex hallucinate string boundaries.

We also **rejected a fourth rule** — *"HTML must never be built by string concatenation"* — after
implementing it and running it against the tree. `block-form.ts:1143` composes
`'</div>' + errorHtml + '</li>'`: a non-literal concatenated into HTML, and entirely safe, because
`errorHtml` is already-escaped HTML. Statically, `errorHtml` and `language.code` are
indistinguishable. The rule fired on 15 safe sites. It is recorded here as rejected so it is not
re-proposed as an obvious improvement.

Static analysis is paired with a behavioral proof, `e2e/admin-xss.spec.ts`, which plants a real
payload through the real API and asserts in a real browser that nothing executes. **The static rules
cannot detect partial escaping** — escape three fields of four and all three pass green — so the e2e
spec is a load-bearing part of this decision, not a nicety.

## Consequences

- The claim in `src/utils/html-escape.ts:9` — canonical "for the whole codebase" — is now **earned**
  and mechanically enforced, rather than asserted in a comment.
- A new admin page that renders API data from a `define:vars` inline script **cannot ship**: R2 and R3
  both fail it in CI. The failure message names the two-script i18n bridge
  (`import-export.astro:175-185`) as the way out.
- **Watch for:** a future maintainer opening `biome.json`, seeing `"!**/*.astro"`, and deleting this
  guard as redundant with the linter. It is not redundant — it exists *because* the linter is blind
  there. If #107 makes Biome see `.astro`, this guard becomes a safety net **underneath** a real
  linter and should be kept, not replaced. Deleting it would silently restore the exact conditions of
  #99.
- **Watch for:** the `layout.astro` allowlist entry outliving #106. It is one exception, named, with
  an issue that kills it. One exception with an expiry date is honest engineering; the same list at
  five entries is the subdirectory rule of #99 growing back.
- The guard is a text scanner, not a type-aware analysis. It proves *the escaper is used*, never *the
  escaper is used on every untrusted value*. Anyone reading its green result as "the admin is
  XSS-free" is over-reading it. The e2e spec is where that claim is actually tested.
- Fixing XSS by validating input at the API boundary was **deliberately not done here** (tracked as
  #108). Output encoding at the sink is the fix; input validation is defense in depth. Reversing that
  order — rejecting `<` in `email` and calling it done — leaves the sink broken for the next field
  piped into it.

## Evidence (current repo, at the time of the decision)

- `src/routes/admin/languages.astro:255-264`, `users.astro:226-233` — `innerHTML` built by
  concatenating `language.code` / `language.label` / `u.email` / `u.id` into both text and attribute
  contexts, with no escaper. Both files use `<script define:vars>`.
- `src/routes/admin/layout.astro:376,624,941` — three further unescaped sinks, found by this change's
  audit, not by the issue. `:624` renders language data into the content-locale `<option>` — i.e. on
  **every** admin page; `:376` renders `siteName` on the **pre-login** screen.
- `src/api/handlers/languages.ts:56` (`label`: trim only) and `src/api/handlers/users.ts:35` (`email`:
  trim + lowercase, **no format validation**) — a plain owner `POST` plants both payloads; the
  bootstrap-import path (ADR-0015) is not required.
- `biome.json` — `files.includes` contains `"!**/*.astro"`.
- `tests/html-escape-attr-guard.test.js:44-51` — the six-entry hardcoded `FILES` array.
- Escaper usage across `client/*.ts`: all 25 dynamic sinks live in files that already import the
  canonical pair — R3's zero-false-positive baseline.

Supersedes nothing. Complements **ADR-0011** (which escaper) and **ADR-0013** (where the lint gate
runs, and how much it actually covers).
