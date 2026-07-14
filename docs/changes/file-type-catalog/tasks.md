<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — A supported-file-type catalog, and video/audio on top of it

Vertical slices, TDD order: **red before green, always**. One commit per slice.

Legend: `[ ]` pending · `[x]` done

> **Why Slice 1 exists.** `tests/media-handlers.test.js:1330-1347` states, in the repo's own words,
> that the *"allowlisted + unmapped"* combination is **"not reachable via the prebuilt dist"** because
> the allowlist is a Vite compile-time constant. That combination **is this bug**. Someone reached it,
> could not test it, wrote a test for a neighbouring case, and left a comment declaring the 415
> *"guaranteed deterministically"* — canonising the defect as `FIX M-1`. Any plan that does not make
> that state reachable first will repeat exactly that story.

---

## Slice 1 — RED: make the state reachable, then encode the incident

**Goal:** a failing test that *is* the user's bug report. Not a neighbour of it.

- [x] **1.1** `src/api/handlers/media.ts` — add `__setAllowedFileTypesForTest(mimes: string[] | null)`
  beside the existing `resetAllowedFileTypesCache()` (`:69`), which already exists for exactly this
  purpose. Seeds `_allowedFileTypesCache` directly; `null` restores normal resolution.
  Update `tests/handlers-export-baseline.test.js:23` (the export baseline will fail otherwise).
- [x] **1.2** `tests/file-catalog.test.js` (new) — **S1, the incident**: with the allowlist forced to
  `['video/mp4']`, `POST` an MP4 body with `Content-Type: video/mp4` → assert **200**, stored filename
  ends in `.mp4`, `entry.fileCategory === 'video'`, `entry.variants` empty.
  Reuse `withTempProject` / `makeUploadRequest` from `tests/media-handlers.test.js`.
- [x] **1.3** `tests/uploads-get.test.js` — **S11, the AVIF bug**: `GET` a `.avif` file → assert
  `Content-Type: image/avif`.
- [x] **1.4** `tests/media-handlers.test.js:1330-1347` — **delete the `M-1` test and its comment.** It
  asserts the bug is the contract. Replace with the new contract: a MIME with no catalog row can never
  enter the effective allowlist (Slice 4 makes it true).

**Verify:** `npm test` → **1.2 fails with 415** and **1.3 fails with `application/octet-stream`**. If
either passes, it is testing nothing — fix the test before writing a line of source.

---

## Slice 2 — The catalog module

- [x] **2.1** `tests/file-catalog.test.js` — invariants: no two rows share a `mime` or an `ext`;
  `lookupByMime`/`lookupByExt` round-trip every row; **`DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog`**;
  `DEFAULT_ALLOWED_FILE_TYPES` still has exactly the 6 entries (video and audio are **not** in it);
  the `raster: true` rows are exactly `image/jpeg`, `image/png`, `image/webp`.
- [x] **2.2** `src/utils/file-catalog.ts` (new) — `FileCategory`, `FileTypeRow`, the 10 `BUILTIN_ROWS`
  (`design.md` §1), `DEFAULT_ALLOWED_FILE_TYPES` (unchanged, hand-written — it answers a *different*
  question from the catalog), `lookupByMime`, `lookupByExt`, `isRaster`, `intersectAccept` (moved
  verbatim from `file-types.ts`), plus `resolveCatalog()` + `resetFileCatalogCache()` reading
  `import.meta.env.ASTRO_BLOCKS_CUSTOM_FILE_TYPES`.

**Verify:** `node --test tests/file-catalog.test.js` green for 2.1's cases. Everything else still green
— nothing consumes the catalog yet.

---

## Slice 3 — Derive everything from the catalog; delete the five maps

**This is the slice that turns S1 and S11 green.** It is also the one that deletes the second,
undeclared allowlist.

- [ ] **3.1** `src/api/handlers/media.ts` — `MIME_TO_EXT[mimeType]` → `lookupByMime(...)`.
  `evaluateUpload` keeps receiving `derivedExtension: row?.ext ?? null` (ADR-0018's locked order is
  **untouched**). `fileCategory` (`:169`) → `row.category`, no longer `startsWith('image/')`.
  The `imageSize` guard (`:151`) → `row.category === 'image'`.
  The `if (!extension) return 415` (`:127-131`) → `throw` (500). A broken server invariant is not the
  client's unsupported file.
- [ ] **3.2** `src/utils/variant-generator.ts:42` — `RASTER_MIME.has(...)` → `row.raster`.
- [ ] **3.3** `src/routes/uploads-get.ts` — **delete** `MIME` (`:12`) and `IMAGE_CONTENT_TYPES` (`:24`).
  `contentType` and `disposition` come from `lookupByExt`. No row → `application/octet-stream` +
  `attachment`. The `if (ext === '.svg')` special case (`:48`) **disappears**: the `image/svg+xml` row
  carries `disposition: 'attachment'`. `?download` still forces `attachment`.
- [ ] **3.4** `src/types/index.ts:309` — `fileCategory?: 'image' | 'video' | 'audio' | 'document'`.
- [ ] **3.5** `src/api/data.ts:600-605` — the legacy-entry fallback resolves through the catalog,
  defaulting to `'document'`.
- [ ] **3.6** **Delete `src/utils/file-types.ts`.** Repoint `src/plugin/index.ts:19,219` and
  `src/routes/admin/client/block-form.ts:996` (`intersectAccept`) at `file-catalog.ts`.

**Verify:** `npm test` → **S1 (1.2) and S11 (1.3) are now GREEN.** `upload-gate.test.js`,
`variant-generator.test.js`, `uploads-get.test.js`, `allowed-file-types.test.js`,
`media-file-category.test.js` all still green. `npm run typecheck`. `grep -r "MIME_TO_EXT\|RASTER_MIME"
src/` returns **nothing**.

---

## Slice 4 — Config: the escape hatch, and the failure that is loud

- [ ] **4.1** `tests/file-type-config.test.js` (new) — **V1** a `customFileTypes` row with a denylisted
  MIME (`text/html`) throws; **V2** a denylisted `ext` (`.js`) throws — *the denylist beats the escape
  hatch*; **V3** a row shadowing a builtin (`image/png`) throws; **V4** a MIME in `allowedFileTypes`
  absent from catalog + custom (`application/zip`) throws, and the message **names the MIME**.
  Plus: a registered row is forced to `application/octet-stream` + `attachment` **whatever the consumer
  passed** (S3, S15).
- [ ] **4.2** `src/types/index.ts` — `AstroBlocksOptions` gains
  `customFileTypes?: Array<{ mime, ext, category }>` and `maxUploadBytes?: Partial<Record<FileCategory,
  number>>`. `customFileTypes` accepts **no** `disposition` and **no** `contentType` — that is the
  security property, expressed in the type.
- [ ] **4.3** `src/plugin/index.ts` — `validateFileTypeConfig()`, modelled on `validateGlobalBlocks()`
  (`:66-83`), which already **throws**. Called from `resolveOptions`. V4's message lists the supported
  MIMEs and points at `customFileTypes`.
- [ ] **4.4** `src/plugin/index.ts:409` — `vite.define` bridges for
  `ASTRO_BLOCKS_CUSTOM_FILE_TYPES` and `ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY`, alongside the
  existing `ASTRO_BLOCKS_ALLOWED_FILE_TYPES`. Extend `tests/plugin-resolve-options.test.js` (C3).
- [ ] **4.5** `src/api/handlers/media.ts#getAllowedFileTypes` — the resolved allowlist is intersected
  with the effective catalog: **`allowlist ∩ catalog`**. V4 already makes this a no-op for any valid
  config; it exists so that **no** configuration path — including one that bypasses build-time
  validation — can admit an uncatalogued MIME. It is what makes 3.1's `throw` unreachable rather than
  merely unlikely.
- [ ] **4.6** The existing warnings stay warnings: empty allowlist (`:208-212`) and
  `validateFileProps()` (`:255`). They describe configs that are a **no-op**, not configs the system
  **cannot honour**.

**Verify:** `npm test`, `npm run typecheck`. Every V-case throws with the offending MIME in the message.

---

## Slice 5 — Ingest: authorise before reading, branch on category

- [ ] **5.1** `tests/media-upload-limits.test.js` (new) — **S7** `Content-Length` over the limit → 413
  **and the request body is never read**; **S8** a body that lies and overruns mid-stream → 413 **and no
  file remains on disk** (the failure mode that matters); **S9** `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` clamps
  below a larger `maxUploadBytes.video`; per-category defaults (image 5 MB unchanged, document 10, audio
  20, video 200).
- [ ] **5.2** `src/api/handlers/media.ts` — resolve `limit(row.category)` =
  `min(maxUploadBytes[cat] ?? default, envCeiling ?? Infinity)`. Reject on `Content-Length` **before**
  touching the body.
- [ ] **5.3** `src/api/handlers/media.ts#handleUpload` — branch on `row.category`:
  `image` → `arrayBuffer()` as today; everything else → stream `request.body` to
  `fs.createWriteStream(tmpPath)` with a byte counter that is **the authority** (`Content-Length` is
  client-supplied). Overrun → destroy, **unlink**, 413. Success → `fs.rename()` into place, so a partial
  file is never observable at its final URL.
- [ ] **5.4** `src/api/handlers/media.ts#handleReplaceUpload` (`:348`) — same treatment. It already
  requires the original's MIME, so category, limit and strategy follow by construction.
  Keep `tests/media-replace.test.js` green.
- [ ] **5.5** Keep `MAX_UPLOAD_BYTES`'s `process.env` read (`:75-82`) — it is the **runtime ops ceiling**
  and the only knob that works without a rebuild. Not deprecated. Only its role is renamed.

**Verify:** `npm test`. On 413, `fs.readdir(uploadsDir)` is **empty** — assert it, do not assume it.

---

## Slice 6 — Serving: Range and streaming

- [ ] **6.1** `tests/uploads-get-range.test.js` (new) — **S13** no `Range` → 200 + `Accept-Ranges: bytes`;
  **S12** `Range: bytes=0-1` → **206**, `Content-Range: bytes 0-1/<size>`, exactly 2 bytes of body (this
  is **Safari's probe** — without it Safari discards the source and plays nothing); suffix range
  (`bytes=-100`) and open-ended (`bytes=100-`); **416** + `Content-Range: bytes */<size>` for
  `start > size`; multi-range → full 200.
- [ ] **6.2** `src/routes/uploads-get.ts` — `parseRange(header, size)` as an isolated pure function with
  its own tests. Anything it does not understand degrades to a **full 200**, never to a wrong 206.
- [ ] **6.3** `src/routes/uploads-get.ts` — `fs.readFile` (`:40`) → `fs.stat` + `fs.createReadStream(path,
  { start, end })` → `Readable.toWeb()` as the `Response` body. **S22:** memory per request is bounded by
  the chunk size for *every* category, on a route that has no authentication. `resolveUploadPath()` stays
  the sole containment check; `ENOENT` still → 404.

**Verify:** `npm test`. `tests/uploads-get.test.js` (S14: SVG still `attachment`; S11: AVIF) stays green.

---

## Slice 7 — Admin: one tile shape per category

`docs/DESIGN.md` §1.1 *"diseño por sustracción"* and §1.13 *"no crear estilos ad hoc… si pueden
resolverse dentro del sistema compartido"*. The pattern already exists — this adds two icons, not a
component.

- [ ] **7.1** `src/routes/admin/media.astro:145-157` — the `isDocument` ternary → a switch on
  `entry.fileCategory`. `image` → `<img>`; `document` / `video` / `audio` → the existing
  `.cms-media-card-thumb--*` surface with a per-category SVG. Legacy entries resolve through the catalog.
- [ ] **7.2** `src/routes/admin/client/media.ts:68-73` and
  `src/routes/admin/client/block-form.ts:464` — same switch. These are the client-side renderers of the
  same grid; all three must agree or a video is a PDF in one of them.
- [ ] **7.3** `src/styles/cms-admin.css` — `.cms-media-card-thumb--video` / `--audio` beside `--doc`.
  Same surface, same border, same neutral treatment; only the icon changes. **No accent colour** (§1.1
  caps it at 10%, and a media tile is not where it is spent), no elevation, no new tokens.
- [ ] **7.4** `tests/media-file-category.test.js` — extend for the four categories.
  **No `<video>` element in the grid** (`design.md` §6) — assert its absence, so a later "improvement"
  has to argue with a test.

**Verify:** `npm test`. `npm run screenshots:media` if the grid changed visually.

---

## Slice 8 — Playground

`docs/DECISIONS.md` requires a working demo under `playgrounds/` for every new feature.

- [ ] **8.1** `playgrounds/basic/astro.config.*` — `allowedFileTypes` extended with `video/mp4`.
- [ ] **8.2** A block schema with a `type: 'file'`, `accept: ['video/mp4']` prop, and a component that
  renders it in a `<video controls>`. **This is verbatim the configuration from the incident report** —
  it is the regression baseline. If that config ever 415s again, this is where it surfaces.
- [ ] **8.3** No incidental changes to playground data (`docs/DESIGN.md` §1.13, last bullet).

**Verify:** `npm run dev:playground` → upload an MP4 through `/cms/media`, place the block, load the
page, **press play, and seek**. Seeking is the assertion that Range actually works.

---

## Slice 9 — Docs

- [ ] **9.1** `docs/media.md:236-259` — rewrite *"Allowed file types"*. The word **"override"** is what
  authorised this bug: `allowedFileTypes` **selects from a catalog**, it does not invent types. Document
  the catalog table, `customFileTypes` (and **why** it is always `attachment`), and the build-time throw.
- [ ] **9.2** `docs/media.md:384` — `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` is re-described as the **runtime ops
  ceiling**, with `maxUploadBytes` as build-time per-category policy and `min()` as the rule.
- [ ] **9.3** `docs/media.md:389-398` *"Limitations and future work"* — video/audio are **passthrough**:
  no dimensions, no duration, no poster. Beside EXIF and focal point, where this class of limit already
  lives.
- [ ] **9.4** `README.md:351,480` — the `allowedFileTypes` row and the File Uploads paragraph.
- [ ] **9.5** `docs/CONTEXT.md` — **file-type catalog**, **file category** and **ops ceiling** enter the
  glossary. This is the vocabulary whose absence caused the bug; it belongs in the ubiquitous language.
- [ ] **9.6** `src/meta/features.json` — the closing checklist requires it. `npm run features:validate`.

**Verify:** `npm run features:validate`. No build note, no `npm pack`, no playground detail leaks into
`README.md` (`AGENTS.md` → *Documentación*).

---

## Slice 10 — E2E

- [ ] **10.1** `e2e/media-video.spec.ts` (new) — log in, upload an MP4 through the media library, assert
  the **video** tile renders (not the document icon), and assert `GET` on the upload URL with
  `Range: bytes=0-1` answers **206**.

**Verify:** `npm run e2e`.

---

## Closing checklist (`AGENTS.md` → *Versionado*)

Only when the human asks to close:

- [ ] `src/meta/features.json` updated · `npm run features:validate`
- [ ] `npm run typecheck` · `npm test` · `npm run e2e` · `npm run lint`
- [ ] `npm run screenshots:media` if the media grid changed
- [ ] No incidental changes in `playgrounds/` or sample data
- [ ] `package.json` **minor** bump + `CHANGELOG.md` entry + README version badge
- [ ] **Archive:** apply `spec-delta.md` → `docs/specs/media-uploads.md` (new living spec);
      set **ADR-0023** and **ADR-0024** to `Accepted`; set **ADR-0018**'s status to
      *Superseded by ADR-0023* (status line only — the body is immutable);
      move `docs/changes/file-type-catalog/` → `docs/changes/archive/<date>-file-type-catalog/`.
