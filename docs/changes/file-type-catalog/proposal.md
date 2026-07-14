<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — A supported-file-type catalog, and video/audio on top of it

- **Trigger:** user incident against `@astroblocks/astro-blocks@3.4.0` — `type: 'file'` with
  `accept: ['video/mp4']` and `video/mp4` added to `allowedFileTypes` returns **415 Unsupported
  Media Type** on every upload. Reproduced at HEAD (3.5.4).
- **Follow-ups deliberately left out:** #102 (`accept` is not server-enforced), ffprobe/ffmpeg
  metadata, auto-generated video posters, `<video>` previews in the media grid.

## The report is right about the mechanism and wrong about the cause

The reporter's trace is accurate, line for line. In `src/api/handlers/media.ts`:

- **:110-117** — `evaluateUpload()` approves `video/mp4`, because the gate consults
  `getAllowedFileTypes()`, which honours the consumer's config.
- **:127-131** — one statement later, `MIME_TO_EXT[mimeType]` returns `undefined` and the handler
  returns **the same 415, with the same error key**, for a file the gate just approved.

The rest of the pipeline does tolerate non-images, exactly as reported: `imageSize` is skipped by the
`mimeType.startsWith('image/')` guard (`media.ts:151`) and `generateAndPersistVariants` bails on
`RASTER_MIME` (`variant-generator.ts:42`).

Their proposed fix — add `'video/mp4': '.mp4'` to `MIME_TO_EXT` — treats the symptom.

## Root cause — "supported file type" does not exist as a concept

The system holds five independent, hardcoded opinions about file types. Nothing derives them from one
another, and nothing forces them to agree:

| # | Constant | File | Governs |
|---|----------|------|---------|
| 1 | `DEFAULT_ALLOWED_FILE_TYPES` | `utils/file-types.ts:27` | what is accepted out of the box |
| 2 | `MIME_TO_EXT` | `utils/file-types.ts:70` | the extension the file is stored under |
| 3 | `RASTER_MIME` | `utils/file-types.ts:43` | whether it goes through `sharp` |
| 4 | `MIME` (ext→type) | `routes/uploads-get.ts:12` | the `Content-Type` it is served with |
| 5 | `IMAGE_CONTENT_TYPES` | `routes/uploads-get.ts:24` | inline vs. `Content-Disposition: attachment` |

**Two of them already disagree, and it has nothing to do with video.** `MIME_TO_EXT` maps
`image/avif → .avif`, and `variant-generator.ts:66` writes `['webp', 'avif']` variants — but
`uploads-get.ts:12` has no `.avif` entry, so **every AVIF variant AstroBlocks generates is served as
`application/octet-stream`**. Browsers sniff images and usually render it anyway, which is precisely
why nobody has noticed. The header is wrong regardless, and the response falls into the non-image
branch that honours `?download`.

`allowedFileTypes` is a *declared, configurable, documented* allowlist. The **keys of `MIME_TO_EXT`**
are a *second, implicit, hardcoded* allowlist that was never named as one. A consumer can widen the
first and cannot widen the second. MP4 is not a special case — it is simply the MIME this user
happened to try. `audio/mpeg`, `text/csv`, `application/zip`, `application/msword` all hit the
identical silent 415.

ADR-0018 wrote the bug down without seeing it. Its Consequences (line 40) require that any addition to
`allowedFileTypes` be cross-checked against `DANGEROUS_EXTENSIONS`/`DANGEROUS_MIME` — it remembered
the denylist and **forgot that `MIME_TO_EXT` is also a gate**.

## The documentation authorised what the code refuses

`docs/media.md:246` reads *"You can **override** the list via the `allowedFileTypes` plugin option"*.
The three rules that follow cover dedupe, the empty array, and the denylist. **None states that the
list may only select from a supported catalog.** The user read the docs, did what they permit, and got
a 415. This is a defect, not a feature request.

## Why the reporter's patch would make things worse

Apply `'video/mp4': '.mp4'` to `MIME_TO_EXT` and nothing else, and the result is:

1. The MP4 uploads. The 415 is gone. ✅
2. It is served as **`application/octet-stream`** — `uploads-get.ts:12` has no `.mp4` entry.
3. No `Accept-Ranges`, no `206`. **Safari requests the first two bytes, gets a `200`, and refuses to
   play the source at all.** Chrome and Firefox may start it, but cannot seek.
4. Every GET runs `fs.readFile()` over the whole file on a **public, unauthenticated route**
   (`uploads-get.ts:40`). Ten visitors watching a 100 MB video is 1 GB of resident memory. Today this
   is harmless only because the ceiling is 5 MB of images.

The patch trades an honest 415 for a video that does not play in Safari and a memory amplifier open to
the internet.

## What we do instead

Name the missing concept. A **supported file type** is a tuple —
`{ mime, ext, contentType, category, disposition, raster }` — and the five constants above become
**derived views** of one catalog. Then video and audio are rows in it, not exceptions to it.

Eleven decisions, settled during grilling:

| # | Decision |
|---|----------|
| 1 | **Closed catalog of tuples.** The five constants are derived from it, never hand-maintained. |
| 2 | **The escape hatch is a *registration*, not a bypass.** `customFileTypes` is validated against the denylist at config time and is **always served `attachment`**. |
| 3 | **One change** (catalog + video/audio), delivered as vertical slices with separate commits. |
| 4 | **Ingest branches on category.** Reject on `Content-Length` before reading the body. Images buffer (`sharp`/`imageSize` need them); video, audio and documents **stream to disk**. |
| 5 | **Serving: Range + stream for everything.** `Accept-Ranges`, `206`/`Content-Range`, `Content-Type` from the catalog. Fixes AVIF on the way past. |
| 6 | **`fileCategory: 'image' \| 'video' \| 'audio' \| 'document'`**, declared in the catalog, no longer parsed out of the MIME string. |
| 7 | **Video and audio are in the catalog, not in the default allowlist.** They are opted into via `allowedFileTypes` — which is what the reporter already did. |
| 8 | **Video and audio are passthrough.** No ffmpeg, no dimensions, no duration, no poster. |
| 9 | **`maxUploadBytes` per category** (plugin option, via `vite.define`). `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` is **kept, not deprecated**, as a runtime hard ceiling. |
| 10 | **A MIME outside the catalog throws at config time.** The `if (!extension)` branch that caused this incident becomes **unreachable by construction**. |
| 11 | **Icon tiles per category** (`--video`, `--audio`), reusing the existing `--doc` pattern. |

## The catalog

Seven existing rows, three new ones:

| MIME | ext | category | disposition | raster |
|------|-----|----------|-------------|--------|
| `image/jpeg` | `.jpg` | image | inline | ✅ |
| `image/png` | `.png` | image | inline | ✅ |
| `image/webp` | `.webp` | image | inline | ✅ |
| `image/gif` | `.gif` | image | inline | — |
| `image/avif` | `.avif` | image | inline | — |
| `image/svg+xml` | `.svg` | image | **attachment** | — |
| `application/pdf` | `.pdf` | document | inline | — |
| **`video/mp4`** | **`.mp4`** | **video** | **inline** | — |
| **`video/webm`** | **`.webm`** | **video** | **inline** | — |
| **`audio/mpeg`** | **`.mp3`** | **audio** | **inline** | — |

The new rows are deliberately minimal: every row is an audit, and `customFileTypes` covers the rest.
The `raster` column reproduces today's `RASTER_MIME` exactly — AVIF and GIF stay out of `sharp`.

## Why `audio` ships with the enum

Choosing a four-value `fileCategory` obliges the catalog to carry at least one audio row. An enum
member no row uses is an empty promise: the three consumers would carry a branch that never executes,
and the first `audio/mpeg` a consumer configured would hit the very 415 this change exists to remove.
`audio/mpeg` costs one row and one icon.

## Impact on existing consumers

- **Nobody's build breaks** unless their `allowedFileTypes` already names a MIME the system cannot
  serve — in which case they are silently eating 415s today and will now get a build error naming the
  MIME. **A loud failure replaces a silent one. That is the improvement.**
- **AVIF is fixed** for everyone, including variants generated by the existing pipeline.
- **Nothing new is enabled by default.** Video and audio require an explicit `allowedFileTypes`.
- **`ASTRO_BLOCKS_MAX_UPLOAD_BYTES` keeps working**, unchanged, with the same semantics.

## Semver

**`minor`.** `MIME_TO_EXT`, `RASTER_MIME` and `intersectAccept` are **not public API** — verified
against `package.json#exports` and `src/plugin/index.ts:219`, which re-exports only
`DEFAULT_ALLOWED_FILE_TYPES`. That constant does not change. The catalog refactor is entirely internal.

## ADRs

- **ADR-0023 — The supported-file-type catalog is the single source of truth.** Supersedes
  **ADR-0018**, whose Consequences omitted `MIME_TO_EXT` from the cross-check list and thereby produced
  this bug.
- **ADR-0024 — Category-branched ingest and Range-capable serving.**

## Out of scope

- **#102** — per-component `accept` is not enforced server-side. `handleUpload` receives only the
  `Request`: bytes, `content-type`, `x-cms-filename`. It has **no idea which block or prop the upload
  is for.** Enforcing it means sending the block/prop identity and resolving the schema server-side —
  a protocol change, not a gate tweak. Its own change, its own ADR.
- **ffprobe / ffmpeg** — a native binary is a new system requirement for the package. Separate ADR,
  likely a major.
- **Auto-generated posters** and **`<video>` previews in the grid** — UX iterations, worth revisiting
  once Range support is in production.
