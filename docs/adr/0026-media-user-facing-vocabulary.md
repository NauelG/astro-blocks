<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0026 — User-facing media vocabulary: media, asset, file, image

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Nauel Gómez
- **Source:** issue [#114](https://github.com/NauelG/astro-blocks/issues/114) — the admin UI and
  README still say "images" although media has handled files, video and audio since 3.6.0 (#111).

## Contexto

The media subsystem accepts four categories — image, video, audio, document (ADR-0023). The
admin panel and README, written when only images existed, still say "images" almost everywhere: the
picker titles itself "Choose image" for a PDF, the library counts three MP4s as "3 images", the README
opens its media section with "Upload an image once". This is the same failure mode as the `video/mp4`
415 that ADR-0023 fixed: the product and what we say about it disagree, and a consumer trusts the
words. The 415 reporter read "images", configured video anyway, and hit a wall.

Fixing the copy forced a vocabulary question the codebase had never answered deliberately. The type
machinery speaks **"file"** (`FileFieldValue`, `file-catalog.ts`, `customFileTypes`,
`allowedFileTypes`, the `file` prop type). `CONTEXT.md` also used **"asset"** ("uploaded asset"). The
UI section is branded **"Media"**. Three words, no rule for when each applies — and "media" is not
countable ("3 media" is wrong), so the counters need a count noun regardless.

Candidates weighed for the countable unit: **file**, **asset**, **item**. "item" is vague and drops
the "these are files" signal. "file" is already the developer contract, so reusing it for the
end-user count noun would erase a useful distinction (what you pick from disk vs what lives in the
library). "asset" is a clean count noun that CONTEXT.md already used.

## Decisión

Four slots, each with one word:

1. **"Media"** — mass noun. The section brand and the act of choosing from the library ("Media",
   "Choose media"). Never used as a count.
2. **"asset"** (ES: "recurso") — the countable library unit. Counters, empty states, grid aria,
   library search: "3 assets", "No assets uploaded yet", "Asset library".
3. **"file"** (ES: "archivo") — the disk-side action and the developer contract. The dropzone, the
   upload button and the file input ("Choose file", "Drag & drop files here"), and the `file` prop
   type a consumer declares. The upload widget speaks "file"; the library grid speaks "asset".
4. **"image"** — kept only on surfaces that act on an image specifically: alt text, dimensions,
   responsive variants, `<BlockImage>`, and the picker opened in `image` mode. Widening these would
   be wrong, not more inclusive (a video takes no alt text; the responsive pipeline is raster-only,
   ADR-0017).

The **§3 boundary** (named after the issue's section 3) is the discriminator: *does this surface act
on an image, or hold any asset?* Act-on-image keeps "image"; hold-any-asset uses media/asset/file per
the slots.

The deliberate consequence is a **two-layer split**: the code contract stays **"file"**, the
end-user copy says **"asset"/"media"**. A consumer defines a `file` prop in a schema; the person
filling it in sees "Choose media". This mirrors DDD's internal-vs-published language (the entity is a
`file`; the reader sees an asset).

## Consecuencias

- All future admin media copy follows these slots. New media strings pick their word by the §3
  question, not by copying a neighbour.
- Key **names** in the i18n catalogs are renamed to stop lying (`imageLibraryAriaLabel` →
  `libraryAriaLabel`, `imageLoadError` → `pickerLoadError`, `chooseImage` → `chooseFile`). Names are
  internal; the `i18n-catalog.test.js` parity test moves both catalogs together.
- The picker title becomes mode-dependent (`image` → "Choose image", `file` → "Choose media"),
  captured as RV1 in `media-uploads.md`.
- A contributor seeing "asset" in the UI and `file` in the code has this ADR as the answer to "why
  the mismatch?" — the split is intentional, not drift.
- Reversibility: copy is cheap to change, so this is not a costly-to-reverse decision. It earns an ADR
  for being **surprising without context** (the file/asset split) and the product of a **real
  trade-off** (media / asset / file / item), and because it governs an open-ended stream of future
  copy decisions rather than a one-off.
- The vocabulary is mirrored operationally in `CONTEXT.md §3` (glossary + convention).
