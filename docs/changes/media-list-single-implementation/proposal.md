<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — The media list has one implementation

_Resolves [#104](https://github.com/NauelG/astro-blocks/issues/104) (P2, bug) and closes
[#103](https://github.com/NauelG/astro-blocks/issues/103) as a non-bug. Grilled 2026-07-27._

## Problem

ADR-0020 decided that search and pagination for the media library happen **once, server-side**,
shared by both consumers, "rather than each re-implementing filtering client-side". The handler
implements that decision exactly (`src/api/handlers/media.ts:427-457`). Both consumers re-implement
it anyway, at the two edges the ADR never looked at.

**1. The SSR paint re-implements the pipeline by not running it.** `src/routes/admin/media.astro:30-31`
calls `loadMedia()` and `:142` maps the **entire registry** into cards — no reconcile, no
newest-first sort, no `q`, no slice. The whole point of ADR-0020 is what the admin page does on first
paint.

**2. The picker re-implements the type filter client-side, after the slice.**
`src/routes/admin/client/block-form/picker-dialog.ts:213-214` filters the server's page by
`activePickerAccept` **after** the server sliced it. So "0 shown of N total" is renderable while
matching files sit on later pages, and `total` — hence the pager — is the unfiltered count.

## What the issue got wrong, and what it missed

#104 proposes that the SSR paint "render the same first page the endpoint would return (sorted,
sliced, `limit`-bounded)". Reading the consumers says that is the wrong fix, and that the defect is
worse than reported.

**The SSR grid is not slow content — it is discarded content.** `initMediaPage()`
(`src/routes/admin/client/media.ts:606-613`) calls `loadMedia()` **unconditionally** on every page
load, and `renderGrid()` replaces `#cms-media-grid-card` wholesale. The server-rendered grid is
built, serialised, shipped and thrown away on every single visit. It is also not *usable* while it
exists: the toolbar is born `cms-hidden` (`media.astro:112`) and is only revealed by `renderGrid()`
(`media.ts:142`), so nothing can be searched or paged until the JS lands. There is no `noscript`
anywhere in `src/` — the admin requires JS by design.

Making the SSR paint replicate the endpoint's pipeline would therefore keep a payload nobody reads,
keep the duplicated card markup, keep the three formatters `media.astro:46-64` duplicates
byte-for-byte from `media-fetch.ts` (with a warning comment and `tests/media-formatters.test.js`
holding them in sync), and **add** a second implementation of ADR-0020's pipeline to keep in sync
with the first.

**Two latent defects the issue does not mention, both worse than the one it reports:**

- **The image picker offers non-images.** `renderPickerGrid` filters only in `file` mode
  (`picker-dialog.ts:213`); in `image` mode every entry is shown, and `renderPickerItem` happily
  draws a document icon for it. Picking one writes a PDF's URL into an image field's `url`. The
  upload input *is* restricted to `image/*` (`:377`) — the grid is not.
- **A stricter allowlist produces a more permissive picker.** `computeEffectiveAccept`
  (`file-accept.ts:48`) is `intersectAccept(def.accept, getGlobalAllowlist())`. A prop declaring
  `accept: ['application/pdf']` on an instance that has since removed PDF from `allowedFileTypes`
  yields `[]` — and the guard `activePickerAccept.length > 0` then disables the filter entirely, so
  the picker shows **everything**. Exactly backwards.

The root of both is that one variable, `effectiveAccept`, serves two different questions: *what may
be uploaded* and *what may be picked from what is already uploaded*.

## #103 is a non-bug

#103 claims a legacy plain-string `seo.image` is never matched by the usage scan, so deleting a
media entry that only that field references reports "used in 0 places". Verified against the code and
empirically disproved:

- `withLegacyLocale` (`src/api/data.ts:200-204`) wraps any non-object into
  `{ [LEGACY_FALLBACK_LOCALE]: value }` **before** `findMediaUsages` sees it, so the
  `typeof page.seo.image === 'object'` guard at `:578` always holds and the shallow
  `Object.values(...).some(...)` finds the string.
- `normalizePageSeo` (`src/api/handlers/pages.ts:62`) accepts `typeof seo.image === 'string'` and
  nothing else, so the API cannot produce another shape either.

A probe writing `seo: { image: '/uploads/…' }` straight to `pages.json` returns `count: 1`, not `0`.
Routing the seo branch through the `image-url-scan.ts` walker would be a no-op refactor.

The real residue is small and comes along for the ride: `tests/media-usage.test.js`'s **FMU-03 is
titled "seo.image plain string" but its fixture is `seo: { image: { en: TARGET } }`** — a map. The
legacy shape is never exercised, so nothing would catch a future removal of `withLegacyLocale` from
the seo path. And `src/utils/image-url-scan.ts:18` documents shape S-E as if the walker covered the
seo path, which it does not.

## Scope

One change, four vertical slices:

1. **`?accept` on `GET /cms/api/media`** — filter by exact MIME equality **before** the slice, so
   `total` and the pager stay coherent.
2. **`browseAccept` / `uploadAccept`** — split the two questions `effectiveAccept` conflates. The
   picker sends `browseAccept` and deletes its client-side filter; `image` mode sends the catalog's
   `category: 'image'` rows.
3. **The SSR shell** — `media.astro` stops rendering cards, leaving one card renderer in the codebase.
4. **The #103 residue** — FMU-03 exercises the legacy string; the S-E comment is corrected.

## Out of scope, tracked separately

**`reconcileMedia()`'s cost on every list read.** ADR-0020 already flagged it; measuring it says it
is worse than the ADR implies. `reconcileMedia` (`src/api/data.ts:816`) takes the media **file lock**,
does one `fs.access` per registry entry, and walks the whole of `public/uploads/**` (`readdir` +
`stat` per year/month directory) — on every `GET /cms/api/media`, which the search box issues per
keystroke behind a 250 ms debounce. So typing serialises repeated full directory walks against the
lock that uploads and deletes need.

That is real, and it is a **performance and concurrency** decision with its own trade-offs (when do
phantom entries get pruned?). Folding it into a change about API contracts and rendering ownership
would make the diff unreviewable and ADR-0036 ambiguous about what was actually decided. New issue,
with the measurement above as its evidence.

## Non-goals

- Moving, caching or gating `reconcileMedia()` (above).
- Per-prop `accept` enforcement on **upload** ([#102](https://github.com/NauelG/astro-blocks/issues/102)) —
  a different endpoint and a different question. This change sharpens the vocabulary #102 needs, it
  does not answer it.
- A skeleton / spinner design pattern. `src/` and `docs/DESIGN.md` have none, and inventing one
  inside a fix means CSS, a card count, motion (and `prefers-reduced-motion`), and a new `DESIGN.md`
  rule.
- `docs/media.md` / `README.md`. `README.md:640` documents `/cms/api/[...path]` as *"Internal API used
  by the admin UI — do not call directly"*: `?accept` is not consumer surface.
- A new playground demo. `VideoEmbed.schema.ts:20` (`accept: ['video/mp4']`) and
  `DownloadButton.schema.ts:11` (`accept: ['application/pdf']`) already exercise both `browseAccept`
  paths.

## Acceptance criteria

- [ ] `GET /cms/api/media` accepts `?accept=<comma-separated MIMEs>`, filtering by exact
      lowercase equality against `mimeType` **before** the slice; `total` reflects the filtered set.
      Absent or empty = no filter. No intersection with the allowlist.
- [ ] `browseAccept` and `uploadAccept` are separate, named, and documented in `CONTEXT.md §3`.
      `uploadAccept` (allowlist-intersected) still drives the upload input's `accept` attribute.
- [ ] `renderPickerGrid` no longer filters: the server's page is rendered as received. The
      `activePickerAccept.length > 0` guard is gone with it.
- [ ] The image-mode picker does not offer non-image entries.
- [ ] A prop whose declared `accept` is absent from the allowlist still filters the picker (it no
      longer disables filtering).
- [ ] `media.astro` renders no media cards: no `loadMedia`, no card markup, no local `formatBytes` /
      `formatDimensions` / `formatMediaDate`, no `resolveTileCategory` / `categoryThumbClass` /
      `CATEGORY_ICON` / `ImageIcon`. `client/media.ts:renderCard` is the only card renderer.
- [ ] The grid container renders a localized `role="status"` loading line until page 1 lands; keys
      exist in both `en.ts` and `es.ts`.
- [ ] `tests/media-usage.test.js` FMU-03 exercises a **plain string** `seo.image`;
      `image-url-scan.ts`'s S-E comment states that the seo path does not use the walker.
- [ ] Unit tests `ML-R7-*` in `tests/media-list.test.js`; two e2e assertions (raw admin HTML has no
      `.cms-media-card`; the image picker does not offer a PDF).
- [ ] ADR-0036 written; `CONTEXT.md §3` glossary entry added; `spec-delta.md` applied at Archive.
- [ ] `npm run typecheck` · `npm test` · `npx biome ci .` · `npx playwright test` green.
