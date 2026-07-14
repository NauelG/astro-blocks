<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Enforce the canonical HTML escaper across the whole admin

Issue #99. Vertical slices, TDD order: **red before green, always**. One commit per slice.

Legend: `[ ]` pending · `[x]` done

---

## Slice 1 — RED: reproduce the exploit

**Goal:** see the XSS fire. A security fix without a reproduced exploit is faith, not engineering.

- [x] **1.1** Create `e2e/admin-xss.spec.ts`.
  - Reuse `./fixtures/coverage` and the `login()` shape from `e2e/admin-flow.spec.ts`.
  - Read the bearer token from `sessionStorage` after login.
  - Plant both payloads through the **real API** (not fixtures): `POST /cms/api/languages`
    (`{ code: 'xx', label: PAYLOAD }`) and `POST /cms/api/users` (`{ email: PAYLOAD, … }`).
  - `PAYLOAD = '"><img src=x onerror="window.__xss=1">'` — **lowercase**, because
    `src/api/handlers/users.ts:35` lowercases `email` and an `onError` variant would pass for the
    wrong reason.
  - Assert on `/cms/languages`, `/cms/users` **and** `/cms/pages` (the layout's content-locale
    selector renders language data on every admin page):
    - `window.__xss === undefined` — nothing executed;
    - the cell / option renders the payload **verbatim as text** — the positive half. Without it, a
      row that simply vanished would also pass.
  - `page.on('dialog')` trap → fail on any dialog.

**Verify:** `npm run e2e` — the spec **FAILS** against current `main`, and the failure is the XSS,
not a selector typo or a timeout. If it does not fail, it is testing nothing: fix the spec before
moving on.

---

## Slice 2 — RED: the guard

**Goal:** encode the rule so the next `.astro` page cannot repeat this.

- [x] **2.1** Create `tests/html-escape-guard.test.js` with the lexer from `design.md` §1:
  strip comments → for `.astro`, extract only `<script>` blocks → mask string contents, preserving
  structure. A plain regex is unsound here (template literals contain quotes).
- [x] **2.2** Discover scope by **walking** `src/routes/admin/**` for `*.ts` / `*.astro`.
  **No hardcoded file list** — that list is how #99 stayed hidden.
- [x] **2.3** Implement R1 (`="${escapeHtml(` in raw text), R2 (dynamic HTML sink in an `.astro`,
  allowlist `['src/routes/admin/layout.astro']` with the `#106` comment and its delete-me mandate),
  R3 (file with a dynamic sink must import + use the canonical pair).
- [x] **2.4** Failure messages must name the fix: R2/R3 point at the two-script i18n bridge
  (`import-export.astro:175-185`) and at `src/utils/html-escape.ts`.

**Verify:** `node --test tests/html-escape-guard.test.js` — R2 and R3 **FAIL** on
`languages.astro`, `users.astro`; R3 **FAILS** on `layout.astro`. R1 passes (nothing violates it
today). No other file is flagged — a single false positive means the rule is wrong, not the code.

---

## Slice 3 — GREEN: `languages.astro` → `client/languages-editor.ts`

- [x] **3.1** Create `src/routes/admin/client/languages-editor.ts` (BSL header). Move all logic from
  the inline script: state, fetch, modal, `renderRows`, delete. TypeScript, typed, `const`/`let`.
- [x] **3.2** Escape at the sink: `escapeHtml(code)` / `escapeHtml(label || code)` in cells;
  `escapeAttr(code)` in `data-code`; `escapeAttr` on `aria-label`.
- [x] **3.3** Rewrite `src/routes/admin/languages.astro` as a bootstrap: `<script define:vars>` sets
  `window.__cmsLanguagesI18n`, plus `<script>import { initLanguagesEditor } …</script>`.

**Verify:** guard R2/R3 pass for `languages.astro`; `npm run check` lints the new module;
`npm run typecheck` green; `/cms/languages` works in the playground (create, edit, delete, default).

---

## Slice 4 — GREEN: `users.astro` → `client/users-editor.ts`

- [x] **4.1** Create `src/routes/admin/client/users-editor.ts` (BSL header), same shape as slice 3.
- [x] **4.2** Escape at the sink: `escapeHtml(email)` in the cell; `escapeAttr(id)` in `data-id`;
  `escapeAttr` on `aria-label` / `title`.
- [x] **4.3** Rewrite `src/routes/admin/users.astro` as a bootstrap (`window.__cmsUsersI18n`).
  Preserve the last-owner delete guard (`canDelete`) verbatim — it is behavior, not rendering.

**Verify:** guard R2/R3 pass for `users.astro`; `/cms/users` works (create, edit, delete, the
disabled-delete state on the last owner).

---

## Slice 5 — GREEN: `layout.astro`'s three sinks

Fixed **in place**. Its `<script>` blocks are bundled modules, not `is:inline` — they can import the
canonical pair today. Moving them is #106, not this change.

- [x] **5.1** Import `escapeHtml` / `escapeAttr` from `../../utils/html-escape.js` in the relevant
  `<script>` blocks.
- [x] **5.2** `:624` — `escapeAttr(entry.code)` in `value="…"`, `escapeHtml(entry.label || entry.code)`
  in the option text.
- [x] **5.3** `:376` — `escapeHtml(siteName)`; the concatenation becomes a template literal.
- [x] **5.4** `:941` — `escapeHtml(options.title || toastNotice)`.
- [x] **5.5** Confirm the R2 allowlist entry for `layout.astro` is present, with the `#106` pointer.

**Verify:** guard R3 passes for `layout.astro` (R2 allowlisted); **`npm run e2e` — Slice 1 now GREEN**,
including the `/cms/pages` assertion, which is the one that proves sink `:624` is dead.

---

## Slice 6 — Retire the old guard

- [x] **6.1** Delete `tests/html-escape-attr-guard.test.js`. Its R1 coverage is absorbed by the new
  guard and **widened** — nothing is dropped. (Precedent: that file itself replaced the narrower
  `block-form-attr-escaping.test.js` the same way.)

**Verify:** `npm test` green; R1 still enforced, now over every admin file instead of six.

---

## Slice 7 — Docs

- [x] **7.1** `docs/CONTEXT.md`: the convention (admin HTML rendering lives in `client/*.ts`; every
  API-sourced value passes the canonical pair before reaching a sink) + glossary entries for
  **HTML sink**, **canonical escaper**, **i18n bridge**.
- [x] **7.2** `docs/adr/0011-canonical-html-escaper.md`: close the compliance note — the violation it
  flags is fixed by this change; the "whole codebase" claim is now enforced by ADR-0022.
- [x] **7.3** `src/utils/html-escape.ts` header: the canonical claim now names the guard that backs it.
- [x] **7.4** ADR-0022 is already written and stays **untouched** (ADRs are immutable).

**Verify:** `docs/CONTEXT.md` uses the same vocabulary as the guard's failure messages. If a developer
reads the failure and the doc and gets two different mental models, the docs are wrong.

---

## Slice 8 — Close out

- [x] **8.1** Full gate: `npm run check` · `npm run typecheck` · `npm test` · `npm run e2e`.
- [x] **8.2** Confirm no incidental changes to playgrounds or data fixtures.
- [x] **8.3** Review the diff against `spec-delta.md` and `docs/CONTEXT.md` conventions (cycle phase 5).

**Verify:** the whole diff answers one question — *does any API-sourced value still reach the DOM
unescaped?* — and the answer is provable, not asserted.

---

## Out of scope (open issues, do not touch here)

- **#106** — extract `layout.astro` (~600 lines) → `client/layout.ts`; deletes the R2 allowlist entry.
- **#107** — Biome over `.astro`.
- **#108** — input validation for `users.email` / `languages.label`.
