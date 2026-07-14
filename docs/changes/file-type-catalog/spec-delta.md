<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — A supported-file-type catalog, and video/audio on top of it

`docs/specs/` holds no media specification today, so this delta **inaugurates**
`docs/specs/media-uploads.md`. Everything below describes the behaviour after the change; where it
differs from today's behaviour, the difference is called out.

---

## ADDED: The supported-file-type catalog

### Requirements

- **R1 — A supported file type is a tuple.** Every type the system can handle is one row:
  `{ mime, ext, contentType, category, disposition, raster }`. `mime` is the primary key.
  `category ∈ { image, video, audio, document }`.

- **R2 — The catalog is the single source of truth.** The stored extension, the served
  `Content-Type`, the inline/attachment policy, the `sharp` routing decision and the media-library
  tile are all **read from the row**. No component may hold its own MIME, extension or category map.

- **R3 — Builtin rows.** The catalog ships ten rows: `image/jpeg` `.jpg`, `image/png` `.png`,
  `image/webp` `.webp`, `image/gif` `.gif`, `image/avif` `.avif`, `image/svg+xml` `.svg`,
  `application/pdf` `.pdf`, `video/mp4` `.mp4`, `video/webm` `.webm`, `audio/mpeg` `.mp3`.
  `image/svg+xml` is `disposition: 'attachment'` (XSS guard). Only `image/jpeg`, `image/png` and
  `image/webp` are `raster: true`.

- **R4 — The catalog is not the allowlist.** `DEFAULT_ALLOWED_FILE_TYPES` remains the six types that
  are **enabled out of the box** (5 images + PDF). Video and audio are **in the catalog and not in the
  default allowlist**: a consumer opts into them via `allowedFileTypes`. The invariant
  `DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog` holds.

- **R5 — The escape hatch registers, it does not bypass.** `customFileTypes: Array<{ mime, ext,
  category }>` appends rows to the effective catalog. Registered rows are **forced** to
  `contentType: 'application/octet-stream'` and `disposition: 'attachment'` — the consumer cannot
  choose either. A registered type is therefore never rendered in the CMS's own origin and cannot
  reintroduce stored XSS.

- **R6 — The denylist still wins.** A `customFileTypes` row whose `mime` matches `DANGEROUS_MIME` /
  `DANGEROUS_MIME_PATTERN`, or whose `ext` matches `DANGEROUS_EXTENSIONS`, is **rejected at config
  time**. No configuration path can register a denied type. (ADR-0018's core invariant, preserved and
  now structural.)

- **R6b — `ext` is a primary key, across the whole effective catalog.** A `customFileTypes` row whose
  `ext` collides with a builtin's — or with another registered row's — is **rejected at config time**.

  Uploads resolve a row by `mime`, but the SERVING route can only resolve one by the file's on-disk
  **extension**: it has no memory of the MIME the bytes arrived with. So two rows sharing an `ext` make
  the serving lookup ambiguous, and the builtin wins it. Registering `{ mime: 'application/x-my-doc',
  ext: '.pdf' }` would store the file under the custom row (attachment, octet-stream) and **serve it
  under the builtin PDF row — inline**, defeating R5 entirely. Without this rule, R5's "structurally
  incapable" is false.

- **R7 — Config validation throws.** At `astro:config:setup`, a MIME in `allowedFileTypes` that
  appears in neither the builtin catalog nor `customFileTypes` **throws**, naming the MIME, listing the
  supported types, and pointing at `customFileTypes`. A build fails rather than a runtime upload
  returning a misleading 415.

- **R8 — The uncatalogued-MIME 415 is unreachable.** R7 guarantees
  `allowedFileTypes ⊆ effective catalog`. Consequently, once an upload passes the security gate, its
  catalog row is guaranteed to exist. Should it not, the handler raises a **500** (a server-invariant
  violation), never a 415 — a 415 would misreport a server bug as a client error.

### Scenarios

- **S1.** `allowedFileTypes: ['video/mp4']`, upload an MP4 with `Content-Type: video/mp4` → **200**.
  Stored with extension `.mp4`. `MediaEntry.fileCategory === 'video'`. No variants generated. *(This is
  the reported incident. Today it returns 415.)*
- **S2.** `allowedFileTypes: ['application/zip']`, no `customFileTypes` → **the build throws**, naming
  `application/zip`. *(Today: the build succeeds and every upload silently 415s.)*
- **S3.** `customFileTypes: [{ mime: 'application/zip', ext: '.zip', category: 'document' }]` plus
  `allowedFileTypes: [..., 'application/zip']` → build passes, upload succeeds, and the file is served
  as `application/octet-stream` with `Content-Disposition: attachment`.
- **S4.** `customFileTypes: [{ mime: 'text/html', ext: '.html', category: 'document' }]` → **throws**.
  The denylist beats the escape hatch.
- **S5.** `customFileTypes: [{ mime: 'image/png', ... }]` → **throws**. A registered row cannot shadow a
  builtin.
- **S6.** Default config (no `allowedFileTypes`), upload an MP4 → **415**. Video is not on by default.

---

## ADDED: Category-branched ingest

### Requirements

- **R9 — Nothing is read before the file is authorised.** The MIME is taken from the `Content-Type`
  header. The catalog lookup, the security gate (`evaluateUpload`) and the size check all run **before
  any request body byte is read**.

- **R10 — The security gate is unchanged.** `evaluateUpload()` keeps its locked order — denylist on
  MIME, then denylist on the derived extension, then allowlist membership — and keeps receiving
  `derivedExtension: row?.ext ?? null`. (ADR-0018.)

- **R11 — Per-category size limits, most specific wins.** `maxUploadBytes?: Partial<Record<FileCategory,
  number>>` is a plugin option. Defaults: image 5 MB *(today's value, unchanged)*, document 10 MB,
  audio 20 MB, video 200 MB. The effective limit is:

  ```
  limit(category) = maxUploadBytes[category]          // build-time, per category
                 ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES     // runtime, global
                 ?? DEFAULT_MAX_BYTES[category]
  ```

- **R12 — `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` is the runtime global limit, and is not deprecated.** It is
  read from `process.env` per request, so it takes effect **without a rebuild** — the only upload knob
  that does (`maxUploadBytes` is baked in at build time via `vite.define`).

  It **replaces** the per-category defaults; it does **not** clamp them. This is the semantics it has
  always had: `docs/media.md` documents it as "Maximum accepted upload size", and consumers **raise** it
  to allow bigger images as readily as they lower it. A hard ceiling would silently cut anyone running
  above 5 MB back to the image default, and they would find out when an editor failed to upload a photo
  in production.

- **R13 — Early rejection, then authoritative counting.** A `Content-Length` above the effective limit
  returns **413 before the body is touched**. `Content-Length` is client-supplied and advisory: the
  bytes actually written are counted, and exceeding the limit mid-stream aborts the write, **removes the
  partial file**, and returns 413.

- **R14 — Ingest branches on `row.category`.** `image` is buffered in memory (`sharp` and `imageSize`
  require it). `video`, `audio` and `document` are **streamed to disk** and never held whole in memory.
  A partial upload is written under a temporary name and renamed into place only on success, so a
  partial file is never observable at its final URL.

- **R15 — The stored extension still comes from the MIME, never the filename.** (ADR-0018, unchanged —
  it is now a catalog column instead of a lookup in a standalone map.)

- **R16 — Video and audio are passthrough.** No dimensions, no duration, no poster, no transcoding, no
  new native dependency. `MediaEntry.width` / `height` stay `undefined`.

- **R17 — `handleReplaceUpload` obeys R9-R16.** It already requires the replacement to carry the
  original's MIME, so category, limit and ingest strategy are identical by construction.

### Scenarios

- **S7.** `Content-Length` of 300 MB with `category: 'video'` and a 200 MB limit → **413**, and the
  request body is never read.
- **S8.** A body that lies about its `Content-Length` and overruns mid-stream → **413**, and **no file
  remains on disk**.
- **S9.** `ASTRO_BLOCKS_MAX_UPLOAD_BYTES=5242880` with `maxUploadBytes: { video: 200MB }` → the video
  limit is **200 MB**: the explicit per-category setting is more specific than the global one. Categories
  the consumer did *not* name (image, document, audio) get **5 MB** from the environment variable.
- **S9b.** `ASTRO_BLOCKS_MAX_UPLOAD_BYTES=8388608` with no `maxUploadBytes` → a 6 MB **image uploads**,
  above the 5 MB default. Consumers raise this variable for bigger images; it must not act as a ceiling.
- **S10.** Upload a 150 MB MP4 with default limits → **200**, and the server's resident memory does not
  grow by 150 MB.

---

## ADDED: Range-capable, streamed serving

### Requirements

- **R18 — `Content-Type` comes from the catalog.** The serving route resolves the row by extension.
  An extension with no row is served `application/octet-stream` with
  `Content-Disposition: attachment` — unknown never means inline.

- **R19 — Disposition comes from the catalog.** `image/svg+xml` is `attachment` because its **row says
  so**, not because the route special-cases it. `?download` still forces `attachment` for any row.

- **R20 — `Accept-Ranges: bytes` on every response.**

- **R21 — Range requests are honoured.** A valid `Range` yields **206** with `Content-Range:
  bytes <start>-<end>/<size>`. An unsatisfiable range yields **416** with `Content-Range: bytes */<size>`.
  Single-range forms only; a multi-range request is answered with a full **200** body.

- **R22 — Responses are streamed.** The route streams from disk instead of reading the whole file into
  memory. Resident memory per request is bounded by the chunk size **for every category**, not just
  video. *(Today the route buffers the entire file, on a public unauthenticated path.)*

- **R23 — Containment is unchanged.** `resolveUploadPath()` remains the sole path-containment check.
  A missing file is still a 404.

### Scenarios

- **S11.** `GET` a `.avif` variant → **`Content-Type: image/avif`**. *(Today: `application/octet-stream`,
  because the serving route's private extension map has no `.avif` entry while the variant generator
  writes AVIF files. Pre-existing bug, fixed by R2.)*
- **S12.** `GET` an `.mp4` with `Range: bytes=0-1` → **206**, `Content-Range: bytes 0-1/<size>`,
  two bytes of body. *(This is Safari's probe. Without it, Safari discards the source and plays
  nothing.)*
- **S13.** `GET` an `.mp4` with no `Range` header → **200**, `Accept-Ranges: bytes`, streamed body.
- **S14.** `GET` an `.svg` → `Content-Disposition: attachment`. *(Unchanged behaviour, now sourced from
  the row.)*
- **S15.** `GET` a `.zip` registered via `customFileTypes` → `application/octet-stream` +
  `Content-Disposition: attachment`, regardless of what the consumer configured.
- **S15b.** `customFileTypes: [{ mime: 'application/x-my-doc', ext: '.pdf', … }]` → **the build throws**.
  Sharing a builtin's extension would have the file stored as an attachment and served as an inline PDF.

---

## MODIFIED: `MediaEntry.fileCategory`

- **R24 — `fileCategory` is declared, not parsed.** It widens to
  `'image' | 'video' | 'audio' | 'document'` and is taken from the catalog row at upload time. The
  `mimeType.startsWith('image/') ? 'image' : 'document'` derivation is removed.

- **R25 — Additive, no migration.** Every stored entry today carries `'image'` or `'document'`, both
  still valid. Entries predating the field resolve their category through the catalog, defaulting to
  `'document'`.

---

## MODIFIED: The media library tile

- **R26 — One tile shape per category.** The media grid and the block picker select the thumbnail from
  `fileCategory`: `image` renders `<img>`; `document`, `video` and `audio` render the existing
  `.cms-media-card-thumb--*` icon surface with a category-specific SVG. No `<video>` element, no
  poster, no bytes fetched to paint the grid. *(Today a video would render with the PDF icon.)*

---

## REMOVED: The five independent file-type maps

- `MIME_TO_EXT`, `IMAGE_MIME_TO_EXT`, `DOCUMENT_MIME_TO_EXT` and `RASTER_MIME`
  (`src/utils/file-types.ts`) — replaced by catalog columns.
- `MIME` and `IMAGE_CONTENT_TYPES` (`src/routes/uploads-get.ts`) — replaced by catalog lookups.

**Why:** these were five hardcoded opinions about file types with nothing forcing them to agree, and
two of them already disagreed (`.avif`, see S11). `MIME_TO_EXT`'s keys formed a **second, undeclared
allowlist** that a consumer could not widen while the declared one said they could — which is the
reported bug.

None of these is public API: `package.json#exports` exposes only `src/plugin/index.ts`, which
re-exports `DEFAULT_ALLOWED_FILE_TYPES` alone. The removal is internal, and the change is a **minor**.
