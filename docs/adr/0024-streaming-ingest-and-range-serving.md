<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0024 — Category-branched ingest and Range-capable, streamed serving

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Nauel Gómez
- **Source:** the `video/mp4` 415 incident (see ADR-0023) — admitting video to the catalog exposes the
  upload and serving paths as image-shaped.

## Contexto

ADR-0023 makes `video/mp4` a supported type. That alone would produce a video that uploads and does not
work, because both the ingest path and the serving path assume a file is small.

**Ingest.** `handleUpload` reads the whole request body into memory with `await request.arrayBuffer()`
and only *then* checks the size limit. The 413 has never protected memory; it rejects what the server
has already swallowed. This is harmless today only because the default ceiling is 5 MB. The route is
authenticated (`auth: 'user'` in `src/api/route-table.ts`), so it is not a pre-auth denial of service —
but the moment video is allowed, consumers will raise `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` to 200 MB, and
that knob silently becomes *"how much RAM I hand to each concurrent upload"*.

**Serving.** `src/routes/uploads-get.ts` does `fs.readFile()` on every GET and returns a `200` with the
complete body. There is no `Accept-Ranges` and no `206`. Two consequences:

- **Safari will not play the video at all.** It requests the first two bytes of a media source and, if
  it does not get a `206` with a `Content-Range`, it discards the source. This is not a degraded seek
  bar — nothing plays. Chrome and Firefox tolerate a `200` but cannot seek.
- **The route is public and unauthenticated.** Ten visitors watching a 100 MB video is 1 GB of resident
  memory, on a path anyone on the internet can hit.

Both problems already exist. Images and PDFs are simply too small for anyone to notice. Video does not
create them; it makes them fatal.

There is one existing property that makes the fix cheap, and it is worth naming: **the MIME comes from
the `Content-Type` header, not from sniffing the bytes.** Authorisation therefore needs no body at all.
The upload path has always been able to decide before reading; it just never did.

## Decisión

**Ingest branches on the catalog's `category`. Serving streams and speaks Range. Neither ever holds a
whole file in memory unless something downstream genuinely needs it.**

### Ingest

- Authorise before reading a byte: MIME from the header → catalog lookup → `evaluateUpload()` (ADR-0018's
  locked order, untouched) → size check against `Content-Length`. A `Content-Length` over the limit is a
  **413 before the body is touched**.
- `Content-Length` is client-supplied and therefore advisory. The bytes actually written are counted;
  overrunning mid-stream aborts the write, **unlinks the partial file**, and returns 413.
- **`category === 'image'` buffers**, exactly as today — `sharp` and `imageSize` need the bytes resident,
  and images stay bounded at 5 MB by default. The common path does not change.
- **Every other category streams to disk** and is never held whole in memory. Bytes land under a
  temporary name and are `rename()`d into place only on success, so a partial file is never observable at
  its final URL.
- **Size limits are per category**, derived from the catalog: `maxUploadBytes?: Partial<Record<FileCategory,
  number>>` as a plugin option, defaulting to image 5 MB *(today's value)*, document 10 MB, audio 20 MB,
  video 200 MB.
- **`ASTRO_BLOCKS_MAX_UPLOAD_BYTES` is kept and is not deprecated.** It is the **runtime global limit**, and
  it **replaces** the per-category defaults rather than clamping them. The effective limit is
  `maxUploadBytes[category] ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES ?? DEFAULT[category]` — most specific wins.

  A hard ceiling (`min(policy, env)`) was the first design and it is **wrong**. `docs/media.md` documents the
  variable as "Maximum accepted upload size", and consumers **raise** it to allow bigger images as readily as
  they lower it — the existing `P3` tests exercise exactly that. Under `min()`, a deployment running with
  `ASTRO_BLOCKS_MAX_UPLOAD_BYTES=50MB` would have silently dropped to the 5 MB image default and found out
  when an editor failed to upload a photo in production. The variable is not redundant with `maxUploadBytes`:
  the plugin option is baked in at build time by `vite.define`, while the env var is read from `process.env`
  per request, so **it is the only knob that works without a rebuild**.

### Serving

- **`Accept-Ranges: bytes` on every response.** A valid `Range` yields **206** with
  `Content-Range: bytes <start>-<end>/<size>`; an unsatisfiable one yields **416** with
  `Content-Range: bytes */<size>`. Single-range forms only — a multi-range request is answered with a full
  `200`, which RFC 9110 permits and which no browser media element sends.
- **Responses stream from disk.** `fs.readFile()` is replaced by a ranged read stream. Resident memory per
  request drops from the whole file to a chunk **for every category**, not just video — so images and PDFs
  get the fix for free.
- **`Content-Type` and disposition come from the catalog row** (ADR-0023), which is what fixes the AVIF
  variants that the route has been serving as `application/octet-stream`. An extension with no row is
  `application/octet-stream` + `attachment`: unknown never means inline.

### What we deliberately do not do

- **No ffmpeg, no ffprobe.** Video and audio are passthrough: no dimensions, no duration, no poster, no
  transcoding. A native binary is a new system requirement for every consumer's CI, container and laptop —
  that is its own decision, and probably its own major. `sharp` already costs us one; we are not adding a
  second on the way past.
- **No `<video>` element in the media grid.** A `preload="metadata"` tile would paint a real first frame
  without ffmpeg, and it is genuinely tempting now that Range works — but it fires range requests from every
  tile on a 24-item page and puts a media element inside a listing that is static today. It is a UX
  iteration, with its own GATE.

## Consecuencias

- **Easier:** uploading and serving a large file no longer costs its size in RAM. The public serving route
  stops being a memory amplifier, which was true before this change and simply not yet expensive.
- **Easier:** video plays in Safari, and seeks everywhere. Without Range, "AstroBlocks supports video" would
  have been a false claim.
- **Harder / to watch:** the upload handler now has two ingest paths, and only one of them is exercised by
  the common case. The streaming path owns a partial file on disk between the first byte and the rename;
  every early return in it — 413, aborted connection, write error — **must** unlink. A leaked partial upload
  is the failure mode to test for, and the tests assert it explicitly.
- **Harder / to watch:** Range parsing is a small, sharp piece of HTTP that is easy to get subtly wrong
  (off-by-one on the inclusive end, suffix ranges, `start > size`). It is confined to one function with its
  own unit tests, and anything it does not understand degrades to a full `200` rather than to a wrong `206`.
- **New in the config surface:** `maxUploadBytes`. Sane per-category defaults mean nobody who ignores it is
  worse off, but a consumer who was relying on the single 5 MB default applying to *everything* now gets
  200 MB for video unless they set the ops ceiling. That is the knob doing what it says, and it is
  documented in `docs/media.md`.

See ADR-0023 for the catalog these decisions read from, and ADR-0017 for the raster-only variant pipeline
that video and audio skip.
