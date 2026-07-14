<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — A supported-file-type catalog, and video/audio on top of it

The whole design is one idea: **a supported file type is a tuple, and everything else is a view over
it.** The five hardcoded constants stop being five opinions and become five projections of one table.

---

## 1. The catalog — `src/utils/file-catalog.ts`

New module. Replaces `utils/file-types.ts` as the source of truth; `file-types.ts` is deleted and its
one public export (`DEFAULT_ALLOWED_FILE_TYPES`) re-homed here, unchanged in value.

```ts
export type FileCategory = 'image' | 'video' | 'audio' | 'document';

export interface FileTypeRow {
  /** Canonical MIME, lowercase. Primary key. */
  mime: string;
  /** Stored extension, with the leading dot. Derived from the MIME, never from the filename. */
  ext: string;
  /** Content-Type used when serving. Equal to `mime` for every builtin row. */
  contentType: string;
  /** Governs ingest strategy, sharp routing, admin tile, and serving policy. */
  category: FileCategory;
  /** 'inline' → no Content-Disposition. 'attachment' → always downloaded. */
  disposition: 'inline' | 'attachment';
  /** True only for MIMEs sharp may process. Reproduces today's RASTER_MIME exactly. */
  raster: boolean;
}
```

`contentType` is a distinct field from `mime` on purpose: a custom row may need to be *stored* under
one MIME and *served* under another (the classic case is serving an unknown type as
`application/octet-stream`). For every builtin row they are equal.

### The builtin rows

| mime | ext | contentType | category | disposition | raster |
|------|-----|-------------|----------|-------------|--------|
| `image/jpeg` | `.jpg` | `image/jpeg` | image | inline | ✅ |
| `image/png` | `.png` | `image/png` | image | inline | ✅ |
| `image/webp` | `.webp` | `image/webp` | image | inline | ✅ |
| `image/gif` | `.gif` | `image/gif` | image | inline | — |
| `image/avif` | `.avif` | `image/avif` | image | inline | — |
| `image/svg+xml` | `.svg` | `image/svg+xml` | image | **attachment** | — |
| `application/pdf` | `.pdf` | `application/pdf` | document | inline | — |
| `video/mp4` | `.mp4` | `video/mp4` | video | inline | — |
| `video/webm` | `.webm` | `video/webm` | video | inline | — |
| `audio/mpeg` | `.mp3` | `audio/mpeg` | audio | inline | — |

`image/svg+xml` carries `disposition: 'attachment'` — **the XSS guard stops being a special case in the
serving route and becomes a column**. That is the whole point of the table: the rule now lives with the
data it governs.

`image/avif` and `image/gif` are `raster: false`, reproducing `RASTER_MIME` exactly. This change does
not touch what `sharp` processes.

### The derived views

Every one of the five constants is now computed, not written:

```ts
export const DEFAULT_ALLOWED_FILE_TYPES: string[] = [ /* the same 6, unchanged */ ];

export function lookupByMime(mime: string, catalog: FileTypeRow[]): FileTypeRow | null;
export function lookupByExt(ext: string, catalog: FileTypeRow[]): FileTypeRow | null;
export function isRaster(mime: string, catalog: FileTypeRow[]): boolean;
```

`DEFAULT_ALLOWED_FILE_TYPES` stays a hand-written literal, not `BUILTIN_ROWS.map(r => r.mime)` —
because it means "what is **on** out of the box", which is a different question from "what the system
**can** handle". Conflating them is precisely the mistake that produced this bug. Video and audio are
in the catalog and **not** in this list.

A unit test asserts `DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog.map(r => r.mime)` — the one invariant that
must hold between them.

### The effective catalog

```
effective = BUILTIN_ROWS ++ customRows
```

`customRows` come from the consumer's `customFileTypes` option and reach the runtime the same way
`allowedFileTypes` does today: serialised by `vite.define` into
`import.meta.env.ASTRO_BLOCKS_CUSTOM_FILE_TYPES` (`plugin/index.ts:409` is the existing precedent),
parsed and memoised on first use, with a `resetFileCatalogCache()` test hook mirroring
`resetAllowedFileTypesCache()`.

---

## 2. Config — the escape hatch, and how it stays safe

### `AstroBlocksOptions` gains two fields

```ts
/** Register file types the builtin catalog does not cover. Always served as attachment. */
customFileTypes?: Array<{ mime: string; ext: string; category: FileCategory }>;

/** Per-category upload ceiling, in bytes. Omitted categories use the built-in default. */
maxUploadBytes?: Partial<Record<FileCategory, number>>;
```

`customFileTypes` deliberately **does not accept `disposition` or `contentType`**. Every registered row
is forced to:

```ts
{ ...row, contentType: 'application/octet-stream', disposition: 'attachment', raster: false }
```

This is the load-bearing security property of the whole design. A registered type **cannot be rendered
in the CMS's own origin**, so the escape hatch is *structurally incapable* of reintroducing the stored
XSS that ADR-0018 exists to prevent. It is a registration, not a bypass.

The contrast is not hypothetical. Payload CMS ships the bypass shape: `checkFileRestrictions.ts` skips
its executable denylist entirely when the collection defines `mimeTypes`, so a config as innocent as
`mimeTypes: ['image/*']` silently disables the security denylist. We do not build that door.

### `validateFileTypeConfig()` — runs at `astro:config:setup`, throws

Following `validateGlobalBlocks()` (`plugin/index.ts:66-83`), which throws on a bad slug. Four rules:

| Rule | Violation | Message |
|------|-----------|---------|
| **V1** | A `customFileTypes` row whose `mime` hits `DANGEROUS_MIME` / `DANGEROUS_MIME_PATTERN` | denylist wins — cannot be registered |
| **V2** | A row whose `ext` hits `DANGEROUS_EXTENSIONS` | same |
| **V3** | A row whose `mime` already exists in the builtin catalog | duplicate — cannot shadow a builtin |
| **V4** | A MIME in `allowedFileTypes` that is in **neither** the builtin catalog **nor** `customFileTypes` | unsupported — names the MIME, lists the supported ones, points at `customFileTypes` |

Also validated: `ext` matches `/^\.[a-z0-9]+$/`, `mime` is non-empty lowercase, `category` is one of
the four.

**V4 is the fix.** It guarantees `allowedFileTypes ⊆ effectiveCatalog`, which is what makes the
`if (!extension)` branch at `media.ts:127-131` — the exact line that caused this incident —
**unreachable by construction**. We do not patch the bug; we remove the state in which it can exist.

### Belt and braces: `allowlist ∩ catalog` at runtime

`getAllowedFileTypes()` intersects the resolved allowlist with the effective catalog. For any config
that passed V4 this is a no-op — which is the point. It exists so that **no** path, including one that
somehow bypasses build-time validation, can admit an uncatalogued MIME. V4 makes the misconfiguration
*loud*; the intersection makes the bad state *impossible*. The 500 in §3 is then genuinely unreachable
rather than merely unlikely.

### Testability — the reason this bug shipped

`tests/media-handlers.test.js:1330-1347` records, in the repo's own words, that the *"allowlisted +
unmapped"* case is **"not reachable via the prebuilt dist"** because the allowlist is a Vite
compile-time constant, and then declares the resulting 415 *"guaranteed deterministically"*. That case
**is this bug**. It was reached, found untestable, approximated by a neighbouring test, and canonised
as `FIX M-1`.

So the fix must make the state reachable, or it repeats the story. `media.ts` gains
`__setAllowedFileTypesForTest(mimes | null)` beside the `resetAllowedFileTypesCache()` that already
exists for exactly this purpose. A test-only export is not elegant, and it is the honest choice here:
it adds **zero production configuration surface**. Routing the allowlist through `process.env` would
have been prettier at the call site and would have quietly created a runtime path to *widen* a
security-relevant allowlist, bypassing V4. Not worth it.

The existing empty-allowlist `console.warn` (`plugin/index.ts:208-212`) and the advisory
`validateFileProps()` warn (`:255`) both stay warnings. They describe configs that are a **no-op**, not
configs the system **cannot honour**. Different failures, different loudness.

### Size limits

```ts
const DEFAULT_MAX_BYTES: Record<FileCategory, number> = {
  image: 5 * 1024 * 1024,      // unchanged from today
  document: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};
```

Effective limit for a row — **most specific wins**:

```
limit(category) = maxUploadBytes[category]         // build-time, per category
               ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES    // runtime, global
               ?? DEFAULT_MAX_BYTES[category]      // shipped default
```

`maxUploadBytes` is **build-time policy** (plugin option → `vite.define`, like `allowedFileTypes`).
`ASTRO_BLOCKS_MAX_UPLOAD_BYTES` is the **runtime global limit** (`process.env`, read per request so it
takes effect without a rebuild). It is kept, not deprecated.

> **Correction, made during implementation.** The grilling settled on the env var becoming a *hard
> ceiling* — `min(policy, env)` — on the reasoning that "anyone who set it to 5 MB still gets 5 MB".
> That reasoning only considered *lowering*. `docs/media.md:384` documents the variable as "Maximum
> accepted upload size", and consumers **raise** it to allow bigger images; the existing `P3` tests
> exercise exactly that. Under `min()`, a consumer running with `ASTRO_BLOCKS_MAX_UPLOAD_BYTES=50MB`
> would silently drop to the 5 MB image default and find out when an editor failed to upload a photo
> in production. A ceiling is the wrong shape: the variable REPLACES the defaults, it does not clamp
> them. That keeps the documented contract, keeps the release a `minor`, and still lets whoever runs
> the server cap everything in one move.

The behavioural note worth documenting: today's single default of 5 MB applies to *everything*. After
this change, an unset env var means images stay at 5 MB and video gets 200 MB. Anyone who wants the old
blanket cap sets the env var, exactly as before.

---

## 3. Ingest — `handleUpload` / `handleReplaceUpload`

### Order of operations

```
1. mimeType ← Content-Type header                    (no body read)
2. row      ← lookupByMime(mimeType, effective)      (no body read)
3. gate     ← evaluateUpload({ mimeType,
                               derivedExtension: row?.ext ?? null,
                               allowed })             ← ADR-0018's locked order, untouched
   !ok → 415
4. limit    ← limit(row.category)
   Content-Length > limit → 413                      ← BEFORE the body is touched
5. category === 'image' ? buffer : streamToDisk
6. registry append, variants (raster only)
```

Steps 1-4 read **no bytes**. That is only possible because the MIME comes from the `Content-Type`
header (`media.ts:106`) rather than from sniffing — an existing property of the design that this change
finally cashes in.

`evaluateUpload()` itself does not change. Its locked order (denylist on MIME → denylist on derived ext
→ allowlist) is preserved exactly. It keeps receiving `derivedExtension: row?.ext ?? null`, so a MIME
with no row is still evaluated, and the denylist still wins over everything.

### After the gate, the row is guaranteed

`gate.ok` implies `mimeType ∈ allowedFileTypes`, and **V4** guarantees
`allowedFileTypes ⊆ effectiveCatalog`. Therefore `row` is non-null.

The old `if (!extension) return 415` becomes:

```ts
/* istanbul ignore next — V4 makes this unreachable; reaching it means the config
   validator is broken, which is a server bug, not a client error. */
if (!row) throw new Error('[astro-blocks] catalog invariant violated: allowlist admits an uncatalogued MIME');
```

It throws (→ 500), it does not return 415. **A 415 here would be a lie** — it would tell the client
their file is unsupported when in fact the server's own invariant is broken. Telling that lie is what
this whole change is about.

### Step 5 — branching on category

**`image`** → `await request.arrayBuffer()`, exactly as today. `imageSize` and `sharp` both need the
bytes resident, and images are bounded at 5 MB by default. Nothing changes for the common path.

**everything else** (`video`, `audio`, `document`) → stream `request.body` (a `ReadableStream`) into
`fs.createWriteStream(tmpPath)` through a counting transform:

```
bytesWritten += chunk.length
if (bytesWritten > limit) → destroy the stream, unlink the partial file, 413
```

The counter is the **authority**, not `Content-Length`. The header is client-supplied and may lie; the
step-4 check is a cheap early-out, not a guarantee. Write to a temp name and `fs.rename()` into place
on success, so a partial file is never observable at its final URL.

`handleReplaceUpload` (`media.ts:348`) takes the same treatment. It already requires the replacement to
carry the same MIME as the original, so its category — and therefore its limit and its strategy — are
identical by construction.

### Metadata

`imageSize` stays behind the existing guard, now expressed as `row.category === 'image'` instead of
`mimeType.startsWith('image/')`. Video and audio are **passthrough**: no width, no height, no duration,
no poster. `MediaEntry.width`/`height` simply stay `undefined`, which the admin tile already handles
(`formatDimensions` renders `—` and the meta row omits it).

`generateAndPersistVariants` swaps `RASTER_MIME.has(mime)` for `row.raster`. Behaviour is identical;
only the source of the answer moves.

---

## 4. Serving — `src/routes/uploads-get.ts`

The route is rewritten around three changes. Note that its `fs.readFile()` problem **already exists
today** for images and PDFs — video does not create it, it merely makes it fatal.

### 4.1 Content-Type and disposition come from the catalog

The local `MIME` map (`:12`) and `IMAGE_CONTENT_TYPES` (`:24`) are **deleted**. In their place:

```ts
const row = lookupByExt(path.extname(filePath).toLowerCase(), effectiveCatalog);
const contentType = row?.contentType ?? 'application/octet-stream';
const disposition = row?.disposition ?? 'attachment';   // unknown ext → never inline
```

Two consequences fall out for free:

- **AVIF is fixed.** `.avif` is a catalog row, so variants generated by `variant-generator.ts:66` finally
  get `Content-Type: image/avif` instead of `application/octet-stream`.
- **The SVG rule stops being special.** `disposition: 'attachment'` on the `image/svg+xml` row does what
  the hand-written `if (ext === '.svg')` did. Same behaviour, one fewer place to forget it.

`?download` continues to force `attachment` regardless of the row.

### 4.2 Range requests

```
Accept-Ranges: bytes                        ← on every response
no Range header      → 200 + full body (streamed)
valid Range          → 206 + Content-Range: bytes <start>-<end>/<size>
unsatisfiable Range  → 416 + Content-Range: bytes */<size>
```

Only the single-range form `bytes=start-end` / `bytes=start-` / `bytes=-suffix` is supported.
Multi-range (`bytes=0-99,200-299`) is answered with a `200` full body — legal per RFC 9110, which
permits a server to ignore a Range header it does not wish to honour, and no browser media element
sends multi-range.

**This is the piece without which "video support" is a lie.** Safari requests the first two bytes of a
video source and, absent a `206` with `Content-Range`, **discards the source and refuses to play** — it
does not degrade to a broken seek bar, it plays nothing. Chrome and Firefox tolerate a `200` but cannot
seek.

### 4.3 Streaming instead of `fs.readFile`

`fs.readFile()` (`:40`) becomes `fs.createReadStream(filePath, { start, end })`, adapted with
`Readable.toWeb()` and handed to `Response` as a stream body. Resident memory per request drops from
*the whole file* to a chunk — for **every** category, not just video. Ten concurrent viewers of a
100 MB video stop costing 1 GB of RAM on a route that has no authentication.

`resolveUploadPath()` (`utils/paths.ts:83`) is unchanged and still the only containment check. A `stat`
replaces the implicit existence check that `readFile` provided; `ENOENT` still maps to 404.

---

## 5. `fileCategory` — declared, not parsed

`media.ts:169` today:

```ts
const fileCategory = mimeType.startsWith('image/') ? 'image' : 'document';
```

becomes `row.category`. The MIME string stops being parsed for meaning.

This matters beyond tidiness. The mature CMSs converge on it: Strapi validates its `MediaKind` enum
(`images|videos|files|audios`) with zod at the schema layer and only uses `mime.split('/')[0]` in its
*admin UI*; Sanity picks `imageAsset` vs `fileAsset` by **endpoint**; WordPress indexes its nine
categories by **extension**. None of them parses the MIME to decide what a thing *is*. Deriving
identity from a string you were handed by the client is exactly the class of mistake this change exists
to retire.

`types/index.ts:309` widens to `fileCategory?: 'image' | 'video' | 'audio' | 'document'`. Purely
additive — every stored entry today holds `'image'` or `'document'`, both still valid, so there is no
migration.

The legacy-entry fallback in `data.ts:600-605` (entries written before `fileCategory` existed) switches
from `mimeType.startsWith('image/')` to a catalog lookup, defaulting to `'document'` for a MIME no
longer in the catalog.

---

## 6. Admin UI

`docs/DESIGN.md` §1.1 (*"diseño por sustracción"*) and §1.13 (*"no crear estilos ad hoc para cada
pantalla si pueden resolverse dentro del sistema compartido"*) settle this: **the pattern already
exists.** `media.astro:151-157` renders a document with `.cms-media-card-thumb--doc` and an inline SVG
in place of the `<img>`. Video and audio are two more modifiers of the same thumb, not a new component.

Three call sites replace their `isDocument` ternary with a switch on `entry.fileCategory`:

| File | Line | Today |
|------|------|-------|
| `routes/admin/media.astro` | 146 | `fileCategory === 'document' \|\| (!fileCategory && !mimeType.startsWith('image/'))` |
| `routes/admin/client/media.ts` | 71 | same shape |
| `routes/admin/client/block-form.ts` | 464 | `!mimeType.startsWith('image/')` |

The legacy-entry fallback stays in all three (entries predating `fileCategory`), but resolves through
the catalog rather than a `startsWith`.

`src/styles/cms-admin.css` gains `.cms-media-card-thumb--video` and `--audio` beside the existing
`--doc`. Same surface, same border, same neutral treatment — only the icon changes. No new colour, no
elevation, nothing that reads as decoration. The accent colour is not involved: §1.1 caps it at 10% and
a media tile is not where it gets spent.

**No `<video>` element in the grid.** A `<video preload="metadata">` would paint a real first frame
without ffmpeg, and it is tempting — but it fires range requests from every tile on a 24-item page and
puts a media element inside a listing that is static today. It is a UX iteration with its own GATE, not
a rider on a security and domain change.

---

## 7. Playground

`docs/DECISIONS.md` requires every new feature to ship a working demo under `playgrounds/`. The
`basic` playground gets `allowedFileTypes` extended with `video/mp4` and a block with a
`type: 'file'`, `accept: ['video/mp4']` prop — **the exact configuration from the incident report**.
It is the regression baseline: if this config ever 415s again, the playground is where it shows.

---

## 8. Tests

Unit (`node:test`, per the repo's runner):

- **Catalog.** `DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog`. `lookupByMime`/`lookupByExt` round-trip every
  row. No two rows share a `mime` or an `ext`.
- **V1-V4.** Each throws, and the message names the offending MIME. A `customFileTypes` row declaring
  `text/html` or `.js` is rejected — **the denylist still wins over the escape hatch**.
- **Registered rows are forced to `attachment` + `octet-stream`**, whatever the consumer passed.
- **The regression itself.** `allowedFileTypes: ['video/mp4']` + an MP4 body → **200, not 415**, stored
  as `.mp4`, `fileCategory: 'video'`, no variants. This test would have failed before the change; it is
  the incident, encoded.
- **The AVIF bug.** `GET` a `.avif` → `Content-Type: image/avif`, not `application/octet-stream`. Also
  a pre-existing failure.
- **Limits.** Per-category ceilings; the env var clamps below them; an oversized body is rejected with
  413 and **leaves no file on disk**.
- **Range.** `200` + `Accept-Ranges` with no Range header; `206` + correct `Content-Range` for
  `bytes=0-1` (Safari's probe); `416` for an unsatisfiable range.

E2E (Playwright): upload an MP4 through the media library, assert the video tile renders, and assert
`GET` with `Range: bytes=0-1` answers `206`.

---

## 9. What this does not do

- **#102** — per-component `accept` is still not enforced server-side. `handleUpload` receives bytes, a
  `Content-Type` and a filename; it has no idea which block or prop the upload belongs to. Enforcing it
  requires sending that identity and resolving the schema server-side: a protocol change, with its own
  ADR. ADR-0018's compliance note already tracks it.
- **No ffmpeg, no ffprobe.** A native binary is a new system requirement for the package — its own ADR,
  probably its own major.
- **No auto-generated posters, no `<video>` previews.**
