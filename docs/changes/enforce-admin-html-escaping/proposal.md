<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Enforce the canonical HTML escaper across the whole admin

- **Issue:** #99 (P1 · bug · security)
- **Follow-ups deliberately left out:** #106 (extract `layout.astro` → `client/layout.ts`),
  #107 (Biome over `.astro`), #108 (input validation on `email` / `label`)

## Problem

Five stored-XSS sinks in the admin build `innerHTML` from API data with **no escaper at all**.

| # | Sink | Contexts | Blast radius |
|---|------|----------|--------------|
| 1 | `src/routes/admin/languages.astro:255-264` | text + `data-code` attr | `/cms/languages` |
| 2 | `src/routes/admin/users.astro:226-233` | text + `data-id` attr | `/cms/users` |
| 3 | `src/routes/admin/layout.astro:624` | `<option value="…">…</option>` — attr + text | **every admin page** |
| 4 | `src/routes/admin/layout.astro:376` | text (`siteName`) | the **pre-login** auth screen |
| 5 | `src/routes/admin/layout.astro:941` | text (toast title) | anywhere a toast fires |

Sinks 3-5 are **not in the issue** — they surfaced from its own audit item. Sink 3 is the widest:
a malicious language `label` renders into the content-locale selector, which the layout paints on
*every* admin page, so a payload planted at `/cms/languages` fires everywhere in the panel.

The issue also under-states the vector. It reaches for the bootstrap-import path (ADR-0015) as the
way to plant a payload. Not needed: `src/api/handlers/languages.ts:56` accepts a free-form `label`
(trim only) and `src/api/handlers/users.ts:35` accepts `email` with **no format validation at all**
(trim + lowercase — which neutralizes nothing; `<img src=x onerror=…>` is already lowercase). A
plain owner `POST` plants both payloads.

Severity stays **Medium**, and the issue's reasoning for that is correct: writing these fields needs
`owner` (`src/api/route-table.ts:240,284`), so this is not a privilege-escalation path. It is still a
real stored XSS — owner-to-owner on a multi-owner instance, and a defense-in-depth failure in exactly
the layer ADR-0011 exists to defend.

## Root cause — not "somebody forgot to escape"

`languages.astro` and `users.astro` are the **only two** admin pages that keep their logic inside a
`<script define:vars>`. In Astro, `define:vars` forces `is:inline`: **no bundling, no `import`, no
TypeScript**. Everything else follows from that one fact:

- They **cannot reach** `src/utils/html-escape.ts`. There is no import to write.
- Biome **cannot see them** — `biome.json` carries `"!**/*.astro"` (ADR-0013's compliance note).
- The guard test **does not look at them** — `tests/html-escape-attr-guard.test.js:44-51` enumerates
  six hardcoded `client/*.ts` paths.

Every other page uses the two-script bridge that `src/routes/admin/import-export.astro:175-185`
already documents: a `define:vars` script that only publishes `window.__cmsXI18n`, plus a bundled
module script that imports `./client/x.js`. The two offenders are the exception, and the XSS is what
the exception costs.

## The part of the issue that is wrong

Issue item 2 says: *extend `tests/html-escape-attr-guard.test.js` to cover the admin `.astro` files.*
Taken literally, **that is a no-op**. The guard's regex is `="\$\{escapeHtml\(` — it detects the
*wrong* escaper in an attribute position. These files do not call `escapeHtml` anywhere, and do not
even use template literals. Adding them to the `FILES` array passes green and finds nothing.

The rule we need is not "don't use the wrong escaper." It is "don't ship an HTML sink with **no**
escaper." That is a different test, and it is the actual deliverable of this change.

## Proposal

1. **Migrate** `languages.astro` and `users.astro` to `client/languages-editor.ts` and
   `client/users-editor.ts`, using the established two-script i18n bridge. This puts them under
   Biome, under the guard test, and within reach of the canonical escaper — permanently.
2. **Escape all five sinks** with the canonical pair: `escapeHtml()` for text content, `escapeAttr()`
   for `data-code` / `data-id` / `title` / `aria-label`. `layout.astro`'s three sinks are fixed
   **in place** — its `<script>` blocks are bundled modules and can import the escaper today, no
   refactor required (that refactor is #106).
3. **Replace the guard test** with `tests/html-escape-guard.test.js`: three rules, applied by **glob**
   over `src/routes/admin/**` (`.ts` *and* `.astro`). No hardcoded file list — a hardcoded list is
   precisely how this hole opened. The rules are in `design.md`; each one was validated against the
   current tree before being adopted, and a fourth candidate rule ("no HTML built by concatenation")
   was **discarded** because the tree proves it wrong — `block-form.ts:1143` composes
   `'</div>' + errorHtml + '</li>'`, which is concatenation of a non-literal and is entirely safe.
   A rule that fires on safe code is not a rule; it is noise that trains people to ignore the guard.
4. **Prove the exploit, then prove the fix**: an e2e spec that plants both payloads through the real
   API and asserts nothing executes. It must go **red first** against `main`.
5. **Record the decision** in a new ADR complementing ADR-0011, and the convention + vocabulary in
   `docs/CONTEXT.md`.

## Non-goals

- Extracting `layout.astro`'s ~600 lines → **#106**. Hygiene, not security; the escaper lands without it.
- Turning Biome loose on `.astro` → **#107**. Needs a churn measurement first.
- Validating `email` / `label` at the API boundary → **#108**. Fixing XSS by input validation is the
  classic mistake: reject `<` in `email`, feel safe, and the sink stays broken for the next field
  somebody pipes into it. The sink is what is wrong; the sink is what gets fixed.

One cause, one PR. This one should be reviewable by asking a single question: *does any API-sourced
value still reach the DOM unescaped?*
