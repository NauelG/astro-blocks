<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — The media list has one implementation

Vertical slices, four commits. The endpoint lands first with its tests (T1–T2, commit **A**); the
accept vocabulary and the picker follow (T3–T7, commit **B**); the SSR shell (T8–T10, commit **C**);
the #103 residue (T11, commit **D**). Glossary and full verification close it (T12–T13).

`npm test` runs `npm run build` first (`package.json:70`) and tests import from `../dist/…`, so every
verify step is plain `npm test` unless noted.

> **Eight plan-time findings folded in.**
>
> 1. **`uploadAccept` already exists as a name, in the code, for exactly this meaning.**
>    `media.astro:24` declares `const uploadAccept` for the dropzone's `accept` attribute. The
>    proposal invented no vocabulary — it named a distinction the codebase had half-made. The picker's
>    variables must use the same two names so grep finds all of it.
> 2. **`blockForm.pickerLoading` is an exact precedent for the shell's loading line**: `'Loading
>    assets…'` / `'Cargando recursos…'`, rendered as `<p class="cms-muted">` (`picker-dialog.ts:75`,
>    `:357`). `media.loading` mirrors it **verbatim** — same wording, same class. No new variant.
> 3. **`tests/media-copy-guard.test.js` §4 `containerKeys` is a hand-maintained list.** A new
>    container-surface key escapes the "never says image" guard unless it is added. `media.loading`
>    goes in it — otherwise we ship an unguarded container string in the same change that cites R32.
> 4. **`tests/media-formatters.test.js` does not parse `media.astro`.** It imports the client copy and
>    asserts snapshot values (its own header, `:16-18`, says the frontmatter cannot be imported). It
>    keeps passing untouched; only its header comment (`:8-19`) and `tests/media-tile.test.js:9-13`
>    ("Three grids draw media entries…") go stale and must be corrected to two.
> 5. **`media.astro` keeps more than the design implied.** `loadSite` stays (`:66`,
>    `<AdminLayout site={site}>`) and the whole `readBakedConfig`/`decodeAllowlist`/`uploadAccept`
>    block (`:18-27`) stays — that is the **dropzone**, not the grid. Only `loadMedia`, the cards and
>    the three formatters go.
> 6. **i18n parity is a compile error, not a test.** `CatalogKey = keyof typeof en`
>    (`i18n/catalog-key.ts`, ADR-0034), so adding a key to `en.ts` without `es.ts` fails `tsc` with
>    TS1360. No separate parity step is needed.
> 7. **`accept` is plumbed through a DOM attribute, not a call argument.** `field-renderers.ts:197`
>    computes it, `:154` serialises it into `data-file-accept`, and `mount.ts:337-344` `JSON.parse`s
>    it back before `openPickerDialog(btn, inputId, 'file', effectiveAccept)`. The image call site
>    (`mount.ts:307`) passes `[]`. Splitting the concept therefore means deciding the **transport** —
>    see T6.
> 8. **Unauthenticated SSR exposure — out of scope, handled privately.** No admin route has a
>    server-side auth check (no middleware; `layout.astro`'s frontmatter has no `getAuth` /
>    `Astro.redirect`; the login form is a `cms-hidden` div revealed by client JS at `:392`). So
>    `/cms/media`, `/cms/pages`, `/cms/configs` and `/cms/languages` serve their data to anyone.
>    (`configs` values are masked — `configs.astro:87` — and `users.astro` loads only `site`, so no
>    secrets or emails leak.) **T8 closes the media half as a side effect**, which is worth knowing
>    while reviewing that diff. The systemic fix is a private security advisory and its own cycle —
>    `SECURITY.md` and `README.md:742` forbid a public issue.

---

## Commit A — the endpoint

### T1 — `?accept` tests (red)

- [x] **File:** `tests/media-list.test.js` — add the `ML-R7-*` block, reusing the file's existing
  `withTempProject` + `writeJson` + auth helpers.

  | id | fixture / query | asserts |
  |---|---|---|
  | `ML-R7-filter` | 3 png + 2 pdf, `accept=application/pdf` | `total: 2`; every upload is pdf |
  | `ML-R7-before-slice` | 30 png + 5 pdf, `accept=application/pdf&limit=24` | `total: 5` (**not 35**) and 5 uploads — the defect #104 reports |
  | `ML-R7-absent` | no `accept` | envelope identical to today's |
  | `ML-R7-empty` | `accept=` and `accept=,,` | no filter applied |
  | `ML-R7-unknown` | `accept=application/x-nope` | **200**, `total: 0`, `uploads: []` |
  | `ML-R7-ci` | entry stored as `IMAGE/PNG`, `accept=image/png` | matched (lowercase both sides) |
  | `ML-R7-multi` | `accept=image/png,application/pdf` | union of both |
  | `ML-R7-not-allowlisted` | entry whose MIME is outside `allowedFileTypes` | still returned — the read endpoint never consults the allowlist (ADR-0036) |
  | `ML-R7-with-q` | `q=hero&accept=image/png` | both applied; `total` is the intersection |

- **Verify:** `npm test` — the `ML-R7-*` tests fail; every other suite green.

### T2 — `?accept` in `handleGetMedia` (green)

- [x] **File:** `src/api/handlers/media.ts` — in `handleGetMedia` (`:427-457`), parse `accept`
  (split `,` → trim → lowercase → drop blanks) and apply it **after the `q` filter and before
  `total`**, by exact equality against `entry.mimeType.toLowerCase()`. Pipeline becomes
  `reconcile → sort → filter(q) → filter(accept) → total → slice`.
  - Doc comment: exact equality only (never prefix/wildcard), and **why** the allowlist is not
    consulted — pointing at ADR-0036, so the next reader does not "harden" it.
- **Verify:** `npm test && npm run typecheck` — `ML-R7-*` green, no suite regresses.

### T3 — Commit A

- [x] `feat(api): add an accept type filter to the media listing endpoint`
  - Body: filters before the slice so `total`/`page`/`limit` describe one set; deliberately not
    intersected with `allowedFileTypes` (read endpoint vs upload gate). Refs #104, ADR-0036.

---

## Commit B — the accept vocabulary and the picker

### T4 — `mimesForCategory` (test-first)

- [x] **File:** `tests/file-catalog.test.js` — `mimesForCategory('image')` returns the six builtin
  image MIMEs and none of the pdf/video/audio rows; `mimesForCategory('video')` returns the two video
  rows. (Red first.)
- [x] **File:** `src/utils/file-catalog.ts` — export
  `mimesForCategory(category: FileCategory): string[]`, derived from `resolveCatalog()` so custom
  rows registered in a category are included and there is no second list to sync.
- **Verify:** `npm test` — new tests green.

### T5 — `computeUploadAccept` / `computeBrowseAccept`

- [x] **File:** `tests/file-accept.test.js` (new if absent, else extend) —
  - `computeUploadAccept({ accept: ['application/pdf'] })` with pdf **absent** from the allowlist → `[]`.
  - `computeBrowseAccept({ accept: ['application/pdf'] }, 'file')` in that same state →
    `['application/pdf']` — **the bug that made a stricter allowlist yield a more permissive picker.**
  - `computeBrowseAccept({}, 'image')` → the catalog's image MIMEs.
  - `computeBrowseAccept({}, 'file')` → `[]` (no filter = the whole library).
  - Mixed case in `def.accept` is lowercased by both.
- [x] **File:** `src/routes/admin/client/block-form/file-accept.ts` — rename
  `computeEffectiveAccept` → `computeUploadAccept` (body unchanged) and add `computeBrowseAccept(def,
  mode)` per `design.md` §2. Both doc-commented with which question they answer and why only one
  intersects the allowlist.
- **Verify:** `npm test && npm run typecheck`.

### T6 — Plumb both lists to the picker

Finding 7: the list travels as a DOM attribute. Both must, or the picker cannot know one of them.

- [x] **File:** `src/routes/admin/client/block-form/field-renderers.ts` — `:197` computes **both**;
  `fileFieldHtml` (`:131`, `:154`) emits `data-file-accept` (upload, unchanged — the file input reads
  it) **plus** `data-file-browse-accept`.
- [x] **File:** `src/routes/admin/client/block-form/mount.ts` — the file branch (`:331-348`) parses
  both attributes; the image branch (`:303-311`) passes `{ upload: [], browse: mimesForCategory('image') }`.
  Both call `openPickerDialog(btn, inputId, mode, accepts)` with the 4th argument now an object
  `{ upload: string[]; browse: string[] }` — an object rather than a 5th positional, so a future
  reader cannot swap them silently.
- [x] **File:** `src/routes/admin/client/block-form/picker-dialog.ts` —
  - `openPickerDialog` (`:315`) stores both; the upload input's `accept` (`:377`) reads `upload`
    (behaviour unchanged), and `pickerLoadPage` (`:292`) sends `browse` as `accept` to `fetchMedia`.
  - **Delete** `activePickerAccept` (`:54`, `:326`) and the `visibleItems` filter (`:212-215`).
    `renderPickerGrid` renders `pickerState.items` as received; `pickerCountOf` gets
    `items.length` and the envelope `total`, which now describe the same set.
  - Update the `renderPickerGrid` doc comment (`:203-206`) — it currently documents the client-side
    filter that this task deletes.
- [x] **File:** `src/routes/admin/client/media-fetch.ts` — `fetchMedia` takes `accept?: string[]` and
  sets the param only when non-empty, matching the existing "only send what was supplied" rule
  (`:49-51`).
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — no suite regresses; grep confirms
  zero remaining `activePickerAccept` and zero `computeEffectiveAccept`.

### T7 — e2e: the image picker does not offer non-images

- [x] **File:** `e2e/admin-flow.spec.ts` — logged in, with a PDF uploaded to the library, open an
  **image** prop's picker and assert no picker item carries the PDF's URL. Reuse the file's `login`
  helper (`:31`) and its existing picker-upload helper (`:77`).
  - This is the assertion that proves the latent defect is gone; it cannot be proven from the handler.
- **Verify:** `npm run build:playground && npm run e2e` — green. **Port 4321 must be free.**

### T8 — Commit B

- [x] `fix(admin): filter the media picker server-side by browse accept`
  - Body: splits `uploadAccept` (allowlist-intersected, drives the upload input) from `browseAccept`
    (as declared, drives `?accept`); fixes the image picker offering documents and video, and the
    empty-intersection guard that made a stricter allowlist show *everything*. Refs #104, ADR-0036.

---

## Commit C — the SSR shell

### T9 — i18n key + copy guard

- [x] **Files:** `src/routes/admin/i18n/en.ts`, `es.ts` — add `media.loading`, mirroring
  `blockForm.pickerLoading` verbatim (finding 2): `'Loading assets…'` / `'Cargando recursos…'`.
- [x] **File:** `tests/media-copy-guard.test.js` — add `media.loading` to §4's `containerKeys`
  (finding 3), so the "container surfaces never say image" guard covers it.
- **Verify:** `npm test && npm run typecheck` — TS1360 would fire if either catalog were missed.

### T10 — The shell

- [x] **File:** `src/routes/admin/media.astro` —
  - Delete: `loadMedia` from the `:11` import and its call (`:30-31`); the `ImageIcon` import (`:10`)
    and the `CATEGORY_ICON` / `categoryThumbClass` / `resolveTileCategory` import (`:16`); the three
    local formatters (`:38-64`) with their NOTE comment; the empty-state and `uploads.map(...)`
    blocks (`:134-200`).
  - Keep (finding 5): `loadSite`, the `readBakedConfig`/`decodeAllowlist`/`uploadAccept` block
    (`:18-27`) and the whole dropzone, the toolbar **still `cms-hidden`**, and the id
    `cms-media-grid-card` (`:133`) — `renderGrid` targets it.
  - `#cms-media-grid-card` now holds one line:
    `<p id="cms-media-loading" class="cms-muted" role="status" aria-live="polite">{t('media.loading')}</p>`.
- [x] **File:** `src/routes/admin/client/media.ts` — delete the `:70-71` comment ("This grid and the
  server-rendered one in media.astro must agree…"): the condition it warns about no longer exists.
- [x] **Files:** `tests/media-formatters.test.js` (`:8-19`) and `tests/media-tile.test.js` (`:9-13`) —
  correct the stale headers (finding 4). Formatters: one copy, in `media-fetch.ts`; tile rule: **two**
  grids, not three. No assertions change.
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — all green, including
  `html-escape-guard.test.js` (`media.astro` holds no sink and imports no escaper, so neither R2 nor
  R3 is affected).

### T11 — e2e: first paint carries no cards

- [x] **File:** `e2e/admin-flow.spec.ts` — with at least one asset uploaded, `request.get('/cms/media')`
  and assert the returned HTML contains **no** `cms-media-card`; then load the page normally and
  assert cards do appear once the client fetch lands.
  - Asserting on the **raw response**, not the rendered page, is the point: it tests the server's
    output rather than what the client later paints over it.
  - Per finding 8 this request needs no auth today. Assert the absence of cards **only** — do not
    encode the unauthenticated-access behaviour into a test, or the private advisory's fix will have
    to delete it.
- **Verify:** `npm run build:playground && npm run e2e` — green, including `media-video.spec.ts:72`
  (already asserting against `renderCard`'s output, per `design.md` §4).

### T12 — Commit C

- [x] `fix(admin): stop rendering the whole media registry on first paint`
  - Body: the SSR grid was built, shipped and unconditionally discarded by `initMediaPage()`, and was
    unusable while it existed (toolbar hidden); the page now ships a shell and the client renders
    page 1. Leaves one card renderer. Refs #104, ADR-0036.

---

## Commit D — the #103 residue

### T13 — FMU-03 exercises the real legacy shape

- [x] **File:** `tests/media-usage.test.js` — FMU-03 (`:140-161`) is titled *"seo.image plain string"*
  but its fixture is `seo: { image: { en: TARGET } }`, a map. Change the fixture to
  `seo: { image: TARGET }` — the actual on-disk legacy shape. Assertions unchanged (`count: 1`,
  `source: 'seo'`, `propName: 'seo.image'`): normalization is what makes them pass, and the test now
  fails if `withLegacyLocale` ever stops covering the seo path.
  - Add a comment naming `data.ts:200-204` as the reason it passes, so the next reader does not
    re-file #103.
- [x] **File:** `src/utils/image-url-scan.ts` — correct the S-E line (`:18`): the walker emits that
  shape for **block props**; `findMediaUsages` handles `seo.image` directly because `normalizePage`
  has already reduced it to a locale map.
- **Verify:** `npm test` — FMU-03 green against the legacy fixture.
- [x] Commit: `test(media): exercise the legacy string seo.image shape in the usage scan`
  - Body: #103 reported a blind spot that does not exist — `withLegacyLocale` normalises before
    `findMediaUsages` runs, and `normalizePageSeo` admits no other shape. The real gap was the test
    that claimed to cover the legacy shape and did not. Closes #103.

---

## Close

### T14 — Glossary

- [x] **File:** `docs/CONTEXT.md` §3 — one row after **Allowlist vs catalog** (`:110`), which it
  refines:

  > **`uploadAccept` vs `browseAccept`** — a media-bearing prop has two accept lists, and they are
  > different questions. `uploadAccept` = `def.accept ∩ allowedFileTypes`: what the field may
  > **upload**, driving the file input's `accept` attribute — intersecting is right, because offering
  > to upload what the server will reject is a lie. `browseAccept` = `def.accept` as declared (or the
  > catalog rows of the picker mode's category, or empty for an unrestricted `file` prop): what the
  > field may **pick from what already exists**, travelling in `?accept`. **Not**
  > allowlist-intersected — narrowing `allowedFileTypes` must not hide assets that published pages
  > still reference. Collapsing the two gave an image picker that offered documents, and an empty
  > intersection that disabled filtering entirely. (ADR-0036, #104)

- Folded into commit D, or its own `docs(context)` commit if D is already pushed.

### T15 — Full verification

- [ ] `npm run typecheck && npm test && npx biome ci .` — the four-check gate.
- [ ] `npm run features:validate`.
- [ ] `npm run build:playground && npm run e2e`.
- [ ] `grep -rn "activePickerAccept\|computeEffectiveAccept" src/` → **zero** hits.
- [ ] `grep -rn "uploads.map\|loadMedia" src/routes/admin/media.astro` → **zero** hits.
- [ ] Confirm no incidental changes under `playgrounds/` or `data/`.

### Not in this change

- **Version bump / `CHANGELOG`.** Per `AGENTS.md` these happen only when you ask to close. Note the
  tension to resolve then: the grilling settled on **patch 4.0.9** (every consumer-visible effect is a
  fix; `README.md:640` documents the API as internal), but commit A is a `feat`. If you would rather
  the version agree with the commit types, **4.1.0** is the defensible reading — your call at close.
- **The `reconcileMedia` cost issue** — to file (public, performance).
- **The unauthenticated SSR exposure** — private advisory, per finding 8. Not a public issue.
- **Closing #103** — the commit body closes it; the analysis comment is worth posting alongside.
