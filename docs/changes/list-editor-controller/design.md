<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — `createListEditor`

## 1. Module layout

Two new files, both in `src/routes/admin/client/`:

- **`list-render.ts`** — the pure, DOM-free half: the `Cell`/`ColumnDef` types, the `RawHtml`
  branded type + `raw()`, and `renderRows(rows, columns, rowId)` → `string`. No `document`, no
  `fetch`. This is the node-testable unit.
- **`list-editor.ts`** — `createListEditor(...)`: the effectful half that owns the `tbody` sink,
  fetch+auth, bind, delete-confirm, count/empty toggling, search, and the opt-in locale listener. It
  imports `renderRows` and the canonical escaper, so ADR-0022 R3 is satisfied on the file that holds
  the `.innerHTML` sink.

`setError` (byte-identical in Family A) moves to `common.ts` as `setInlineError(el, message)` — a
5-line helper, orthogonal to the controller but deduplicated in the same change.

## 2. The pure renderer (`list-render.ts`)

```ts
/** Branded: the only value the renderer emits without escaping. Produced solely by raw(). */
declare const RAW: unique symbol;
export type RawHtml = string & { readonly [RAW]: true };
export function raw(trusted: string): RawHtml {
  return trusted as RawHtml;
}

export type Cell = { text: string } | { attr: string } | { html: RawHtml };

export interface ColumnDef<Row> {
  header: string;                 // used by the .astro table head; not re-rendered here
  cellClass?: string;             // static <td> class, e.g. 'cms-table-cell-monospace'
  cell: (row: Row) => Cell;
}

function renderCell(cell: Cell, cellClass?: string): string {
  const cls = cellClass ? ` class="${escapeAttr(cellClass)}"` : '';
  if ('text' in cell) return `<td${cls}>${escapeHtml(cell.text)}</td>`;
  if ('attr' in cell) return `<td${cls}>${escapeAttr(cell.attr)}</td>`;
  return `<td${cls}>${cell.html}</td>`;   // RawHtml — the only unescaped path, and it is typed
}

export function renderRows<Row>(
  rows: Row[],
  columns: ColumnDef<Row>[],
  rowId: (row: Row) => string,
): string {
  return rows
    .map((row) => {
      const id = escapeAttr(rowId(row));
      const edit = `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-list-edit" data-id="${id}" aria-label="${escapeAttr(ctEdit())}">${raw(PENCIL_SVG)}</button></td>`;
      const del = `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-list-delete" data-id="${id}" aria-label="${escapeAttr(ctDelete())}">${raw(TRASH_SVG)}</button></td>`;
      const cells = columns.map((c) => renderCell(c.cell(row), c.cellClass)).join('');
      return `<tr data-id="${id}">${edit}${cells}${del}</tr>`;
    })
    .join('');
}
```

Two things the type system enforces here, not the author:

- **A plain `string` cannot reach the sink unescaped.** `renderCell` only accepts a `Cell`; the `html`
  arm requires `RawHtml`; `RawHtml` is produced only by `raw()`. Passing a bare string to `{ html }`
  is a type error.
- **Action classes are generic** — `cms-list-edit` / `cms-list-delete`, owned by the controller — so
  the per-entity class names (`cms-config-edit`, `cms-redirect-edit`) and their bind loops disappear.

`ctEdit`/`ctDelete` are tiny closures the caller injects (or `renderRows` takes the two labels as
params) so `list-render.ts` stays free of the i18n import and fully pure for the test.

## 3. `raw()` usage is confined and greppable

Only two shapes use `raw()`:

- **The SVG icons** — `raw(PENCIL_SVG)` / `raw(TRASH_SVG)`, compile-time string constants.
- **The badges** (redirects' statusCode + enabled) — the column's `cell` returns
  `{ html: raw(\`<span class="cms-badge cms-badge-${tone}">${escapeHtml(text)}</span>\`) }`. The
  dynamic text is escaped *inside* the `raw(...)`; only the `tone` (a closed set → a class suffix)
  and the static markup are un-escaped. `configs`' value-masking is a plain `{ text: mask(value) }`.

`raw(` is the audited choke point: a repo grep enumerates every unescaped-HTML site, and there are a
known, small number of them. This is the ADR-0022 trade-off (a guard plus a tiny audited surface),
now expressed in the type system.

## 4. `createListEditor` (`list-editor.ts`)

```ts
interface ListEditorOptions<Row> {
  endpoint: string;
  responseKey: string;                          // data.configs / data.redirects
  tbody: HTMLTableSectionElement;
  rowId: (row: Row) => string;
  columns: ColumnDef<Row>[];
  editLabel: string; deleteLabel: string;       // ct('common.edit' / 'common.delete')
  transform?: (rows: Row[]) => Row[];           // configs sorts; redirects omits
  onEdit: (row: Row) => void | Promise<void>;
  confirmDelete: (row: Row) => { message: string; confirmLabel: string };
  deletedToast: string;
  countLabel: (n: number) => string;
  countEl?: HTMLElement | null;
  emptyEl?: HTMLElement | null;
  searchEl?: HTMLInputElement | null;
  filter?: (row: Row, query: string) => boolean;
  localeAware?: boolean;
}
```

Behaviour (all previously copy-pasted per editor):

- `refresh()` — `fetchJson(endpoint, { headers: authHeaders(false) })`, read `responseKey`, apply
  `transform` if present, store, render. Returns a promise; the caller decides error surfacing.
- `render()` — `tbody.innerHTML = renderRows(visible(), columns, rowId)`; set `countEl` via
  `countLabel`; toggle `emptyEl` `cms-hidden`; then `bind()`.
- `bind()` — `tbody.querySelectorAll('.cms-list-edit'/'.cms-list-delete')`, wiring `onEdit(row)` and
  the delete-confirm block (`confirmDelete(row)` → `showConfirm` → `fetchOk(DELETE …)` →
  `showToast(deletedToast)` → `refresh()` → `catch → showAlert`).
- `visible()` — `searchEl` + `filter` if both present, else all rows.
- `searchEl?.addEventListener('input', render)`.
- `if (localeAware) window.addEventListener('cms:content-locale-change', () => refresh().catch(() => {}))`.
- Returns `{ refresh, getState }`.

## 5. Migration of the two editors

`configs-editor.ts` and `redirects-editor.ts` keep only their **detail-modal/form** half: the field
lookups, `resetForm`, `openNew`, `openEdit`, `validate*`, `saveCurrent`, and the form/submit wiring.
Their `state`, `refreshX`, `renderTable`, `bindRows`, `filteredX`, and the per-entity SVG constants
are deleted. Each builds a `createListEditor` and calls the returned `refresh()` on init and after
`saveCurrent()`.

`configs` columns:

```ts
columns: [
  { cellClass: 'cms-table-cell-monospace', cell: (c) => ({ text: c.key }) },
  { cellClass: 'cms-table-cell-monospace cms-configs-value-cell', cell: (c) => ({ text: maskConfigValue(c.value || '') }) },
  { cellClass: 'cms-configs-description-cell', cell: (c) => ({ text: c.description || '—' }) },
],
transform: (rows) => [...rows].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })),
```

(The description column's `title="${escapeAttr(...)}"` attribute is dropped by the plain-text model,
or preserved by a `{ html: raw(\`<span title="${escapeAttr(desc)}">${escapeHtml(text)}</span>\`) }`
cell — decided in review; the simplest faithful port keeps the title via a raw cell.)

`redirects` columns: two monospace text cells (from/to) + two badge cells (statusCode, enabled) via
`raw()` as in §3.

`onEdit` for each is the existing `openEdit(row.id)`. `confirmDelete` returns the existing
`ct('…​.deleteConfirm', …)` message + `ct('common.delete')`.

## 6. Tests

`tests/list-render.test.js` — the pure renderer, the node coverage this unlocks:

- **Escaping is structural**: a row whose text field is `'<script>alert(1)</script>'` renders with the
  script escaped in the `<td>`; an id containing `"` is `escapeAttr`'d in `data-id`.
- **`raw()` passes through**: a `{ html: raw('<span>ok</span>') }` cell is emitted verbatim (the one
  intended hole, and it is typed).
- **Structure**: N rows → N `<tr>`, each with the edit/delete action cells and generic
  `cms-list-edit`/`cms-list-delete` classes; empty input → empty string.

`tests/html-escape-guard.test.js` — must stay green unchanged: the `.innerHTML` sink is a visible
`client/*.ts` sink using the canonical escaper. Confirm `list-editor.ts` imports and uses
`escapeHtml`/`escapeAttr` (via `renderRows`) so R3 is satisfied.

`e2e/admin-flow.spec.ts` — the behavioural gate. The configs and redirects list/create/delete flows
must stay green; they are the proof the migration changed nothing a user sees.

## 7. Not touched

- The detail modal, form, and `validate*` of each editor.
- `languages`, `users`, `menus`, `global-blocks`.
- Business logic (path normalization, config-key regex).
- The `#122` icon module and the `#119` bridge migration.
