<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Media surfaces speak "media/asset/file", not "images"

_Issue: [#114](https://github.com/NauelG/astro-blocks/issues/114) (documentation, P2). Grilled 2026-07-15._

## Problem

The media subsystem has accepted images, PDFs, video and audio since 3.6.0 (#111), but the admin UI
and the README still say "images" almost everywhere. A consumer reading either would reasonably
conclude AstroBlocks only handles images — the exact misreading that produced the `video/mp4` 415
incident behind ADR-0023. The runtime is correct; the surface points the other way and under-sells a
capability that ships and works.

Three fronts:

1. **The block picker titles itself "Choose image" for every prop type.** The singleton picker
   dialog bakes `blockForm.pickerTitle` ("Choose image") once into its `innerHTML` at mount time
   (`src/routes/admin/client/block-form/picker-dialog.ts:64-74`), so it never reflects the `mode`
   (`'image' | 'file'`) it is opened with. Picking a PDF, an MP4 or an MP3 opens a modal headed
   "Choose image". This is a UI defect, not just copy.

2. **The media library says "images" throughout.** ~27 `media.*` keys carry image-only wording for
   surfaces that now hold any file type: the dropzone, the counters ("3 images" for three MP4s), the
   empty state, the search, and several aria labels. The picker's own internal strings (loading,
   empty, count, search) have the same defect but were not called out in the issue.

3. **The README frames the whole subsystem as images.** The `### Media & Responsive Images` section
   opens with "Upload an image once at `/cms/media`"; non-image support appears ~30 lines later under
   a heading that reads like a footnote. The feature bullet (`:39`) and feature table (`:77`) omit
   video and audio entirely — the table cell still says "PDF/document support", stale as of 3.6.0.

Two adjacent findings surfaced during grilling that the issue did not name:

- **`media.lead`** hardcodes a raster-only format list ("Accepted formats: JPG, PNG, WebP, SVG,
  GIF") that is now false — accepted formats are configurable via `allowedFileTypes` (ADR-0023).
- **The `file` field is not localized at all.** `fileFieldHtml`
  (`src/routes/admin/client/block-form/field-renderers.ts:131`) uses hardcoded English literals
  ("Choose file", "Replace", "Clear", aria "Choose file"/"Clear file") instead of `ct()`, so a
  Spanish panel shows them in English and `es.ts` has no keys for them. This is the very capability
  the issue is trying to make visible, shipped half-localized.

## Scope

**In scope** — copy, docs, one UI-logic fix, and one fold-in:

- `src/routes/admin/i18n/en.ts` + `es.ts`: the ~27 `media.*` keys and the shared `blockForm.picker*`
  keys, re-worded per the vocabulary model below, with type-lying key **names** renamed in the same
  pass (the parity test moves both catalogs together, and the names are internal).
- `src/routes/admin/client/block-form/picker-dialog.ts`: the picker titles itself per `mode`.
- `src/routes/admin/client/block-form/field-renderers.ts`: `fileFieldHtml` routed through `ct()`
  (fold-in — localize the `file` field).
- `src/routes/admin/client/media.ts` + `src/routes/admin/media.astro`: renamed-key call sites.
- `README.md`: reframe `§Media` around "any file", with responsive images as an image-specific
  subsection.

**Explicitly out of scope** — behaviour. No change to upload validation, storage, serving, the
catalog, or the allowlist. Deriving `media.lead`'s accepted-formats list from live config was
rejected as behaviour (it would read config at render time).

**Explicitly preserved** — image-specific surfaces keep saying "image" (see the §3 boundary in the
vocabulary model): alt text, dimensions, variants, `<BlockImage>`, and the picker when opened in
`image` mode.

## The vocabulary model

The keystone decision. Three words, each with a defined slot:

- **"Media"** — mass noun. The section brand and the act of choosing from the library ("Media",
  "Choose media"). Not countable.
- **"asset"** — countable unit. Individual library items ("3 assets", "No assets uploaded yet",
  "Asset library"). This is the counters' and grid's vocabulary.
- **"file"** — the disk-side action and the developer contract. What you drop or choose from disk to
  upload ("Drag & drop files here", "Choose file"), and the `file` prop type / `FileFieldValue` a
  consumer declares in a schema. The upload widget speaks "file"; the library grid speaks "asset".

The **§3 boundary** (named after the issue's §3): surfaces that **act on an image** — alt text,
dimensions, variants, and the picker opened in `image` mode — keep saying "image". Surfaces that
**hold any asset** — library, counters, dropzone, search, the file-mode picker — speak media, asset
or file per the slots above.

Consequence for the picker title: `image` mode → "Choose image" (acts on an image prop, honours §3);
`file` mode → "Choose media" (holds any type). This is why the fix is mode-dependent, not a blanket
rename.

## Why an ADR

The `file`-vs-"asset" two-layer split (code contract says `file`, end-user copy says asset/media)
will make a future contributor ask "why does the UI say 'asset' when the code says 'file'?" It is the
result of a real deliberation (media / asset / file / item were all weighed) and it governs all
future media copy, not just these strings. Captured as `docs/adr/0026-media-user-facing-vocabulary.md`,
with the vocabulary itself recorded in `CONTEXT.md §3`.

## Non-goals

- No version bump or `CHANGELOG` entry now — those happen at release-cut (AGENTS.md).
- No screenshot regeneration by hand: `media-library.png` and `image-picker.png` regenerate on
  release via `screenshots:media`. The copy must land **before** the next release for the images to
  catch up; this proposal only notes the ordering.
