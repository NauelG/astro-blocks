<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — `createListEditor` for the admin list pages

_Resolves [#117](https://github.com/NauelG/astro-blocks/issues/117) (P2, refactor). Grilled
2026-07-21._

## Problem

`configs-editor.ts` and `redirects-editor.ts` are near-verbatim copies of the same machine: a
module-local `state[]`, a `refreshX()` (fetch → assign → `renderTable`), a `renderTable()` (`state.map
(row → \`<tr>…\`).join('')` into `tbody.innerHTML` + count text + empty-state toggle + `bindRows()`),
and a `bindRows()` with an identical edit/delete-confirm-toast-refresh block. The only real difference
is the column set and the per-domain validate. The "convention" (CONTEXT.md §5: *diff any new list
page against `menus.astro`*) is doing a module's job by hand.

## What the issue got wrong, verified against the code

The issue lists 4–6 near-verbatim twins. A full read of all six editors shows **two families and an
outlier**, not one skeleton:

| Editor | Family | Reality |
|---|---|---|
| `configs`, `redirects` | A (`common.js` + `ct()`) | **True twins.** Identical modulo the entity noun. |
| `menus` | A | Same style, but **event-delegation** binding (not per-button rebind); its list half is a minority of a 539-line builder. |
| `languages`, `users` | **B** (raw `fetch`, `window.__cmsXI18n`, `win.cmsAlert/Confirm/Toast`, owner-gating) | **Not twins.** `users` renders with `createElement`/`appendChild`, not `innerHTML`; `languages` has no search; delete handlers differ materially (raw fetch, manual status checks, cascade counts). |
| `global-blocks` | — | **Not a list editor** — no `state`, `refresh`, `renderTable`, or `bindRows`. The issue groups it wrongly. |

`setError` is byte-identical only in Family A. The delete handler is identical only between
`configs` ↔ `redirects` (differing only in the confirm-interpolation object: `{key}` vs `{from,to}`).
The `cms:content-locale-change` listener is present in `redirects`/`menus` and absent in
`configs`/`languages`/`users` — it is **not** universal. And escaping is **already correct
everywhere** — no unescaped API free-text reaches any `tbody`; the #99 XSS is already fixed in these
migrated files.

## Scope

**`createListEditor`, designed from and applied to `configs` + `redirects` only.** `languages` and
`users` are deferred: they are Family B and need [#119](https://github.com/NauelG/astro-blocks/issues/119)'s
i18n-bridge migration (to `ct()`/`common.js`) before they can route through the controller without
forcing per-caller flags into it. `menus` (delegation, mostly a builder) and `global-blocks` (not a
list) are out.

**Two callers is honest about what this buys.** The dedup value alone is modest at two files — below
the "design it twice" threshold. The change earns its keep on the other two axes:

1. **A pure, node-testable renderer.** `renderRows(rows, columns) → html` becomes a plain function,
   unit-testable under `node:test`. Today the render/bind/delete logic lives inside `initXEditor()`
   closures, DOM-coupled and reachable only through Playwright. This converts e2e-only surface into
   node coverage.
2. **Structural escaping.** Escaping moves into the column/cell layer and becomes the *only* path a
   plain string can take to the sink. Not a fix for a live hole — there isn't one — but a guarantee
   for every *future* list editor, which is where the recurring bug risk actually lives.

And it is the landing pad: when `languages`/`users` migrate post-#119, they slot in for free.

## Proposed interface

```ts
createListEditor<Row>({
  endpoint,               // '/cms/api/configs'
  tbody,                  // HTMLTableSectionElement
  rowId,                  // (row: Row) => string
  columns,                // ColumnDef<Row>[]
  transform,              // optional (rows: Row[]) => Row[]  — configs sorts, redirects doesn't
  onEdit,                 // (row: Row) => void   — opens the per-editor detail modal
  confirmDelete,          // (row: Row) => { message: string; confirmLabel: string }
  deletedToast,           // string — ct('configs.deleted')
  countLabel,             // (n: number) => string — ct('configs.count', { count: n })
  emptyEl, countEl, searchEl,
  filter,                 // optional (row, query) => boolean  — search predicate
  localeAware,            // optional boolean — wire cms:content-locale-change
}): { refresh(): Promise<void>; getState(): Row[] }
```

It hides fetch+auth, the render+escape loop, empty/count toggling, edit/delete binding, the
delete-confirm, and (opt-in) the locale re-fetch. The **detail modal + form + validate stay
per-editor** — their fields are irreducibly different; `onEdit(row)` is the seam. The real
per-screen variations the code showed are absorbed as named options: `transform` (configs' sort),
`confirmDelete` (the `{key}` vs `{from,to}` message), `localeAware` (opt-in).

## The cell model, and why escaping is structural

A column's cell is a function returning a **typed descriptor**, not a string:

```ts
type Cell = { text: string } | { attr: string } | { html: RawHtml };
interface ColumnDef<Row> { header: string; cell: (row: Row) => Cell; }
```

- `{ text }` → `escapeHtml`
- `{ attr }` → `escapeAttr` (attribute position; also encodes `"`)
- `{ html: RawHtml }` → emitted verbatim, and `RawHtml` is a **branded type produced only by
  `raw(s: string)`**.

A plain `string` can never reach the sink unescaped: the renderer accepts only descriptors, and only
`raw()` yields `RawHtml`. `raw()` is the single, named, greppable place trusted markup enters — the
two SVG icons (compile-time constants) and the status/state badges (whose dynamic text is escaped
*inside* the `raw(...)`). This is safe-by-construction at the type level.

## Why not `html\`\`` — and how ADR-0022 stays satisfied

The renderer keeps a **visible `.innerHTML =`** in a `client/*.ts` file, fed by escaped cells. It does
**not** introduce a generic tagged-template sink or a `set:html`. `media-tile.ts:26` already rejected
that shape for three icons, because ADR-0022's guard lexes `<script>` blocks for `innerHTML`/
`outerHTML` sinks — introducing a sink the guard is blind to trades a structural guarantee for a
comment. `createListEditor.ts` is a visible `innerHTML` sink in `client/`, so ADR-0022's R3 applies to
it (it imports and uses the canonical escaper) and `tests/html-escape-guard.test.js` keeps passing by
construction. The `RawHtml` type is defense *on top of* the guard, not a replacement — the guard
cannot statically tell escaped HTML from raw (it rejected a no-concat rule for exactly this reason),
so the type layer is what makes the escaped path the only path.

## Riders (tracked here, not split)

1. **Safe-path-only escaping** — the cell model above. Delivered.
2. **Node-testable rows** — `renderRows` is pure; a `node:test` asserts escaping and structure.

## Boundary with #122

`createListEditor` builds the edit/delete buttons, so it owns their two icons (`pencilSvg`,
`trashSvg`) — inline in the module, via `raw()`. #122 (the shared icon module for *editor forms*)
stays separate; this note is mirrored on both issues so they do not collide.

## Non-goals

- `languages`, `users` (Family B — need #119 first), `menus` (delegation, mostly a builder),
  `global-blocks` (not a list editor).
- Each editor's detail modal, form, and `validate` — those stay per-editor.
- The i18n bridge migration (#119) and the shared icon module (#122).
- Any business logic (path normalization, key regexes, cascade rules).

## Acceptance criteria

- [ ] `createListEditor` exists; `configs` and `redirects` route their list half through it.
- [ ] `renderRows(rows, columns)` is a pure function with a `node:test` covering escaping (a `<script>`
      in a cell value is escaped) and structure (count, empty toggle inputs).
- [ ] Escaping lives in the cell layer; `configs`/`redirects` no longer hand-escape per row. `RawHtml`
      is the only unescaped path and is produced only by `raw()`.
- [ ] `setError` is deduplicated for the migrated editors.
- [ ] `tests/html-escape-guard.test.js` still passes (visible `.innerHTML` sink preserved).
- [ ] Playwright `admin-flow.spec.ts` still green; `typecheck` + `test` + `check` green.
