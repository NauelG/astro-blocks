<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Media uploads: the file-type catalog, ingest and serving

> Living specification. Describes which file types AstroBlocks accepts, how they are stored, and how
> they are served back. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`).
> History: inaugurated by change `file-type-catalog` (#111); admin-surface vocabulary (R31–R34)
> added by change `media-surface-vocabulary` (#114); listing ownership and the two accept lists
> (R35–R37) added by change `media-list-single-implementation` (#104); reconciliation (R38–R40)
> added by change `orphan-variant-scan-safety` (#164).

## Capability

Every file that enters the CMS passes through one gate (`POST /cms/api/upload`) and leaves through
one route (`GET /uploads/*`). This spec governs **what may enter**, **how it is stored**, and **how
it is handed back to a browser** — three questions that used to be answered by five independent
hardcoded constants, and are now answered by one table.

---

## The catalog

- **R1 — A supported file type is a tuple.** Every type the system can handle is one row in
  `src/utils/file-catalog.ts`: `{ mime, ext, contentType, category, disposition, raster }`.
  `category ∈ { image, video, audio, document }`.

- **R2 — The catalog is the single source of truth.** The stored extension, the served
  `Content-Type`, the inline/attachment policy, the `sharp` routing decision and the media-library
  tile are all **read from the row**. No component may hold its own MIME, extension or category map.

- **R3 — Builtin rows.** Ten rows ship:

  | mime | ext | category | disposition | raster |
  |---|---|---|---|---|
  | `image/jpeg` | `.jpg` | image | inline | ✅ |
  | `image/png` | `.png` | image | inline | ✅ |
  | `image/webp` | `.webp` | image | inline | ✅ |
  | `image/gif` | `.gif` | image | inline | — |
  | `image/avif` | `.avif` | image | inline | — |
  | `image/svg+xml` | `.svg` | image | **attachment** | — |
  | `application/pdf` | `.pdf` | document | inline | — |
  | `video/mp4` | `.mp4` | video | inline | — |
  | `video/webm` | `.webm` | video | inline | — |
  | `audio/mpeg` | `.mp3` | audio | inline | — |

- **R4 — `mime` is a primary key.**

- **R5 — `ext` is a primary key too, and this is load-bearing.** Uploads resolve a row by `mime`,
  but the **serving route can only resolve one by the file's on-disk extension** — it has no memory
  of the MIME the bytes arrived with. Two rows sharing an `ext` make the serving lookup ambiguous,
  and the first row wins it. This invariant holds across the **effective** catalog (builtins +
  registrations), not just the builtins.

- **R6 — The catalog is not the allowlist.** `DEFAULT_ALLOWED_FILE_TYPES` is what is **enabled out
  of the box** (5 image types + `application/pdf`); the catalog is what the system **can handle**.
  Video and audio are in the catalog and **not** in the default allowlist. The invariant
  `DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog` holds.

---

## Configuration

- **R7 — `allowedFileTypes` selects from the catalog.** It cannot widen it. The list is deduplicated
  and lowercased. An explicitly empty array is accepted (every upload is rejected; a warning is
  emitted).

  **The server and the admin decode the allowlist through one shared validator** (`decodeAllowlist`,
  consumed via `readBakedConfig` — ADR-0033). The two admin readers (`media.astro`, the block-form
  picker) previously required `length > 0` and fell back to the full default catalog, and cast the
  parsed value `as string[]`; they now share the server's decoder, so they cannot drift and a
  non-string element (`[123]`) is rejected instead of reaching the `accept` attribute uncoerced. The
  upload `accept` attribute — **`uploadAccept`** (R37) — is a **picker hint, never the gate**; the
  server enforces the allowlist (`getAllowedFileTypes`). This statement is about uploading only: the
  opposite rule governs the listing filter (R36). One consequence for the empty allowlist: the
  resolved list is `[]`, so
  `accept` renders empty, which HTML treats as *accept-anything* at the file dialog; the picker cannot
  express "offer nothing" for this config. That is cosmetic — every selected file is still rejected by
  the server.

- **R8 — An unsupported MIME fails the build.** At `astro:config:setup`, a MIME in `allowedFileTypes`
  that appears in neither the builtin catalog nor `customFileTypes` **throws**, naming the MIME,
  listing the supported types, and pointing at `customFileTypes`.

- **R9 — `customFileTypes` registers; it never bypasses.** A registration supplies `{ mime, ext,
  category }` and **nothing else**. Every registered row is forced to
  `contentType: 'application/octet-stream'` and `disposition: 'attachment'`, so a format AstroBlocks
  has never audited **cannot render in the CMS's own origin**.

- **R10 — The denylist beats the escape hatch.** A registration whose `mime` matches
  `DANGEROUS_MIME` / `DANGEROUS_MIME_PATTERN`, or whose `ext` matches `DANGEROUS_EXTENSIONS`, is
  rejected at config time. No configuration path can register a denied type.

- **R11 — A registration cannot shadow a builtin,** by `mime` **or** by `ext` (R5). Nor may two
  registrations share either.

- **R12 — The uncatalogued-MIME 415 is unreachable.** R8 guarantees `allowedFileTypes ⊆ catalog`, and
  the runtime allowlist is additionally intersected with the catalog. Once an upload passes the
  security gate, its row exists. Should it not, the handler raises a **500** — a broken server
  invariant is not the client's unsupported file.

- **R13 — Per-category size limits, most specific wins.**

  ```
  limit(category) = maxUploadBytes[category]          // plugin option, build-time
                 ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES     // environment variable, runtime
                 ?? DEFAULT_MAX_BYTES[category]       // image 5 MB, document 10, audio 20, video 200
  ```

  `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` **replaces** the defaults; it does not clamp them. It is read from
  the environment per request, so it is the only upload knob that takes effect **without a rebuild**.

- **R14 — Config bridges are double-encoded.** `vite.define` splices its value into the bundle as raw
  **source**, and every runtime reader guards with `typeof raw === 'string'` before `JSON.parse`. A
  single-encoded JSON bridge therefore does not fail loudly — it **silently falls back to the
  default**. Tests must assert the *round trip*, never the define value alone.

---

## Ingest (`POST /cms/api/upload`, `POST /cms/api/media/:id/replace`)

- **R15 — Nothing is read before the file is authorised.** The MIME comes from the `Content-Type`
  header, so the denylist, the allowlist and the size check all run **before any request body byte is
  read**. An oversized `Content-Length` is a **413 with the body untouched**.

- **R16 — The security gate order is locked** (ADR-0018): denylist on MIME → denylist on the derived
  extension → allowlist membership.

- **R17 — The stored extension comes from the validated MIME, never the filename.** An SVG named
  `foo.jpg` and served inline is stored XSS. The base filename is sanitised
  (`[^a-zA-Z0-9_-]` → `_`, capped at 64 chars).

- **R18 — Ingest branches on `row.category`.** `image` is buffered (`sharp` and `imageSize` need the
  bytes resident). `video`, `audio` and `document` are **streamed to disk** and never held whole in
  memory.

- **R19 — The byte counter is the authority, not `Content-Length`.** The header is client-supplied.
  Overrunning the limit mid-stream aborts the write, **removes the partial file**, and returns 413.

- **R20 — A partial upload is never observable.** Bytes land under a temporary name and are renamed
  into place only on success. **Every** early exit from the streaming path — overrun, aborted
  connection, write error, failed rename — unlinks.

- **R21 — Video and audio are passthrough.** No dimensions, no duration, no poster, no transcoding,
  no native dependency. `MediaEntry.width` / `height` stay `undefined`.

- **R22 — Only `raster: true` rows go through `sharp`** (ADR-0017). Everything else reaches
  `status: 'ready'` with an empty `variants` array.

  Variant files are written **outside the media lock** and registered afterwards, so between the
  first encode and `markMediaVariantsReady` the filesystem holds real files the registry does not
  list. R38 is what stops that window becoming data loss.

- **R23 — `fileCategory` is declared, not parsed.** It is read from the catalog row at upload time,
  never derived from `mimeType.startsWith('image/')`. Entries written before the field existed
  resolve through the catalog on load, defaulting to `'document'`.

---

## Serving (`GET /uploads/*`)

- **R24 — `Content-Type` and disposition come from the catalog row,** resolved by extension. An
  extension with no row is `application/octet-stream` + `attachment`: **unknown never means inline**.
  `?download` forces `attachment` for any row.

- **R25 — `Accept-Ranges: bytes` on every response.**

- **R26 — Range requests are honoured.** A satisfiable `Range` yields **206** with
  `Content-Range: bytes <start>-<end>/<size>`; an unsatisfiable one yields **416** with
  `Content-Range: bytes */<size>`. Single-range forms only; a multi-range request is answered with a
  full **200** (RFC 9110 permits ignoring a Range header, and no browser media element sends one).

  This is not optional for video: **Safari requests the first two bytes of a media source and, absent
  a 206, discards the source and plays nothing.**

- **R27 — Anything unparseable degrades to a full 200, never to a wrong 206.** A 206 that lies about
  which bytes it carries is worse than a 200 that carries all of them — the client splices it into the
  wrong offset and the media is silently corrupt.

- **R28 — Responses are streamed from disk.** Resident memory per request is bounded by the chunk
  size, for **every** category. This route is public and unauthenticated.

- **R29 — Path containment is unchanged.** `resolveUploadPath()` remains the sole check: the resolved
  path must equal the uploads directory or start with `uploadsDir + path.sep`. A missing file is 404.

---

## Admin

- **R30 — One tile rule for every grid.** The client-side media grid and the block picker both
  resolve the tile from `fileCategory` through `src/utils/media-tile.ts`. `image` renders an `<img>`;
  `document`, `video` and `audio` render a category icon on a shared surface. No `<video>` element in
  the grid: no bytes are fetched to paint it. (There was a third, server-rendered grid until R35 made
  that page a shell — the rule is unchanged, with one fewer place to apply it.)

- **R31 — The picker titles itself by prop type.** The block-form media picker is opened for a prop
  whose type is `image` or `file`. In `image` mode it presents as an image chooser; in `file` mode as
  a media chooser. Its title, dialog aria-label and close-button aria-label are set on every open from
  the mode (`pickerTitleKeyForMode` in `client/block-form/picker-title.ts`), never baked to a single
  type.

- **R32 — Container surfaces name any asset, not "image".** Surfaces that hold or count the library as
  a whole — the library grid and its aria label, the counters, the empty state, the search, the
  dropzone, the picker grid — speak of media, assets or files. A library of three videos reports "3
  assets", never "3 images".

- **R33 — Image-acting surfaces keep "image".** Alt text (WCAG 1.1.1), image dimensions, responsive
  variants, `<BlockImage>`, and the picker opened in `image` mode continue to say "image". Widening
  these to "media" would be wrong, not more inclusive.

- **R34 — Every admin media string is localized.** No admin media control renders a hardcoded
  user-facing string; every one resolves through the i18n catalog (`ct()`/`t()`), on both the initial
  render and the in-place update path.

> User-facing vocabulary (mass "media", countable "asset", disk/contract "file", image-acting
> "image") is defined in `CONTEXT.md §3` and justified in
> `docs/adr/0026-media-user-facing-vocabulary.md`.

---

## Listing

- **R35 — One implementation of the media listing.** `handleGetMedia` is the only implementation of
  *which media entries are listed, in what order*. No consumer sorts, filters or slices the library
  on its own; a consumer that needs a different set says so with a query parameter — `q`, `page`,
  `limit`, `accept` — and renders the envelope as received.

  The admin media page therefore **renders no media cards server-side**: its grid container ships a
  localized `role="status"` loading line, and `client/media.ts` fetches page 1 and renders it. This
  is not a performance trade. `initMediaPage()` has always replaced the server-rendered grid
  unconditionally, and the toolbar stayed hidden until it did, so the SSR grid was built, shipped
  and discarded on every visit while being unusable in the interim.

  One consequence is load-bearing: **`client/media.ts:renderCard` is the only card renderer**. There
  is no second implementation for first paint and re-render to disagree about. (ADR-0036)

- **R36 — `accept` filters the listing, and does not consult the allowlist.** `GET /cms/api/media`
  accepts `?accept=<comma-separated MIME list>`. Values are trimmed, lowercased and blanks dropped;
  an entry matches on **exact equality** with its `mimeType`, never a prefix or a wildcard. The
  filter runs **beside `q` and before `total`**, so `total`, `page` and `limit` all describe the same
  filtered set and the pager cannot lie. Absent, empty or all-blank = no filter. A MIME the catalog
  does not know matches nothing: an empty page, **200**, not an error.

  **The filter is not intersected with `allowedFileTypes`.** The allowlist is the *upload* gate (R7,
  R16); this is a *read* over files already on disk. Narrowing `allowedFileTypes` must never hide an
  asset that published pages still reference, nor strand an owner who cannot re-select it. (ADR-0036)

- **R37 — `uploadAccept` and `browseAccept` are different questions.** A media-bearing prop has two
  accept lists, and they are not the same list.

  - **`uploadAccept` = `def.accept ∩ allowedFileTypes`** — what the field may **upload**; drives the
    file input's `accept` attribute. Intersecting is right here: offering to upload what the server
    will reject is a lie. This is the list R7 calls a picker hint.
  - **`browseAccept` = `def.accept` as declared**, or — when the prop declares none — every catalog
    row of the picker mode's category, or empty for an unrestricted `file` prop. It is what the field
    may **pick from what already exists**, and it is what travels in `?accept`. Not
    allowlist-intersected, per R36.

  Collapsing the two produced two defects, fixed by the split rather than patched: an `image`-mode
  picker offered documents and video as selectable, and a prop whose declared `accept` had been
  dropped from the allowlist produced an **empty** intersection that disabled filtering entirely —
  so a stricter allowlist yielded a *more permissive* picker.

---

## Reconciliation

- **R38 — Absence from the registry is not proof of orphanhood.** A variant file that is not recorded
  may be an orphan — or a file being written *right now* by a generation job that has not registered
  yet (R22). Those are indistinguishable from the registry alone, and the window is on the ordinary
  path: the admin client re-fetches the media list immediately after an upload, and that read runs
  the scan.

  A file is therefore a deletion candidate only when its `mtime` is older than `ORPHAN_MIN_AGE_MS`
  (5 minutes). The clock is sampled once per scan, so a slow walk cannot judge later files against a
  moved line. The gate covers **only** the orphan scan: variant files belonging to a pruned entry are
  still deleted regardless of age — provable orphans by a different proof, since the entry that owned
  them is gone. (ADR-0038)

- **R39 — Reconcile inspects unlocked and commits a filter, not a snapshot.** The `fs.access` sweep
  and the directory walk are read-only and run without the media lock. The lock covers only: re-read,
  drop the pruned entries, drop the phantom variant records, save.

  The **re-read is required**, not an optimisation. Writing back a set computed before the lock was
  acquired would discard any entry appended in between — the loss the media lock exists to prevent.
  A listing read therefore no longer holds the write lock while walking the uploads tree, so it can
  no longer delay an upload, a delete, or the variant persistence that follows an upload.

- **R40 — A registry entry may not claim a variant file that does not exist.** Reconcile drops
  variant records whose file is absent, for entries whose `status` is `ready`. Entries with status
  `processing` are left untouched: their recorded variants may legitimately not exist yet, and
  repairing one would delete records the running job is about to fulfil.

  This is repair, not prevention: instances that uploaded images while R38 was unenforced already
  hold entries pointing at deleted files. The repair happens on the next listing read, with no
  migration and no owner action. Reconcile does **not** regenerate the lost variants — the original
  is intact, so the image still renders with fewer responsive alternatives, and triggering
  regeneration from a read path is the class of surprise R38 exists to remove.

---

## Scenarios

- **S1.** `allowedFileTypes: ['video/mp4']`, upload an MP4 → **200**, stored `.mp4`,
  `fileCategory: 'video'`, no variants. *(The reported incident.)*
- **S2.** Default config, upload an MP4 → **415**. Video is opt-in.
- **S3.** `allowedFileTypes: ['application/zip']` with no registration → **the build throws**, naming
  `application/zip`.
- **S4.** `customFileTypes: [{ mime: 'text/html', ext: '.html', … }]` → **throws**. The denylist beats
  the escape hatch.
- **S5.** `customFileTypes: [{ mime: 'application/x-my-doc', ext: '.pdf', … }]` → **throws**. Sharing a
  builtin's extension would store the file as an attachment and serve it as an inline PDF.
- **S6.** A registered `.zip` → uploads 200, served `application/octet-stream` + `attachment`,
  whatever the consumer configured.
- **S7.** `Content-Length` of 300 MB against a 200 MB video limit → **413**, and the body is never read.
- **S8.** A body that lies about its `Content-Length` and overruns → **413**, and **no file remains on
  disk**.
- **S9.** `ASTRO_BLOCKS_MAX_UPLOAD_BYTES=8388608`, no `maxUploadBytes` → a **6 MB image uploads**,
  above the 5 MB default. The variable raises as readily as it lowers.
- **S10.** `GET` an `.mp4` with `Range: bytes=0-1` → **206**, `Content-Range: bytes 0-1/<size>`, two
  bytes. *(Safari's probe.)*
- **S11.** `GET` an `.avif` variant → **`Content-Type: image/avif`**.
- **S12.** `GET` an `.svg` → `Content-Disposition: attachment`.
- **S13.** A prop declares `accept: ['application/pdf']`; the library holds 30 images and 5 PDFs. Open
  the picker → **5 assets, `total: 5`**, one page, no "load more". *(Previously: page 1 was 24 images,
  of which 0 survived the client filter, over a `total` of 35.)*
- **S14.** An `image` prop's picker, in a library holding a PDF and an MP4 → **neither is offered**.
  *(Previously: both were offered, and picking one wrote its URL into the image field.)*
- **S15.** `allowedFileTypes` no longer contains `application/pdf`; a prop still declares
  `accept: ['application/pdf']`. Open the picker → **the already-uploaded PDFs, and only those**.
  *(Previously: the intersection was `[]`, the guard disabled filtering, and the picker showed
  everything.)*
- **S16.** `GET /cms/api/media?accept=application/x-nope` → **200**, `total: 0`, `uploads: []`.
- **S17.** `GET /cms/api/media?q=hero&accept=image/png&limit=10` → `total` counts entries matching
  **both**, and the returned page is a slice of that set.
- **S19.** Upload an image; the admin client immediately re-fetches the media list, running reconcile
  while variant generation is still writing. Every variant the registry ends up recording **exists on
  disk**. *(Previously: the scan deleted the variants written so far, and the entry was then marked
  `ready` recording all of them — five of eight missing in the reproduction.)*
- **S20.** A variant file with no registry entry and an `mtime` older than five minutes → deleted by
  the next scan, as before.
- **S21.** A `ready` entry records a variant whose file is gone → the next listing read drops that
  record; the entry keeps its remaining variants and its original.
- **S18.** Load `/cms/media` and read the raw HTML → **no `.cms-media-card`**, one `role="status"`
  loading line. The rendered page shows the newest 24 assets once the client fetch lands.

---

## Related

`docs/adr/0023-supported-file-type-catalog.md` (supersedes ADR-0018) ·
`docs/adr/0024-streaming-ingest-and-range-serving.md` · `docs/adr/0017` (variants) ·
`docs/adr/0016` (image field value) ·
`docs/adr/0026-media-user-facing-vocabulary.md` (media/asset/file/image vocabulary) ·
`docs/adr/0038-el-escaneo-solo-borra-lo-que-puede-demostrar-que-es-huerfano.md` (what reconcile
may delete, and why age is the proof) ·
`docs/adr/0036-el-handler-es-la-unica-implementacion-del-listado-de-media.md` (listing ownership,
`?accept`, uploadAccept vs browseAccept) · `docs/adr/0020` (server-side search + pagination) ·
`docs/media.md` (consumer guide)
