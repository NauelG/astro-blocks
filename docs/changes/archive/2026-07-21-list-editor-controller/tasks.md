<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — `createListEditor`

Vertical slices. The pure renderer lands first with its node test (T1–T2); the controller (T3); the
two editors migrate (T4–T5); the source-guard is re-pointed and a missing e2e gate is added (T6–T7);
full verification (T8); one commit (T9).

`npm test` runs `npm run build` first (`package.json:70`) and tests import from `../dist/…`, so every
verify step is plain `npm test` unless noted.

> **Three plan-time findings folded in.**
> 1. The `.astro` `<thead>` already carries the action columns (`cms-table-actions` /
>    `cms-table-actions-delete` empty `<th>`s) and the data-column headers. `renderRows` only emits
>    the `<td>`s, so `ColumnDef` carries **no** `header` — just `cellClass?` + `cell`. The thead stays
>    in the `.astro`.
> 2. `tests/table-editors-canonical-escape.test.js` is a source guard requiring `configs`/`redirects`
>    to import the canonical `escapeHtml`. After migration they hold **no** sink, so it must be
>    re-pointed at `list-render.ts` (where the escaping now lives) — T6.
> 3. **No e2e covers the configs/redirects *list*.** `select-position.spec.ts:76` exercises the
>    redirect *modal* (the form half we keep), but the list wiring (fetch→render→bind→delete) has no
>    behavioural gate. T7 adds a minimal one, rather than claim "admin-flow still green" (it never
>    covered these).

## T1 — The pure renderer test (red)

- [x] **File:** `tests/list-render.test.js` — new. Imports `renderRows`, `raw` from
  `../dist/routes/admin/client/list-render.js`.
  - **Escaping is structural**: a row whose text cell is `'<script>alert(1)</script>'` renders with
    the script escaped inside its `<td>`; a `rowId` containing `"` is `escapeAttr`'d in `data-id` (no
    raw `"` breaks out of the attribute).
  - **`raw()` passes through**: a `{ html: raw('<span>ok</span>') }` cell emits `<span>ok</span>`
    verbatim — the one intended, typed hole.
  - **Structure**: 2 rows → 2 `<tr>`, each with a leading `cms-list-edit` action cell and a trailing
    `cms-list-delete` action cell carrying `data-id`; `[]` → `''`.
- **Verify:** `npm test` — the new tests fail (`list-render.js` does not exist).

## T2 — `list-render.ts` (pure, node-testable)

- [x] **File:** `src/routes/admin/client/list-render.ts` — new, BSL header.
  - `RawHtml` branded type + `raw(trusted: string): RawHtml`; `Cell = {text}|{attr}|{html:RawHtml}`;
    `ColumnDef<Row> = { cellClass?: string; cell: (row) => Cell }`.
  - `renderRows<Row>(rows, columns, rowId, opts)` where `opts` carries the two action labels
    (`editLabel`/`deleteLabel`) and the two icon constants, so the module stays free of the i18n
    import and fully pure. Emits `<tr data-id>` + edit action `<td>` + data `<td>`s + delete action
    `<td>`, using `escapeHtml`/`escapeAttr` from the canonical module for every non-`RawHtml` value.
  - `PENCIL_SVG` / `TRASH_SVG` constants live here (moved out of `configs`/`redirects`), emitted via
    `raw()`. The action classes are generic: `cms-list-edit` / `cms-list-delete`.
  - Doc comment: `RawHtml` is the only unescaped path and the sink stays a visible `.innerHTML` in
    `list-editor.ts` (ADR-0035, ADR-0022).
- **Verify:** `npm test && npm run typecheck` — `list-render.test.js` green; a bare string passed to
  `{ html }` must be a compile error (assert by a scratch check during dev, not committed).

## T3 — `createListEditor` (`list-editor.ts`)

- [x] **File:** `src/routes/admin/client/list-editor.ts` — new, BSL header. `ListEditorOptions<Row>`
  and `createListEditor` per `design.md` §4. Owns: `refresh` (fetchJson + `transform?` + render),
  `render` (`tbody.innerHTML = renderRows(...)` + count + empty toggle + bind), `bind`
  (`.cms-list-edit`/`.cms-list-delete` → `onEdit` / delete-confirm block), `visible()` (search +
  `filter?`), the `input` listener, and the opt-in `cms:content-locale-change` listener. Returns
  `{ refresh, getState }`.
  - This is the file that holds the `.innerHTML` sink, so it **imports the canonical escaper** (via
    `renderRows`) — R3 of the guard is satisfied here.
- **Verify:** `npm test && npm run typecheck` green (nothing consumes it yet; it compiles).

## T4 — `setInlineError` dedup + migrate `configs-editor.ts`

- [x] **File:** `src/routes/admin/client/common.ts` — add `setInlineError(el: HTMLElement | null,
  message = ''): void` (the byte-identical Family-A `setError` body).
- [x] **File:** `src/routes/admin/client/configs-editor.ts` — delete `configsState`, `refreshConfigs`,
  `renderTable`, `bindRows`, `filteredConfigs`, the local `setError`, and the `pencilSvg`/`trashSvg`
  constants. Keep the detail-modal/form half (`resetForm`, `openNew`, `openEdit`, `validateForm`,
  `saveCurrent`, form/submit wiring) — using `setInlineError(errorEl, …)`. Build a `createListEditor`
  with the configs columns + `transform` (the key sort) from `design.md` §5; call its `refresh()` on
  init and after `saveCurrent`.
  - `configs` passes `searchEl` + a 3-field `filter` (key/value/description) and is **not**
    `localeAware` (it has no locale listener today).
  - The description column's `title=` attribute is preserved by a `{ html: raw(...) }` cell that
    escapes the text and the title inside.
- **Verify:** `npm test` — `configs`' behaviour is unit-covered only indirectly; typecheck green, no
  suite regresses. `table-editors-canonical-escape.test.js` will now fail for configs — fixed in T6.

## T5 — Migrate `redirects-editor.ts`

- [x] Same shape: delete the list half + SVG constants + local `setError`; keep the form half
  (`validatePath`, `clientValidation`, `resetForm`, `openNew`, `openEdit`, `saveCurrent`). Build a
  `createListEditor` with the redirects columns (two monospace text cells + two badge cells via
  `raw()`), `searchEl` + 2-field `filter`, `confirmDelete` → `{from,to}` message, and **`localeAware:
  true`** (redirects has the listener; configs does not — the one real divergence, now an option).
- **Verify:** `npm test` — no suite regresses except the canonical-escape guard (T6).

## T6 — Re-point the canonical-escape source guard

- [x] `tests/table-editors-canonical-escape.test.js` — `configs-editor.ts` and `redirects-editor.ts`
  no longer hold a sink, so remove them from `FILES` and add `list-render.ts` (which now owns the
  canonical `escapeHtml`/`escapeAttr` use). `menus-editor.ts` and `page-editor.ts` stay. Update the
  header comment to say the escaping for the migrated editors moved into the shared renderer.
- **Verify:** `npm test` — the guard passes against the new file set; `html-escape-guard.test.js`
  (the structural R1–R3 guard) stays green — `list-editor.ts` is a visible `client/*.ts` sink using
  the escaper.

## T7 — Add the missing list-level e2e gate

- [x] `e2e/admin-flow.spec.ts` — add one focused test for the **redirects list** (the wiring T5
  migrated, currently ungated): logged in, create a redirect via the modal, assert its row appears in
  `#cms-redirects-tbody`, delete it, assert the row is gone. Reuse the file's existing login helper.
  - This is the behavioural proof the controller's fetch→render→bind→delete wiring works in a real
    browser — the safety net the issue assumed `admin-flow` already had.
- **Verify:** `npm run build:playground && npm run e2e` — the new test and the existing suite green.
  **Port 4321 must be free.**

## T8 — Full verification

- [x] `npm test && npm run typecheck && npm run check`.
- [x] `npm run features:validate`.
- [x] `npm run e2e` (green, incl. `select-position.spec.ts`'s redirect-modal test and T7's new one).
- [x] `grep -rn "raw(" src/routes/admin/client/list-render.ts src/routes/admin/client/*-editor.ts` —
  confirm the only `raw()` sites are the two icons and the redirects badges; no user text is inside a
  `raw()` un-escaped.
- [x] Confirm `configs-editor.ts` / `redirects-editor.ts` no longer contain `.innerHTML`,
  `renderTable`, or `bindRows`.

## T9 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `refactor(admin): extract createListEditor for the configs and redirects list pages`
- Body: the two-families finding (only configs/redirects are true twins; languages/users deferred to
  post-#119; global-blocks is not a list editor); the typed cell model that makes escaping structural
  over a **visible** sink (ADR-0035, not `html\`\``); that two callers is justified by the
  node-testable renderer and the safe-by-construction escaping, not by dedup count; and the added
  list-level e2e that `admin-flow` never had. Reference #117, ADR-0035.
- No version bump / `CHANGELOG` — at release close this is a `patch` (internal refactor; no
  consumer-visible change, so possibly only a `### Changed` line or none per the CI/infra rule).
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Deviations from the plan (2026-07-21)

- **Merged `list-render.ts` into `list-editor.ts` (one file, not two).** The plan put the pure
  renderer in its own module. During T3 the repo-wide `html-escape-guard.test.js` (R3) failed on
  `list-editor.ts`: it holds the `.innerHTML =` sink but, with the renderer split out, no longer
  imported the canonical escaper, and the guard is lexical — it cannot see that `renderRows` (in
  another file) escapes. The honest fix was **not** to add a token escaper call to satisfy the guard
  (a "green light that means nothing"), nor to teach the guard about `renderRows` (modifying the
  safety net). It was to co-locate the renderer with the sink so the escaper use and the sink live in
  the one file the guard scans. `renderRows` stays an exported pure function (`common.js` is
  import-safe under node, verified), so the node test is unchanged in substance — only its import path
  moved to `list-editor.js`. Minimal blast radius; the guard is untouched.
- **Preserved the configs description hover tooltip.** The original had `title=` on the `<td>`; a
  plain `{ text }` cell would have dropped it — a silent UI regression. Kept via a `{ html: raw(...) }`
  cell that escapes both the title (`escapeAttr`) and the text (`escapeHtml`) inside. The tooltip now
  sits on a `<span>` inside the `<td>` rather than the `<td>` itself — functionally the same hover,
  a faithful port within the cell model (which carries `cellClass` but not arbitrary `<td>` attrs).
- **Re-pointed the canonical-escape guard to `list-editor.ts`.** `table-editors-canonical-escape.test.js`
  required both escapers on `configs`/`redirects`; after migration their table render (and both
  escapers) moved to `list-editor.ts`, and `redirects` now imports only `escapeHtml` (for its badge).
  Removed the two migrated editors from the guard, added `list-editor.ts`; `menus`/`page-editor` stay.
- **Added Test G to `admin-flow.spec.ts`.** The plan's T7. The redirects *list* wiring had no e2e
  (admin-flow never covered these editors; only `select-position` touches the redirect *modal*). The
  new test creates a redirect, asserts the row renders in the shared tbody, deletes it via the generic
  `.cms-list-delete` class, and asserts it is gone — the behavioural proof the migrated
  fetch→render→bind→delete works in a browser, including the new generic action classes.

### Line count

`configs-editor.ts` 250→192, `redirects-editor.ts` 274→218; the shared `list-editor.ts` is ~245 lines
(controller + pure renderer). The net is roughly flat today — as expected and stated up front: at two
callers the win is the node-testable renderer and structural escaping, not line reduction. The third
and fourth callers (languages/users, post-#119) are where the line math turns positive.

## Review finding (2026-07-21)

Reviewing the diff confirmed behaviour preservation — the value-mask, the two badges (tone + text),
the configs outside-click-close (kept; redirects never had one), and the per-editor confirm messages
all port faithfully; the CSS styles `cms-table-btn-edit`/`-delete` (which `renderRows` keeps), not the
per-entity classes. It found one loose end the class rename left behind.

- **The SSR `.astro` rows still used the old per-entity classes.** `configs.astro` and
  `redirects.astro` render the initial list server-side (`{configs.map(...)}`) with
  `cms-config-edit` / `cms-redirect-edit` etc., while the migrated client now renders the generic
  `cms-list-edit` / `cms-list-delete`. No functional regression — the client replaces the SSR rows on
  `refresh()` and the CSS keys off `cms-table-btn-*` — but it left the SSR output diverged from the
  client renderer and turned the per-entity classes into dead references. Updated both `.astro` files
  to the generic classes; grep now confirms **zero** live references to `cms-config-edit` /
  `cms-config-delete` / `cms-redirect-edit` / `cms-redirect-delete` anywhere. Re-ran the e2e (SSR
  output changed) — 15/15 green.
  - Not touched: the SSR keeps `title=` on the `<td>` (Astro auto-escapes it, safe), while the client
    puts the tooltip on a `<span>` inside — the one place the cell model cannot match SSR exactly, and
    the tooltip works either way.
