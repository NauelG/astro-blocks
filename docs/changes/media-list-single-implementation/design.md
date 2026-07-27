<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — The media list has one implementation

The organising principle, stated once: **`handleGetMedia` is the only implementation of "which media
entries are listed, in what order". A consumer that needs a different set expresses it as a
parameter, never as a filter of its own.** Everything below is a consequence.

## 1. `?accept` on `GET /cms/api/media`

`handleGetMedia` (`src/api/handlers/media.ts:427-457`) gains one parameter. The pipeline order is
unchanged except for where the type filter lands:

```
reconcile → sort newest-first → filter(q) → filter(accept) → total = filtered.length → slice(page)
```

The `accept` filter sits **beside `q`, before `total`**. That placement is the entire fix for the
pager: `total` counts what survives both filters, so `page`/`limit` divide a set the consumer can
actually see.

```ts
// Parse: comma-separated MIME list. Absent, empty, or all-blank → no filter.
const acceptRaw = url.searchParams.get('accept') ?? '';
const accept = acceptRaw
  .split(',')
  .map((m) => m.trim().toLowerCase())
  .filter((m) => m !== '');

// …after the q filter:
const typed =
  accept.length > 0
    ? filtered.filter((entry) => accept.includes(entry.mimeType.toLowerCase()))
    : filtered;
```

**Exact equality, never prefix or wildcard** — the same rule `image-url-scan.ts` follows for URLs, and
for the same reason: `image/svg+xml` must not be matched by a caller asking for `image/sv`.

**No intersection with `getAllowedFileTypes()`, deliberately.** This is a *read* endpoint over files
that are already on disk. The allowlist governs the upload gate (spec R7, R16). Intersecting here
would mean that narrowing `allowedFileTypes` hides already-uploaded assets that are still referenced
by published pages, with no way for the owner to select them again. An unknown MIME therefore matches
nothing and yields an empty page — a coherent answer, not an error. See ADR-0036.

`fetchMedia` (`src/routes/admin/client/media-fetch.ts:40-54`) gains the param on the same
"only send what was supplied" rule as `q`:

```ts
export async function fetchMedia(params?: {
  q?: string;
  page?: number;
  limit?: number;
  accept?: string[];
}): Promise<MediaListEnvelope>
// …
if (params?.accept !== undefined && params.accept.length > 0) qs.set('accept', params.accept.join(','));
```

The admin grid (`client/media.ts`) sends no `accept` and is unaffected: the library shows everything.

## 2. `browseAccept` vs `uploadAccept`

Two questions, today collapsed into `effectiveAccept`:

| | Question | Rule | Consumer |
|---|---|---|---|
| **`uploadAccept`** | What may this field **upload**? | `def.accept ∩ allowlist` | the file input's `accept` attribute (`picker-dialog.ts:377`) |
| **`browseAccept`** | What may this field **pick from what already exists**? | `def.accept` as declared; if absent, every catalog row of the field's category | the `?accept` query param |

`uploadAccept` keeps intersecting with the allowlist, because offering to upload something the server
will reject is a lie. `browseAccept` does not, for the reason in §1.

`src/routes/admin/client/block-form/file-accept.ts` grows a second exported function and renames the
existing one to say which question it answers:

```ts
/** What this field may UPLOAD: def.accept ∩ global allowlist. Drives the file input's accept attr. */
export function computeUploadAccept(def: PrimitivePropDef): string[] {
  return intersectAccept(def.accept, getGlobalAllowlist());
}

/**
 * What this field may PICK from the existing library.
 *
 * NOT intersected with the allowlist (ADR-0036): an asset uploaded while a type was enabled stays
 * selectable after that type is switched off, because published pages may still reference it.
 *
 * An empty result means "no type filter" — the whole library — which is what an unrestricted
 * `file` prop means.
 */
export function computeBrowseAccept(def: PrimitivePropDef, mode: 'image' | 'file'): string[] {
  if (def.accept && def.accept.length > 0) return def.accept.map((m) => m.toLowerCase());
  return mode === 'image' ? mimesForCategory('image') : [];
}
```

The mode is the discriminator, and it is already what the picker branches on everywhere else
(`picker-dialog.ts:213`, `:243`, `:377`; spec R31). An `image` prop declares no `accept` — the type
*is* the constraint — so its `browseAccept` comes from the catalog:

```ts
// utils/file-catalog.ts — derived from the rows themselves, so there is no second list to sync.
// Browser-safe: resolveCatalog() reads through readBakedConfig, same as getGlobalAllowlist().
export function mimesForCategory(category: FileCategory): string[] {
  return resolveCatalog().filter((row) => row.category === category).map((row) => row.mime);
}
```

A `customFileTypes` row registered as `category: 'image'` is therefore pickable in image fields,
which is the correct reading of the registration.

This is what kills both latent defects by construction. The image picker gets a non-empty filter for
the first time, and a prop whose declared `accept` is absent from the allowlist keeps filtering
instead of falling through the `length > 0` guard into showing everything.

## 3. The picker stops filtering

`picker-dialog.ts`:

- `renderPickerGrid` (`:207`) renders `pickerState.items` as received. The `visibleItems` computation
  (`:212-215`), the `activePickerAccept` module variable (`:54`) and its assignment (`:326`) are
  deleted. `pickerCountOf` is fed `items.length` and the envelope's `total`, both of which now
  describe the same filtered set — so `allLoaded = items.length >= total` is finally true when it
  says it is.
- `pickerLoadPage` (`:292`) passes `accept: activePickerBrowseAccept` to `fetchMedia`.
- `openPickerDialog` (`:315`) stores `browseAccept` for the dialog's lifetime, exactly where
  `activePickerAccept` was stored, and keeps `uploadAccept` for the input's `accept` attribute
  (`:377`) unchanged.

Net: the picker gains one field on a fetch call and loses a filter, a guard and a module variable.

## 4. The SSR shell

`src/routes/admin/media.astro` stops rendering the grid. Deleted: the `loadMedia` import and call
(`:11`, `:30-31`), the empty-state and `uploads.map(...)` blocks (`:134-200`), the three local
formatters (`:46-64`), and the now-unused `ImageIcon` (`:10`) and
`CATEGORY_ICON` / `categoryThumbClass` / `resolveTileCategory` (`:16`) imports.

`#cms-media-grid-card` keeps its id — `renderGrid` targets it — and holds one line:

```astro
<div class="cms-card cms-card--no-padding" id="cms-media-grid-card">
  <p id="cms-media-loading" class="cms-muted cms-media-loading" role="status" aria-live="polite">
    {t('media.loading')}
  </p>
</div>
```

`cms-muted` already exists, so **no new CSS and no new `DESIGN.md` rule**. `cms-media-loading` is a
spacing hook only, if padding proves necessary; no animation, no skeleton. `role="status"` +
`aria-live="polite"` is the accessible half: a screen reader is told something is in flight, which
matters precisely because `reconcileMedia`'s directory walk (out of scope, §Non-goals) can make that
wait long.

The **toolbar stays `cms-hidden`** until `renderGrid` reveals it (`media.ts:142`) — unchanged.
Revealing it earlier would show an empty page indicator and pager buttons with no state behind them.

`renderGrid`'s existing `total === 0` branch already owns the empty state (`media.ts:145-165`), so
the SSR copy is redundant, not lost.

Two consequences worth naming:

- **`client/media.ts:renderCard` becomes the only card renderer.** The comment at `media.ts:70-71`
  — *"This grid and the server-rendered one in media.astro must agree, or the same file gets two
  different tiles"* — is deleted, because the condition it warns about no longer exists.
- **`tests/media-formatters.test.js` keeps passing untouched.** It asserts the contract of the
  formatters in `media-fetch.ts`; only the SSR duplicates go away. Its header comment is updated to
  drop the "both copies" framing.

### What does not break

`e2e/media-video.spec.ts:72-75` asserts on `.cms-media-card[data-media-url=…]` and
`.cms-media-card-thumb--video`. Because `initMediaPage()` already replaces the SSR grid
unconditionally, that assertion is **already** running against `renderCard`'s output today. Removing
the SSR cards cannot affect it.

## 5. i18n

One key in both catalogs (`tests/i18n-*` parity is compiler-enforced — ADR-0034 — so both are
mandatory):

| key | `en.ts` | `es.ts` |
|---|---|---|
| `media.loading` | `Loading assets…` | `Cargando recursos…` |

"assets" / "recursos" is the countable-library-item noun per spec R32 and `CONTEXT.md §3` — not
"images", and not "media".

## 6. The #103 residue

- `tests/media-usage.test.js` FMU-03 currently writes `seo: { image: { en: TARGET } }` under the
  title *"seo.image plain string"*. The fixture becomes `seo: { image: TARGET }` — the actual legacy
  shape — and the assertion is unchanged (`count: 1`, `source: 'seo'`), because normalization is what
  makes it pass. That is the point: the test now fails if `withLegacyLocale` ever stops covering the
  seo path.
- `src/utils/image-url-scan.ts:18` — the S-E line is corrected to say the walker emits that shape for
  block props, and that `findMediaUsages` handles `seo.image` directly because `normalizePage` has
  already reduced it to a locale map.

## 7. Test plan

**Unit — `tests/media-list.test.js`, `ML-R7-*`:**

| id | scenario | asserts |
|---|---|---|
| `ML-R7-filter` | 3 png + 2 pdf, `accept=application/pdf` | `total: 2`, both uploads are pdf |
| `ML-R7-before-slice` | 30 png + 5 pdf, `accept=application/pdf&limit=24` | `total: 5` (not 35), 5 uploads — the defect #104 reports |
| `ML-R7-absent` | no `accept` | identical envelope to today |
| `ML-R7-empty` | `accept=` and `accept=,,` | no filter |
| `ML-R7-unknown` | `accept=application/x-nope` | `total: 0`, empty uploads, **200** |
| `ML-R7-ci` | entry `IMAGE/PNG`, `accept=image/png` | matched — comparison is lowercase on both sides |
| `ML-R7-multi` | `accept=image/png,application/pdf` | union of both |
| `ML-R7-not-allowlisted` | entry whose MIME is outside `allowedFileTypes` | still returned — the read endpoint does not consult the allowlist |
| `ML-R7-with-q` | `q` + `accept` together | both applied; `total` reflects the intersection |

**Unit — `tests/media-usage.test.js`:** FMU-03 rewritten per §6.

**e2e** — each assertion made in the layer where the absence exists:

1. `admin-flow.spec.ts` — an authenticated `request.get('/cms/admin/media')` returns HTML containing
   **no** `cms-media-card`. Uses the raw response, not the rendered page, so it tests the server
   output rather than what the client later paints.
2. `admin-flow.spec.ts` — with a PDF in the library, open an image-prop picker and assert the PDF is
   **not** among the offered items.

Both are absences; neither is provable from the handler.
