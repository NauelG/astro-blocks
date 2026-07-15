<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Decompose `block-form.ts` and extract the picker CSS

Vertical slices = the commit sequence from `design.md` §7, leaf-first. **Every slice ends green**:
`npm run typecheck` + `npm test` pass before its commit. Code moves are verbatim — if a line needs
editing beyond an import path, stop and re-check the design.

Every new `.ts` file starts with the BSL copyright block. Commits: conventional, English,
`Reviewed-by` footer, no agent tags.

Legend: `[ ]` pending · `[x]` done

---

## Slice 1 — Picker CSS → `cms-admin.css`

- [x] **1.1** `src/styles/cms-admin.css` — add section
  `/* ─── Media picker dialog ─── */` after the "File field" block (~l. 4484 region, beside
  "Image field picker"). Paste the rules from `block-form.ts` lines 114–274 verbatim, keeping the
  DetailModal-contract comment.
- [x] **1.2** `src/routes/admin/client/block-form.ts` — delete the `<style>…</style>` element
  (lines 113–275) from `mountPickerDialog`'s `innerHTML` template.

**Verify:** `npm run typecheck` · `npm test` · `grep -c '<style' src/routes/admin/client/block-form.ts`
→ 0 · `grep -c 'cms-media-picker-panel' src/styles/cms-admin.css` → ≥1.

**Commit:** `refactor(admin): move picker dialog CSS into cms-admin.css`

---

## Slice 2 — Leaf modules: `field-helpers`, `array-limits`, `file-accept`

- [x] **2.1** Create `src/routes/admin/client/block-form/field-helpers.ts` — move `errorKey`,
  `withLocaleHint`, `parseFieldValue`, `defaultPrimitiveValue`, `defaultArrayItemValue`,
  `imageFilenameFromUrl`, `imagePickerIconSvg` (with their imports). Export all.
- [x] **2.2** Create `src/routes/admin/client/block-form/array-limits.ts` — move `ArrayLimitInfo`,
  `checkArrayLimitReached`.
- [x] **2.3** Create `src/routes/admin/client/block-form/file-accept.ts` — move
  `getGlobalAllowlist`, `computeEffectiveAccept` (imports: `DEFAULT_ALLOWED_FILE_TYPES`,
  `intersectAccept` from `utils/file-catalog.js`; note the relative path gains one `../`).
- [x] **2.4** `src/routes/admin/client/block-form.ts` — delete the moved code; import from the three
  new modules; keep `export { checkArrayLimitReached }` / `export type { ArrayLimitInfo }`
  re-exported so `dist/.../block-form.js` keeps its surface.
- [x] **2.5** `scripts/coverage.mjs` — add `--exclude` for `dist/routes/admin/client/block-form/**`
  (same rationale as the existing `block-form.js` exclusion: browser-only, node:test cannot drive a
  DOM). Keep the existing line — the facade still compiles to that path.

**Verify:** `npm run typecheck` · `npm test` (includes `block-form-array-limit.test.js` via dist
facade and `html-escape-guard.test.js`, whose `collectAdminFiles` already recurses into
subdirectories — confirmed at plan time) · coverage script still passes if run by CI.

**Commit:** `refactor(admin): extract block-form leaf modules (field-helpers, array-limits, file-accept)`

---

## Slice 3 — `field-dom-sync`

- [x] **3.1** Create `src/routes/admin/client/block-form/field-dom-sync.ts` — move
  `updateImageFieldDom`, `updateFileFieldDom`, `seedAltInput`, `seedCaptionInput`. Imports:
  `imageFilenameFromUrl`, `imagePickerIconSvg` from `./field-helpers.js`; value helpers/escapers per
  the moved code. Export the four functions.
- [x] **3.2** `block-form.ts` — delete moved code, import from `./block-form/field-dom-sync.js`.

**Verify:** `npm run typecheck` · `npm test`.

**Commit:** `refactor(admin): extract block-form field-dom-sync module`

---

## Slice 4 — `field-renderers`

- [x] **4.1** Create `src/routes/admin/client/block-form/field-renderers.ts` — move
  `imageFieldHtml`, `fileFieldHtml`, `primitiveInputHtml`, `renderPrimitiveField`,
  `renderArrayPrimitiveItem`, `renderArrayObjectItem`, `renderArrayField`, plus `trashIconSvg`
  (single consumer). Imports from `./field-helpers.js`, `./file-accept.js`, escapers, types.
  Export the render functions consumed by `mountBlockForm`.
- [x] **4.2** `block-form.ts` — delete moved code, import from `./block-form/field-renderers.js`.

**Verify:** `npm run typecheck` · `npm test` (canonical-escape guard still points at `block-form.ts`,
which still contains picker + mount sinks — stays meaningful until Slice 6).

**Commit:** `refactor(admin): extract block-form field-renderers module`

---

## Slice 5 — `picker-dialog`

- [ ] **5.1** Create `src/routes/admin/client/block-form/picker-dialog.ts` — move the singleton
  state (`pickerDialog`, `activePickerInputId`, `activePickerMode`, `activePickerAccept`), the
  `MediaEntry` alias, `mountPickerDialog`, `closePickerDialog`, `PickerState`, `renderPickerItem`,
  `renderPickerGrid`, `pickerLoadPage`, `openPickerDialog`, `selectPickerImage`,
  `selectPickerFile`, `xIconSvg`. Imports: `./field-dom-sync.js`, media-fetch, media-tile,
  image/file-value utils, escapers, `ct`, `showToast`. Export `openPickerDialog` (the only entry
  point `mount` needs).
- [ ] **5.2** `block-form.ts` — delete moved code, import `openPickerDialog` from
  `./block-form/picker-dialog.js`.

**Verify:** `npm run typecheck` · `npm test`.

**Commit:** `refactor(admin): extract block-form picker-dialog module`

---

## Slice 6 — `mount` + facade + guard repoint

- [ ] **6.1** Create `src/routes/admin/client/block-form/mount.ts` — move `FieldChangeInfo`,
  `BlockFormOptions`, `BlockFormHandle`, `mountBlockForm` (Sortable lifecycle included, per the
  header contract). Keep the file-header doc comment (interface contract + security note) with it.
- [ ] **6.2** `src/routes/admin/client/block-form.ts` — reduce to the pure re-export facade
  (design §2): `mountBlockForm` + types from `./block-form/mount.js`, `checkArrayLimitReached` +
  `ArrayLimitInfo` from `./block-form/array-limits.js`. Short header comment pointing into
  `block-form/` (ADR-0012 pattern, cf. `api/handlers.ts`).
- [ ] **6.3** `tests/block-form-canonical-escape.test.js` — replace the single pinned `relPath` with
  the sink-bearing modules: `block-form/picker-dialog.ts`, `block-form/field-dom-sync.ts`,
  `block-form/field-renderers.ts`, `block-form/mount.ts`. Update the header comment (including the
  stale coverage note if wording changed in 2.5).
- [ ] **6.4** Consumers sanity check (no edits expected): `page-editor.ts`,
  `global-blocks-editor.ts` still import from `'./block-form.js'`.

**Verify:** `npm run typecheck` · `npm test` · `wc -l src/routes/admin/client/block-form.ts` → ~25 ·
no module in `block-form/` exceeds ~450 lines.

**Commit:** `refactor(admin): extract mount.ts and reduce block-form.ts to a re-export facade`

---

## Slice 7 — Verification bar (no commit; gates Review)

- [ ] **7.1** `npm run e2e` (or the repo's e2e invocation) — `admin-flow.spec.ts` green.
- [ ] **7.2** Manual picker smoke in `playgrounds/basic`: open picker · paginate · select image ·
  select file (accept filter applies) · clear both · array add/remove/reorder (Sortable) · upload
  from picker · inline errors render on remount.
- [ ] **7.3** Bundle check: built admin JS contains no `.cms-media-picker-` rules; picker renders
  identically (styles now from `cms-admin.css`).

**Note for Review/Archive:** the `spec-delta.md` R3 edit to `docs/specs/admin-html-rendering.md`
is applied during **Archive**, not here. No guard-test change is needed for recursion (verified).
