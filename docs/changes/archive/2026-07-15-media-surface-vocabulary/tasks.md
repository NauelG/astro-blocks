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

- [x] **2.1** `en.ts` + `es.ts`: reworded the picker-internal keys (asset/recurso); renamed
  `imageLoadError` → `pickerLoadError` in both catalogs.
- [x] **2.2** `picker-dialog.ts`: grid-load `catch` now uses `blockForm.pickerLoadError`.
- [x] **2.3 (guard)** Guard extended: picker-internal values ∉ `/image|imagen/i`; `imageLoadError` gone.
- **Verify:** guard + parity green; `npm run typecheck`.

## Slice 3 — File field localized + image dynamic-path fix · `fix`

- [x] **3.1** `en.ts` + `es.ts`: added `blockForm.chooseFile`/`replaceFile`/`clearFile`/`noFileSelected`.
- [x] **3.2** `field-renderers.ts` `fileFieldHtml`: hardcoded literals → `ct()`; Clear button reads
  "Clear file".
- [x] **3.3** `field-dom-sync.ts`: in-place updaters through `ct()` — file (noFileSelected,
  replaceFile/chooseFile) and image (noImageSelected, replaceImage/chooseImage, existing keys).
  Added the `ct` import.
- [x] **3.4 (guard)** Guard extended: file-field keys exist in en+es.
- **Verify:** guard + parity green; `npm run typecheck`; `npm run check` (no hardcoded-string lint on
  the touched renderers).

## Slice 4 — Media library surfaces · `fix`

- [x] **4.1** `en.ts` + `es.ts` — upload widget → **file** (dropzone/chooseFile/fileInput); renamed
  `chooseImage`→`chooseFile`, `chooseImageAriaLabel`→`chooseFileAriaLabel`.
- [x] **4.2** `en.ts` + `es.ts` — grid → **asset** (search/empty/noMatch/count/deleteFailedMessage);
  renamed `imageLibraryAriaLabel`→`libraryAriaLabel`, `imageMetaAriaLabel`→`metaAriaLabel`.
- [x] **4.3** `media.lead` reworded (names categories, no format list); `replaceSuccessMessage`
  softened (dropped "Variants regenerating" / masculine ES).
- [x] **4.4** Call sites updated in `client/media.ts` and `media.astro`; no orphan stale keys.
- [x] **4.5 (guard)** Guard extended: container keys ∉ `/image|imagen/i` (media.lead excluded — it
  names categories); renamed keys present, old names absent. Full suite green (1261/1261).
- **Verify:** guard + parity green; `npm run typecheck`; `npm run check`.

## Slice 5 — README reframe · `docs`

- [x] **5.1** `README.md`: `### Media & Responsive Images` → `### Media` with an "any file" opening;
  `#### Responsive images (<BlockImage>)` and `#### File props (non-image)` as peer subsections.
- [x] **5.2** `:39` feature bullet and `:77` feature table cell updated (video/audio/docs). Fixed the
  now-broken in-page anchor at `:351` (`#file-uploads--non-image` → `#file-props-non-image`).
- **Verify:** manual read done; heading hierarchy `### Media` › `#### …`; no stale anchors.

## Slice 6 — Green board (closing verification, not a commit of its own)

- [x] **6.1** `npm run typecheck` OK · `npm test` 1261/1261 · `npm run check` 0 errors.
- [x] **6.2** No incidental diffs in `playgrounds/`, `data/`, `src/img/*`.
- [x] **6.3** `src/meta/features.json` untouched (no new feature; copy/i18n only).

---

## Not in Implement (deferred to Review / Archive)

- **Review** the full diff against `spec-delta.md` (RV1–RV4) and `docs/DESIGN.md` conventions.
- **Archive:** integrate `spec-delta.md` into `docs/specs/media-uploads.md` (add RV1–RV4); add the
  `CONTEXT.md §3` glossary rows + convention (media/asset/file/image, §3 boundary); move this change
  dir to `docs/changes/archive/2026-07-15-media-surface-vocabulary/`; leave ADR-0026 intact.
- **Screenshots** regenerate on the next release cut (`screenshots:media`) — copy must land before it.
- **No version bump / CHANGELOG** now (release-cut only).
