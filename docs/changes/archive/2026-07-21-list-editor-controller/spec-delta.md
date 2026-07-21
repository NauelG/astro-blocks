<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — `createListEditor` and the typed cell model

Target: `docs/specs/admin-html-rendering.md`. Adds R6 (the typed cell model) and extends R5's framing.
No requirement is removed: the guard (R1–R4) and the behavioural XSS coverage (R5) still stand; R6 is
a *stronger* guarantee available to any renderer that adopts the cell model, not a replacement.

## ADDED: R6 — A typed cell model makes the escaped path the only path

> **R6 — List rendering goes through a cell model where a plain string cannot reach the sink
> unescaped.** The shared list renderer (`client/list-render.ts`, driven by `createListEditor`)
> accepts columns whose cells are typed descriptors — `{ text }` → `escapeHtml`, `{ attr }` →
> `escapeAttr`, `{ html: RawHtml }` → verbatim — and `RawHtml` is a branded type produced **only** by
> `raw(trusted: string)`. Passing a bare `string` where markup is expected is a compile error. So for
> any editor built on this renderer, partial escaping (R5's gap) is impossible by construction: the
> only unescaped path is `raw()`, which is a named, greppable, small and audited surface (the two SVG
> icons, and badges whose dynamic text is escaped inside the `raw(...)`).
>
> The renderer is a **pure function** (`renderRows(rows, columns, rowId) → string`) with no
> `document` or `fetch`, so this guarantee is unit-tested under `node:test` — an XSS payload in a
> cell's text field renders escaped — rather than only in a browser.

## MODIFIED: R5 — framing

R5 says static enforcement cannot detect a renderer that escapes three fields of four, and leans on
`admin-xss.spec.ts` for that case. Add a closing sentence:

> Where a renderer adopts the R6 cell model, that partial-escaping gap is closed at compile time and
> the behavioural coverage becomes a backstop rather than the only guard. Hand-written renderers that
> do not use the cell model remain covered only behaviourally — R5 still holds for them.

## Boundaries & unchanged behaviour

- The sink stays a **visible `.innerHTML =`** in a `client/*.ts` file, so R3/R4's guard sees it and
  `html-escape-guard.test.js` keeps passing. No `set:html` / tagged-template sink is introduced — the
  shape `media-tile.ts` rejected for being invisible to the guard (ADR-0022) is still rejected
  (ADR-0035).
- R6 applies today to the two editors migrated in this change (`configs`, `redirects`). It is the
  landing pad the rest adopt as they migrate; it does not by itself change any other editor.

## Coverage delta

- `tests/list-render.test.js` (new): a `<script>` in a cell's text is escaped; an id with `"` is
  attr-escaped; `raw()` passes through; N rows → N `<tr>` with the generic
  `cms-list-edit`/`cms-list-delete` action classes.
- `e2e/admin-flow.spec.ts`: configs and redirects list/create/delete stay green — the behavioural
  proof the migration is invisible to a user.
