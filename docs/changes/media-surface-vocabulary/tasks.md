<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Media surface vocabulary

Vertical slices. Each slice keeps its keys, its code and its test together so every commit is
self-consistent: `npm run typecheck`, the parity test (`i18n-catalog.test.js`) and the growing guard
test (`media-copy-guard.test.js`) are green at each commit. TDD per slice: failing test → minimum code
→ refactor → commit. ES "asset" = **recurso**; "Choose media" = **Elegir medios**.

Legend: `[ ]` todo · `[x]` done.

---

## Slice 1 — Picker titles itself by prop type (the UI defect + helper) · `fix`

- [x] **1.1 (red)** Create `tests/media-copy-guard.test.js`. Assert
  `pickerTitleKeyForMode('image')` → `{ title:'blockForm.pickerTitleImage', … }` and `('file')` →
  `…File`. Helper extracted to its own dep-free module `block-form/picker-title.ts`.
- [x] **1.2 (green)** Added pure helper `pickerTitleKeyForMode(mode)` in
  `block-form/picker-title.ts`. `openPickerDialog` sets the `<h2.cms-media-picker-title>` text, dialog
  `aria-label` and close-button `aria-label` on every open (textContent/setAttribute — safe sinks).
  `mountPickerDialog` mounts with the image triple.
- [x] **1.3** `en.ts` + `es.ts`: removed `pickerTitle`/`pickerAriaLabel`/`pickerClose`; added the
  `…Image`/`…File` pairs.
- **Verify:** `node --test tests/media-copy-guard.test.js` green; `node --test tests/i18n-catalog.test.js`
  green; `npm run typecheck` (no reference to removed keys).

## Slice 2 — Picker internals speak "asset" · `fix`

- [ ] **2.1** `en.ts` + `es.ts`: reword `blockForm.pickerLoading`, `pickerSearchLabel`,
  `pickerSearchAriaLabel`, `pickerUploadLabel`, `pickerEmpty`, `pickerCountOf`, `pickerCount0`
  (asset/recurso); **rename** `blockForm.imageLoadError` → `blockForm.pickerLoadError` (both catalogs).
- [ ] **2.2** `picker-dialog.ts`: `renderPickerGrid` count/empty already reference these keys —
  update the grid-load `catch` to `blockForm.pickerLoadError`.
- [ ] **2.3 (guard)** Extend `media-copy-guard.test.js`: these keys' values ∉ `/image|imagen/i` in en+es.
- **Verify:** guard + parity green; `npm run typecheck`.

## Slice 3 — File field localized + image dynamic-path fix · `fix`

- [ ] **3.1** `en.ts` + `es.ts`: add `blockForm.chooseFile`, `replaceFile`, `clearFile`,
  `noFileSelected` (values per `design.md §2d`).
- [ ] **3.2** `src/routes/admin/client/block-form/field-renderers.ts` `fileFieldHtml`: replace the
  hardcoded literals (name-empty, choose/replace label, aria choose, aria+text clear) with `ct()`
  calls. Clear button reads "Clear file" (mirrors image's "Clear image").
- [ ] **3.3** `src/routes/admin/client/block-form/field-dom-sync.ts`: route the in-place updaters
  through `ct()` — **file** (lines ~68 `noFileSelected`, ~74 `replaceFile`/`chooseFile`) and
  **image** (lines ~45 `noImageSelected`, ~51 `replaceImage`/`chooseImage`, existing keys).
- [ ] **3.4 (guard)** Extend guard: `chooseFile`/`replaceFile`/`clearFile`/`noFileSelected` exist in en+es.
- **Verify:** guard + parity green; `npm run typecheck`; `npm run check` (no hardcoded-string lint on
  the touched renderers).

## Slice 4 — Media library surfaces · `fix`

- [ ] **4.1** `en.ts` + `es.ts` — upload widget → **file**: `media.dropzoneLabel`,
  `dropzoneAriaLabel`, `fileInputAriaLabel` values; **rename** `media.chooseImage` →
  `media.chooseFile` and `media.chooseImageAriaLabel` → `media.chooseFileAriaLabel`.
- [ ] **4.2** `en.ts` + `es.ts` — grid → **asset**: `media.searchLabel`, `searchAriaLabel`,
  `empty.title`, `empty.text`, `noMatchTitle`, `countOf`, `count`, `countPlural`,
  `deleteFailedMessage` values; **rename** `media.imageLibraryAriaLabel` → `media.libraryAriaLabel`
  and `media.imageMetaAriaLabel` → `media.metaAriaLabel`.
- [ ] **4.3** `en.ts` + `es.ts` — `media.lead` reworded; `media.replaceSuccessMessage` softened to
  drop "Variants regenerating".
- [ ] **4.4** Update call sites: `client/media.ts` (`imageMetaAriaLabel`→`metaAriaLabel`,
  `imageLibraryAriaLabel`→`libraryAriaLabel`); `media.astro`
  (`chooseImageAriaLabel`→`chooseFileAriaLabel`, `chooseImage`→`chooseFile`,
  `imageLibraryAriaLabel`→`libraryAriaLabel`, `imageMetaAriaLabel`→`metaAriaLabel`).
- [ ] **4.5 (guard)** Extend guard: container keys (`media.count*`, `empty.*`, `noMatch*`,
  `libraryAriaLabel`, `metaAriaLabel`, `searchLabel`) ∉ `/image|imagen/i`; renamed keys present,
  old key names absent.
- **Verify:** guard + parity green; `npm run typecheck`; `npm run check`.

## Slice 5 — README reframe · `docs`

- [ ] **5.1** `README.md`: `### Media & Responsive Images` → `### Media` with an "any file" opening;
  `#### Responsive images (BlockImage)` and `#### File props (non-image)` as peer subsections; update
  the non-image section to name video + audio.
- [ ] **5.2** `README.md:39` feature bullet and `:77` feature table cell updated (video/audio/docs).
- **Verify:** manual read; `README` renders; no version badge / feature-table structural breakage.

## Slice 6 — Green board (closing verification, not a commit of its own)

- [ ] **6.1** `npm run typecheck` · `npm test` · `npm run check` all green.
- [ ] **6.2** Confirm no incidental diffs in `playgrounds/`, `data/`, `src/img/*`.
- [ ] **6.3** Confirm `src/meta/features.json` needs **no** change (no new feature; copy/i18n only).

---

## Not in Implement (deferred to Review / Archive)

- **Review** the full diff against `spec-delta.md` (RV1–RV4) and `docs/DESIGN.md` conventions.
- **Archive:** integrate `spec-delta.md` into `docs/specs/media-uploads.md` (add RV1–RV4); add the
  `CONTEXT.md §3` glossary rows + convention (media/asset/file/image, §3 boundary); move this change
  dir to `docs/changes/archive/2026-07-15-media-surface-vocabulary/`; leave ADR-0026 intact.
- **Screenshots** regenerate on the next release cut (`screenshots:media`) — copy must land before it.
- **No version bump / CHANGELOG** now (release-cut only).
