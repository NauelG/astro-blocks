<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Media surface vocabulary

Companion to `proposal.md`. Exhaustive before/after for every key and every code site. The vocabulary
rationale lives in `docs/adr/0026-media-user-facing-vocabulary.md`; the living-behaviour delta in
`spec-delta.md`.

## 0. Vocabulary slots (recap)

| Slot | Word | Where |
|---|---|---|
| Mass / section & action | **media** | section title, picker action in file mode |
| Countable library item | **asset** (ES: **recurso**) | counters, empty state, grid aria, library search |
| Disk action + dev contract | **file** (ES: **archivo**) | dropzone, upload button, file input, `file` prop type |
| Image-acting (unchanged, §3) | **image** | alt, dimensions, variants, `<BlockImage>`, image-mode picker |

> ⚠ **ES term to confirm at GATE:** English "asset" → proposed Spanish **"recurso"**. Alternatives:
> "archivo" (collapses the file/asset split), "elemento", "activo" (literal, reads financial). All EN
> strings below are final; the ES "recurso" choice is the one open translation decision.

---

## 1. `en.ts` / `es.ts` — `media.*`

### 1a. Upload widget → **file** (disk action)

| Key | Before (en) | After (en) | After (es) |
|---|---|---|---|
| `media.dropzoneLabel` | Drag & drop images here | **Drag & drop files here** | Arrastra y suelta archivos aquí |
| `media.dropzoneHint` | or use the button below | _(unchanged)_ | _(unchanged)_ |
| `media.dropzoneAriaLabel` | Image upload drop zone | **File upload drop zone** | Zona de carga de archivos |
| `media.chooseImage` → **`media.chooseFile`** | Choose image | **Choose file** | Elegir archivo |
| `media.chooseImageAriaLabel` → **`media.chooseFileAriaLabel`** | Choose image to upload | **Choose file to upload** | Elegir archivo para subir |
| `media.fileInputAriaLabel` | Upload image file | **Upload media file** | Subir archivo multimedia |

### 1b. Grid / counters / search → **asset** (library item)

| Key | Before (en) | After (en) | After (es) |
|---|---|---|---|
| `media.searchLabel` | Search images by filename | **Search assets by filename** | Buscar recursos por nombre de archivo |
| `media.searchPlaceholder` | Search by filename… | _(unchanged)_ | _(unchanged)_ |
| `media.searchAriaLabel` | Search images by filename | **Search assets by filename** | Buscar recursos por nombre de archivo |
| `media.imageLibraryAriaLabel` → **`media.libraryAriaLabel`** | Image library | **Asset library** | Biblioteca de recursos |
| `media.imageMetaAriaLabel` → **`media.metaAriaLabel`** | Image metadata | **Asset metadata** | Metadatos del recurso |
| `media.empty.title` | No images uploaded yet | **No assets uploaded yet** | Aún no hay recursos subidos |
| `media.empty.text` | Upload your first image using the area above. | **Upload your first asset using the area above.** | Sube tu primer recurso usando el área de arriba. |
| `media.noMatchTitle` | No matching images | **No matching assets** | Sin recursos coincidentes |
| `media.noMatchText` | Try a different search term. | _(unchanged)_ | _(unchanged)_ |
| `media.countOf` | {shown} of {total} images | **{shown} of {total} assets** | {shown} de {total} recursos |
| `media.count` | {total} image | **{total} asset** | {total} recurso |
| `media.countPlural` | {total} images | **{total} assets** | {total} recursos |
| `media.deleteFailedMessage` | Could not remove the image. | **Could not remove the asset.** | No se pudo eliminar el recurso. |

### 1c. Section lead

| Key | After (en) | After (es) |
|---|---|---|
| `media.lead` | **Upload and manage media for your site — images, video, audio and documents.** | Sube y gestiona los medios de tu sitio: imágenes, vídeo, audio y documentos. |

### 1d. Unchanged `media.*` (neutral or image-acting §3 exclusion)

- **Neutral, untouched:** `eyebrow` ("Content"), `title` ("Media"), `prevPage`, `nextPage`, `prevBtn`,
  `nextBtn`, `pageIndicator`, all `upload*`/`replace*`/`delete*`/`deleted*` flow messages (they key on
  `{filename}`), `deleteLabel`, `replaceLabel`.
- **Image-acting, kept as "image" (§3):** `altPlaceholder` ("Describe this image…"), `altLabel`,
  `altSaved`, `altSavedMessage`, `altSaveFailed`, `altSaveFailedMessage`.

> **Minor item flagged:** `media.replaceSuccessMessage` = "{filename} replaced. Variants
> regenerating." mentions variants, which only exist for images. Proposed softening to
> **"{filename} replaced."** (ES: "{filename} reemplazado.") so it is true for video/PDF/audio too.
> Variants still regenerate silently for images. **Confirm or veto at GATE.**

---

## 2. `en.ts` / `es.ts` — `blockForm.*`

### 2a. Picker title → **mode-dependent pairs** (image keeps "image" per §3; file → "media")

| New key | en | es |
|---|---|---|
| `blockForm.pickerTitle` → **`pickerTitleImage`** | Choose image | Elegir imagen |
| **`pickerTitleFile`** _(new)_ | Choose media | Elegir medios |
| `blockForm.pickerAriaLabel` → **`pickerAriaLabelImage`** | Choose image | Elegir imagen |
| **`pickerAriaLabelFile`** _(new)_ | Choose media | Elegir medios |
| `blockForm.pickerClose` → **`pickerCloseImage`** | Close image picker | Cerrar selector de imagen |
| **`pickerCloseFile`** _(new)_ | Close media picker | Cerrar selector de medios |

> ⚠ ES for "Choose media" proposed as **"Elegir medios"** — confirm alongside the asset term.

### 2b. Picker internals → **neutral + asset**

| Key | Before (en) | After (en) | After (es) |
|---|---|---|---|
| `blockForm.pickerLoading` | Loading images… | **Loading assets…** | Cargando recursos… |
| `blockForm.pickerSearchLabel` | Search images by filename | **Search assets by filename** | Buscar recursos por nombre de archivo |
| `blockForm.pickerSearchAriaLabel` | Search images by filename | **Search assets by filename** | Buscar recursos por nombre de archivo |
| `blockForm.pickerSearchPlaceholder` | Search by filename… | _(unchanged)_ | _(unchanged)_ |
| `blockForm.pickerUploadLabel` | Upload new image | **Upload new asset** | Subir nuevo recurso |
| `blockForm.pickerEmpty` | No images yet. | **No assets yet.** | Aún no hay recursos. |
| `blockForm.pickerCountOf` | {shown} of {total} images | **{shown} of {total} assets** | {shown} de {total} recursos |
| `blockForm.pickerCount0` | 0 images | **0 assets** | 0 recursos |
| `blockForm.imageLoadError` → **`blockForm.pickerLoadError`** | Failed to load images. | **Failed to load assets.** | No se pudieron cargar los recursos. |

### 2c. Picker upload sub-widget (disk file) — **unchanged** (already "file")

`pickerChooseFile` ("Choose file"), `pickerNoFileSelected` ("No file selected"), `pickerUpload`,
`pickerLoadMore`, `pickerSelectAriaLabel`, `pickerUploadSuccess`/`Msg`, `pickerUploadError`.

### 2d. New keys — **file field fold-in**

| New key | en | es |
|---|---|---|
| `blockForm.chooseFile` | Choose file | Elegir archivo |
| `blockForm.replaceFile` | Replace | Reemplazar |
| `blockForm.clearFile` | Clear file | Quitar archivo |
| `blockForm.noFileSelected` | No file selected | Ningún archivo seleccionado |

### 2e. Image-field controls — **kept as "image" (§3), untouched keys**

`noImageSelected`, `clearImage`, `chooseImage`, `replaceImage`, `uploadImage`, `altText`,
`altPlaceholder`, `captionLabel`, `captionPlaceholder`.

---

## 3. Code changes

### 3a. `block-form/picker-dialog.ts` — title per open

Extract a **pure helper** (unit-testable, node:test-friendly):

```ts
export type PickerMode = 'image' | 'file';
export function pickerTitleKeyForMode(mode: PickerMode) {
  return mode === 'file'
    ? { title: 'blockForm.pickerTitleFile', aria: 'blockForm.pickerAriaLabelFile', close: 'blockForm.pickerCloseFile' }
    : { title: 'blockForm.pickerTitleImage', aria: 'blockForm.pickerAriaLabelImage', close: 'blockForm.pickerCloseImage' };
}
```

- `mountPickerDialog()` no longer bakes the title from `pickerTitle`/`pickerAriaLabel`/`pickerClose`
  (those keys no longer exist). It mounts with the **image** defaults (or a neutral placeholder that
  `openPickerDialog` immediately overwrites).
- `openPickerDialog(triggerBtn, inputId, mode, effectiveAccept)` sets, on every open, from
  `pickerTitleKeyForMode(mode)`: the `<h2 class="cms-media-picker-title">` text, the dialog
  `aria-label`, and the close button `aria-label`. Values pass through `escapeHtml`/`escapeAttr` as
  today (the singleton already escapes).
- `renderPickerGrid` count/empty strings switch to `pickerCountOf`/`pickerCount0`/`pickerEmpty`
  (asset wording); the grid-load `catch` uses `pickerLoadError` (renamed from `imageLoadError`).

### 3b. `block-form/field-renderers.ts` — `fileFieldHtml` through `ct()`

| Line | Before | After |
|---|---|---|
| 142 | `…--empty">No file selected</span>` | `ct('blockForm.noFileSelected')` |
| 143 | `hasValue ? 'Replace' : 'Choose file'` | `hasValue ? ct('blockForm.replaceFile') : ct('blockForm.chooseFile')` |
| 154 | `aria-label="Choose file"` | `ct('blockForm.chooseFile')` |
| 155 | `aria-label="Clear file">Clear` | aria + text both `ct('blockForm.clearFile')` → button reads "Clear file" (mirrors image's "Clear image") |

### 3c. `block-form/field-dom-sync.ts` — localize the in-place updaters

The dynamic (in-place) path currently hardcodes English for **both** fields. Route both through
`ct()`. The image-field fix reuses existing keys — no new keys, one line each — and removes a real
Spanish-panel bug, so it rides along with the fold-in.

| Line | Field | Before | After |
|---|---|---|---|
| 45 | image | `hasValue ? filename : 'No image selected'` | `ct('blockForm.noImageSelected')` for empty |
| 51 | image | `hasValue ? 'Replace' : 'Choose image'` | `ct('blockForm.replaceImage')` / `ct('blockForm.chooseImage')` |
| 68 | file | `hasValue ? displayName : 'No file selected'` | `ct('blockForm.noFileSelected')` for empty |
| 74 | file | `hasValue ? 'Replace' : 'Choose file'` | `ct('blockForm.replaceFile')` / `ct('blockForm.chooseFile')` |

> **Flagged extension of the fold-in:** lines 45 & 51 are the *image* field. Localizing them is one
> line each on existing keys; leaving them hardcoded right beside the file updater we are fixing would
> be inconsistent. **Confirm at GATE.**

### 3d. Renamed-key call sites

| File | Line | Old key | New key |
|---|---|---|---|
| `client/media.ts` | 60 | `media.imageMetaAriaLabel` | `media.metaAriaLabel` |
| `client/media.ts` | 177 | `media.imageLibraryAriaLabel` | `media.libraryAriaLabel` |
| `media.astro` | 92 | `media.dropzoneLabel` | _(same key, new value)_ |
| `media.astro` | 98 | `media.chooseImageAriaLabel` | `media.chooseFileAriaLabel` |
| `media.astro` | 100 | `media.chooseImage` | `media.chooseFile` |
| `media.astro` | 144 | `media.imageLibraryAriaLabel` | `media.libraryAriaLabel` |
| `media.astro` | 181 | `media.imageMetaAriaLabel` | `media.metaAriaLabel` |

(`media.astro:89` `dropzoneAriaLabel`, `:107` `fileInputAriaLabel`, `:115/124` `searchAriaLabel`,
`:117` `searchLabel` keep their key names — value-only changes.)

---

## 4. `README.md` — full reframe

- **`### Media & Responsive Images` → `### Media`.** New opening paragraph: upload **any file**
  (images, video, audio, documents) at `/cms/media`; the library manages them all with search,
  metadata, where-used and in-place replace.
- **`#### Responsive images (BlockImage)`** — the existing variants/AVIF/WebP/`<BlockImage>` content,
  re-nested as the **image-specific** capability, not the section headline.
- **`#### File props (non-image)`** — the existing `### File Uploads / Non-Image` content, retitled
  and repositioned as a peer subsection, updated to name **video and audio** (not just PDF/document).
- **`:39` feature bullet** — add video/audio/documents to "responsive images, alt text and captions".
- **`:77` feature table cell** — "non-image file uploads (PDF/document support)" → "video, audio, PDF
  and document uploads".

Prose passes the `humanizer` sensibility (no inflated tricolons, no em-dash spam beyond house style).

---

## 5. Tests — `tests/media-copy-guard.test.js` (new)

Node.js test runner (`node:test` + `assert/strict`), against `dist/` catalogs (mirrors
`i18n-catalog.test.js`).

1. `pickerTitleKeyForMode('image')` → `pickerTitleImage`; `('file')` → `pickerTitleFile`.
2. **Regression guard:** a fixed allowlist of container keys (`media.count*`, `media.empty.*`,
   `media.noMatch*`, `media.libraryAriaLabel`, `media.metaAriaLabel`, `media.searchLabel`,
   `blockForm.pickerCount*`, `blockForm.pickerEmpty`, `blockForm.pickerLoadError`, …) has values that
   do **not** match `/image|imagen/i`, in both `en` and `es`.
3. New file-field keys (`blockForm.chooseFile`/`replaceFile`/`clearFile`/`noFileSelected`) and the
   picker pairs (`pickerTitleImage`/`File`, …) exist in both catalogs.

The existing `i18n-catalog.test.js` parity test stays green because both catalogs move together.

---

## 6. Screenshots (no action in this change)

`src/img/media-library.png` and `src/img/image-picker.png` render these strings and regenerate on
release via `screenshots:media` (`npm version` hook). The copy must land **before** the next release
cut for the images to catch up. No manual regeneration here.

---

## 7. Out of scope (confirmed)

- No behaviour: upload validation, storage, serving, the catalog, the allowlist — untouched.
- No dynamic accepted-formats string in `media.lead` (would read config at render time).
- No version bump / `CHANGELOG` entry now (release-cut only, AGENTS.md).
