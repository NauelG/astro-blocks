<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0023 — The supported-file-type catalog is the single source of truth

- **Status:** Accepted — supersedes ADR-0018
- **Date:** 2026-07-14
- **Deciders:** Nauel Gómez
- **Source:** user incident against `@astroblocks/astro-blocks@3.4.0` — `type: 'file'` returns 415 for
  `video/mp4` despite it being listed in `allowedFileTypes`. Reproduced at 3.5.4.

## Contexto

ADR-0018 introduced the `'file'` prop type, a configurable `allowedFileTypes` allowlist, a hard
server-side denylist that always wins, and the rule that a stored file's extension is **derived from
the validated MIME type, never from the user-supplied filename** (an SVG named `foo.jpg` served inline
is stored XSS). Those mechanisms are correct and this ADR keeps every one of them.

What ADR-0018 did not see is that the extension map it introduced, `MIME_TO_EXT`, is **itself a gate**.
Its Consequences require that any addition to `allowedFileTypes` be cross-checked against
`DANGEROUS_EXTENSIONS` / `DANGEROUS_MIME` — it remembered the denylist and forgot the extension map.

The result is two allowlists, only one of which is declared:

- **`allowedFileTypes`** — public, configurable, documented in the README and in `docs/media.md`, where
  it is described as something the consumer can *"override"*, with no stated ceiling.
- **the keys of `MIME_TO_EXT`** — implicit, hardcoded, never named as an allowlist at all.

A consumer can widen the first and cannot widen the second. So a MIME added to `allowedFileTypes` and
absent from `MIME_TO_EXT` passes the security gate, then dies one statement later on a *second* 415
with the *same* error key — the gate said yes and the extension lookup said no. A consumer who reads
the documentation, does exactly what it authorises, and gets a 415 has found a defect in our contract,
not made a configuration error.

The same fragmentation exists on the serving side, and it has already produced a live bug that has
nothing to do with this incident. `src/routes/uploads-get.ts` keeps its *own* extension→Content-Type
map, and it has no `.avif` entry — while `variant-generator.ts` writes `.avif` variants. **Every AVIF
variant AstroBlocks generates is served as `application/octet-stream`.** Browsers sniff images and
render it anyway, which is exactly why it went unnoticed.

In total, five hardcoded constants each hold an opinion about file types, nothing derives them from one
another, and nothing forces them to agree: `DEFAULT_ALLOWED_FILE_TYPES`, `MIME_TO_EXT`, `RASTER_MIME`,
`uploads-get.ts#MIME`, `uploads-get.ts#IMAGE_CONTENT_TYPES`.

**A survey of how other CMSs handle this sharpened the diagnosis.** Payload, Strapi and Directus all
ship *open* allowlists — any MIME string the consumer writes is accepted. They can afford that only
because they take the stored extension from the client's filename. Where they must fall back to
deriving it from the MIME, they have no answer: Strapi and Directus both compute
`'.' + mimeTypes.extension(type)`, which yields the literal string **`".false"`** for an unknown MIME.
WordPress is the one system with a closed catalog, and the reason it can still let developers extend it
is structural: its allowlist **is not a list of MIMEs — it is a map keyed by extension**
(`wp_get_mime_types()`), so the question *"what extension does this unknown MIME get?"* cannot even be
asked.

AstroBlocks has WordPress's requirement (extension derived from MIME, for a security reason we are not
giving up) and Strapi's data structure (a flat list of MIME strings). **Those two cannot coexist.** The
415 is the system correctly refusing to store a file it cannot safely name. It is right to refuse; it
is wrong about when, and about what it tells the caller.

## Decisión

**A supported file type is a tuple, and every file-type decision in the system is a view over one
catalog of them.**

- The catalog (`src/utils/file-catalog.ts`) holds rows of
  `{ mime, ext, contentType, category, disposition, raster }`. `mime` is the primary key.
  `category ∈ { image, video, audio, document }`.

- **All five constants above are derived from it.** The stored extension, the served `Content-Type`,
  the inline/attachment policy, the `sharp` routing decision and the admin tile are read from the row.
  No component keeps a private map. `MIME_TO_EXT`, `RASTER_MIME`, `uploads-get.ts#MIME` and
  `IMAGE_CONTENT_TYPES` are deleted.

- **`disposition` is a column.** The SVG-must-be-an-attachment rule stops being an `if` in the serving
  route and becomes data on the `image/svg+xml` row, where it cannot be forgotten by the next route
  that serves a file.

- **The catalog is not the allowlist.** `DEFAULT_ALLOWED_FILE_TYPES` still means *what is enabled out
  of the box* (the same six types, unchanged), while the catalog means *what the system can handle*.
  Conflating the two is what produced this bug. `video/mp4`, `video/webm` and `audio/mpeg` join the
  catalog and stay **out** of the default allowlist: a consumer opts in via `allowedFileTypes`, which is
  what the reporter already did. The invariant `DEFAULT_ALLOWED_FILE_TYPES ⊆ catalog` is asserted by a
  test.

- **`fileCategory` is declared, not parsed.** It is read from the row, never derived from
  `mimeType.startsWith('image/')`. This follows every mature CMS surveyed: Strapi validates a closed
  `MediaKind` enum at the schema layer, Sanity selects `imageAsset` vs `fileAsset` by endpoint,
  WordPress indexes its nine categories by extension. None of them parses a client-supplied MIME string
  to decide what a thing *is*.

- **The escape hatch is a registration, not a bypass.** `customFileTypes: Array<{ mime, ext, category }>`
  appends rows. It **cannot** set `contentType` or `disposition`: every registered row is forced to
  `application/octet-stream` + `attachment`, so a consumer-registered type can never be rendered in the
  CMS's own origin and is **structurally incapable** of reintroducing stored XSS. The denylist still runs
  over it — a row declaring `text/html` or `.js` is rejected.

  This is a deliberate rejection of the shape Payload ships, where `allowRestrictedFileTypes` is
  *"overriden by the `mimeTypes` option"*: defining `mimeTypes` there skips the executable denylist
  entirely, so a config as innocent as `mimeTypes: ['image/*']` silently disables it. ADR-0018's
  central promise is that **the denylist always wins**. A bypass would make that promise conditional.

- **An unsupported MIME fails at config time, not at upload time.** A MIME in `allowedFileTypes` that
  is in neither the catalog nor `customFileTypes` **throws** at `astro:config:setup` — following
  `validateGlobalBlocks()`, which already throws on a bad slug — with a message naming the MIME, listing
  the supported types, and pointing at `customFileTypes`.

  This is what makes the fix structural. It guarantees `allowedFileTypes ⊆ catalog`, which makes the
  `if (!extension) return 415` branch that caused this incident **unreachable by construction**. We do
  not patch the bug; we delete the state in which it can exist. Should the branch somehow be reached, it
  raises a 500 — a broken server invariant is not the client's unsupported file, and saying so would be
  the very lie this ADR exists to stop telling.

### What ADR-0018 decided that survives, unchanged

The denylist (`DANGEROUS_MIME`, `DANGEROUS_MIME_PATTERN`, `DANGEROUS_EXTENSIONS`) and its locked
evaluation order in `evaluateUpload()`; the rule that the stored extension is derived from the validated
MIME and never from the filename; the sanitised base filename; and the separator-safe containment check
in `resolveUploadPath()`. ADR-0018 is superseded for its *structure*, not for its *security posture* —
which this ADR strengthens by making it data rather than discipline.

## Consecuencias

- **Easier:** adding a file type is one row. The extension, the served type, the disposition, the tile
  and the `sharp` decision all follow from it, and cannot drift apart. The AVIF serving bug is fixed as
  a side effect of the same rule, without anyone hunting for it.
- **Easier:** a consumer who asks for something the system cannot do learns it when they build, in a
  message that tells them what to do next — instead of when an editor tries to upload, in a 415 that
  says nothing.
- **Harder / to watch:** every new catalog row is a security decision, and must be reviewed against the
  denylist and against how the serving route will hand the bytes to a browser. `disposition: 'inline'`
  on a row is a statement that the type is safe to render in our own origin. The escape hatch exists so
  that consumers never need us to make that call for their exotic formats — and that is exactly why it
  is hard-wired to `attachment`.
- **Harder / to watch:** the effective catalog is now consumer-dependent (builtins + `customFileTypes`),
  so it travels through `vite.define` into `import.meta.env`, the same path `allowedFileTypes` already
  uses. Anything reading the catalog at runtime must go through the memoised resolver, and tests must
  reset it — the trap `resetAllowedFileTypesCache()` already exists to handle.
- **Breaking, deliberately:** a consumer whose `allowedFileTypes` today names a MIME the system cannot
  serve will see their **build fail** rather than their uploads silently 415. That is the point. A loud
  failure replaces a silent one, and the message tells them how to fix it. Per the repo's compatibility
  policy, there is no fallback and no migration path.
- **Not breaking for anyone else:** `MIME_TO_EXT`, `RASTER_MIME` and `intersectAccept` are not public
  API (`package.json#exports` exposes only `src/plugin/index.ts`, which re-exports
  `DEFAULT_ALLOWED_FILE_TYPES` alone, and that constant does not change). The refactor is internal, and
  the release is a **minor**.

See ADR-0024 for the ingest and serving model that video makes necessary, ADR-0016 for the `'image'`
field value shape, and ADR-0017 for the raster-only variant pipeline that non-raster rows skip.
