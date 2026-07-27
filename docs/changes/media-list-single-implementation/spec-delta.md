<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — The media list has one implementation

Target: `docs/specs/media-uploads.md`, the **Admin** section. Adds R35–R37, modifies R7's framing and
R30's enumeration. Nothing is removed: the ingest gate (R15–R23) and the serving rules (R24–R29) are
untouched — this change never crosses the upload path.

---

## ADDED: R35 — One implementation of the media listing

> **R35 — `handleGetMedia` is the only implementation of "which media entries are listed, in what
> order".** No consumer sorts, filters or slices the library on its own. A consumer that needs a
> different set says so with a query parameter — `q`, `page`, `limit`, `accept` — and renders the
> envelope as received.
>
> The admin media page therefore **renders no media cards server-side**. Its grid container ships a
> localized `role="status"` loading line, and `client/media.ts` fetches page 1 and renders it. This is
> not a performance trade: `initMediaPage()` has always replaced the server-rendered grid
> unconditionally, and the toolbar has always been hidden until that replacement, so the SSR grid was
> built, shipped and discarded on every visit while being unusable in the interim.
>
> One consequence is load-bearing: **`client/media.ts:renderCard` is the only card renderer in the
> codebase.** There is no second implementation that first paint and re-render can disagree about.

## ADDED: R36 — `accept` filters the listing, and does not consult the allowlist

> **R36 — `GET /cms/api/media` accepts `?accept=<comma-separated MIME list>`.** Values are trimmed,
> lowercased, and blanks dropped; an entry matches on **exact equality** with its `mimeType`, never a
> prefix or a wildcard. The filter runs **beside `q` and before `total`**, so `total`, `page` and
> `limit` all describe the same filtered set and the pager cannot lie. Absent, empty, or all-blank =
> no filter. A MIME the catalog does not know simply matches nothing: an empty page, **200**, not an
> error.
>
> **The filter is not intersected with `allowedFileTypes`.** The allowlist is the *upload* gate (R7,
> R16); this is a *read* over files already on disk. Narrowing `allowedFileTypes` must never hide an
> asset that published pages still reference, nor strand an owner who cannot re-select it. (ADR-0036)

## ADDED: R37 — `uploadAccept` and `browseAccept` are different questions

> **R37 — A media-bearing prop has two accept lists, and they are not the same list.**
>
> - **`uploadAccept` = `def.accept ∩ allowedFileTypes`** — what the field may **upload**. It drives
>   the file input's `accept` attribute. Intersecting is right here: offering to upload what the
>   server will reject is a lie. (This is the list R7 calls "a picker hint, never the gate".)
> - **`browseAccept` = `def.accept` as declared**, or — when the prop declares none — every catalog
>   row of the picker's mode category, or empty for an unrestricted `file` prop. It is what the field
>   may **pick from what already exists**, and it is what travels in `?accept`. Not
>   allowlist-intersected, per R36.
>
> Collapsing the two produced two defects, both fixed by the split rather than patched: an
> `image`-mode picker offered documents and video as selectable, and a prop whose declared `accept`
> had been dropped from the allowlist produced an **empty** intersection that disabled filtering
> entirely — so a stricter allowlist yielded a **more permissive** picker.

---

## MODIFIED: R7 — name which accept it is talking about

R7's closing paragraph describes "the upload `accept` attribute" as a picker hint. That statement
stays true and stays in force; it is now explicitly about **`uploadAccept`** (R37), so a reader
cannot carry it over to the listing filter, where the opposite rule applies (R36).

The empty-allowlist consequence R7 records — the resolved list is `[]`, `accept` renders empty, and
HTML reads that as *accept-anything* at the file dialog — is unchanged and remains cosmetic, because
the server still rejects every selected file.

## MODIFIED: R30 — two grids resolve a tile, not three

R30 currently names three surfaces: "the media library, the client-side media grid and the block
picker". The first two were the same grid rendered twice; the server-rendered one is gone (R35). R30
now names **the client-side media grid and the block picker**, both still resolving the tile from
`fileCategory` through `src/utils/media-tile.ts`. The rule is unchanged — one fewer place to apply it.

---

## Scenarios

- **S13.** A prop declares `accept: ['application/pdf']`; the library holds 30 images and 5 PDFs.
  Open the picker → **5 assets, `total: 5`**, one page, no "load more". *(Previously: page 1 was 24
  images, of which 0 survived the client filter, over a `total` of 35.)*
- **S14.** An `image` prop's picker, in a library holding a PDF and an MP4 → **neither is offered**.
  *(Previously: both were offered, and picking one wrote its URL into the image field.)*
- **S15.** `allowedFileTypes` no longer contains `application/pdf`; a prop still declares
  `accept: ['application/pdf']`. Open the picker → **the already-uploaded PDFs, and only those**.
  *(Previously: `effectiveAccept` was `[]`, the guard disabled filtering, and the picker showed
  everything.)*
- **S16.** `GET /cms/api/media?accept=application/x-nope` → **200**, `total: 0`, `uploads: []`.
- **S17.** `GET /cms/api/media?q=hero&accept=image/png&limit=10` → `total` counts entries matching
  **both**, and the returned page is a slice of that set.
- **S18.** Load `/cms/admin/media` and read the raw HTML → **no `.cms-media-card`**, one
  `role="status"` loading line. The rendered page shows the newest 24 assets once the client fetch
  lands.
