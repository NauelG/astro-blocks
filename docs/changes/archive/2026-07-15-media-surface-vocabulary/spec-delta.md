<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Media surface vocabulary

Most of this change is copy and documentation, which the living specs do not govern. There is exactly
one behavioural delta — the picker titles itself by prop type — plus a durable vocabulary rule worth
recording so future media copy stays consistent.

## ADDED: Admin media surfaces are type-honest (`media-uploads.md`)

New capability section, sibling to the existing catalog/ingest/serving requirements. The media
subsystem accepts image, video, audio and document categories (R1–R3 of that spec); the admin
surfaces must not contradict that.

> **RV1 — The picker titles itself by prop type.** The block-form media picker is opened for a prop
> whose type is `image` or `file`. In `image` mode it presents as an image chooser; in `file` mode it
> presents as a media chooser. The title, dialog aria-label and close-button aria-label are set on
> every open from the mode — never baked to a single type.
>
> **RV2 — Container surfaces name any asset, not "image".** Surfaces that hold or count the library
> as a whole — the library grid and its aria label, the counters, the empty state, the search, the
> dropzone, the picker grid — speak of media, assets or files. They never call a video, an audio file
> or a document an "image". A library of three videos reports "3 assets", not "3 images".
>
> **RV3 — Image-acting surfaces keep "image".** Surfaces that act on an image specifically — alt text
> (a WCAG 1.1.1 concept for images), image dimensions, responsive variants, `<BlockImage>`, and the
> picker opened in `image` mode — continue to say "image". Widening these to "media" would be wrong,
> not more inclusive.
>
> **RV4 — Every admin media string is localized.** No admin media control renders a hardcoded
> user-facing string; every one resolves through the i18n catalog (`ct()`/`t()`), on both the initial
> render and the in-place update path. This closes the `file`-field and image-field dynamic-label
> gaps where English literals shipped regardless of locale.

The user-facing vocabulary these requirements assume (mass "media", countable "asset", disk/contract
"file", image-acting "image") is defined in `CONTEXT.md §3` and justified in
`docs/adr/0026-media-user-facing-vocabulary.md`.

## No other behavioural delta

The catalog, ingest, serving, allowlist and denylist requirements of `media-uploads.md` are
unchanged. Key renames in the i18n catalogs are internal (guarded by the existing
`i18n-catalog.test.js` parity test) and carry no behavioural meaning.
