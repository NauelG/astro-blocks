<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0018 — Non-image file uploads: 'file' prop type + server-side denylist

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-06-29
- **Source:** engram observation(s) #1833, #800

> **Compliance note (2026-07-14).** Verified against the code. Everything load-bearing for security is
> enforced server-side: the hard denylist runs **before** the allowlist (`src/utils/upload-gate.ts:100-119`,
> `src/api/handlers/media.ts:110-118`), the stored extension is derived from the MIME map and never from
> user input, and path containment is separator-safe. **But this ADR describes `intersectAccept()` as
> computing the "effective allowlist", and that never reaches the server.** Its only call site is
> `src/routes/admin/client/block-form.ts:996` — the media picker's browser-side filter. The upload
> endpoint enforces the *global* allowlist only. Per-component `accept` is a UI affordance, not a
> server-enforced constraint. Tracked in **#102**.

## Context

The media system originally only handled images. Extending it to non-image downloadable files (PDFs, etc.) for use cases like "download this brochure" buttons introduces a security surface that images alone do not: if a developer's `allowedFileTypes` configuration is ever too permissive (or misconfigured), the upload endpoint must not let that turn into a way to store and later serve executable or script content from the CMS's own upload directory. An allowlist alone is not enough, because it depends entirely on the plugin consumer's configuration being correct; a dangerous type could be added to the allowlist by mistake (or by a compromised config) and become servable.

Two independent security fixes in the surrounding upload path are load-bearing for this feature: the on-disk file extension must never be derived from the user-supplied filename (an attacker can name an SVG `foo.jpg` to slip past an extension-based guard elsewhere in the serving path), and the "is this path inside the uploads directory" check must use a proper separator boundary (a plain `string.startsWith(uploadsDir)` check passes for sibling directories like `public/uploads-evil`, which is not actually inside `public/uploads`).

## Decision

We will add a new `'file'` `PrimitivePropType` (distinct from `'image'`) for non-image, downloadable-file props, with these mechanisms:

- A plugin-level `allowedFileTypes: string[]` config (MIME strings), defaulting to `DEFAULT_ALLOWED_FILE_TYPES` when not provided. The shipped default allowlist is the 5 existing image MIME types plus `application/pdf`.
- Per-component, a `'file'` prop can narrow the global allowlist via an `accept: string[]` meta; `utils/file-types.ts#intersectAccept()` computes the effective allowlist as the (case-insensitive) intersection of the component's `accept` and the global `allowedFileTypes`.
- **A hard, server-side denylist is enforced unconditionally, before the allowlist check, and cannot be overridden by any allowlist configuration.** This lives in `utils/upload-gate.ts#evaluateUpload()`: denylist on MIME type (exact set + a regex covering MIME families) first, then denylist on the *derived* file extension, and only then the allowlist membership check. The denylist wins even if a misconfigured allowlist includes a dangerous MIME type.
- The on-disk file extension is always derived from the **validated MIME type** via a `MIME_TO_EXT` map (`utils/file-types.ts`, merging image and document extensions), never from the uploaded filename — this closes the extension-spoofing path that previously allowed an SVG to be stored with a `.jpg` extension and served inline as HTML/XML. The sanitized base filename is also stripped to a safe character set (`[^a-zA-Z0-9_-]` replaced with `_`, capped at 64 chars) before being used on disk.
- The uploads-path containment check in `utils/paths.ts#resolveUploadPath()` requires the resolved path to equal the uploads directory or start with `uploadsDir + path.sep`, closing the sibling-directory bypass of a bare `startsWith(uploadsDir)` check.

## Consequences

- Easier: consumers can accept downloadable non-image files per component without writing their own MIME validation, and get a conservative, safe-by-default allowlist out of the box.
- Harder / to watch: `'image'` and `'file'` prop types now diverge in behavior (only raster MIME types under `'image'`-style handling go through `sharp`/variant generation — see ADR-0017 — while `'file'` uploads of any allowed type, including images used as generic files, do not get responsive variants). Any future addition to `DEFAULT_ALLOWED_FILE_TYPES` or a consumer's `allowedFileTypes` must be cross-checked against `DANGEROUS_EXTENSIONS`/`DANGEROUS_MIME` in `utils/upload-gate.ts`, since the denylist is a fixed, hardcoded set, not derived from the allowlist.
- Security-relevant regression tests exist for both fixes (extension-from-MIME and path-separator boundary) and should be kept green as this area evolves.

> Reviewer note: the code comments in `utils/upload-gate.ts` and `api/handlers/media.ts` reference "ADR-4" as the source of the denylist decision. The repository's existing `DECISIONS.md` numbers its own ADRs `ADR-001`…`ADR-006`, and `ADR-004` there is "Admin UI default language English; i18n with en/es catalogs" — an unrelated decision. There is no `DECISIONS.md` entry that actually documents the upload denylist. This draft (0018) is likely the intended replacement/formalization of whatever informal "ADR-4" the code comments refer to; the numbering mismatch should be reconciled by whoever accepts this draft (e.g., by updating the code comments to point at `ADR-0018` once accepted, or by cross-referencing `DECISIONS.md` if that is meant to be the canonical index).

See ADR-0016 for how `'image'` field values are structured, and ADR-0017 for the raster-only variant pipeline that `'file'` uploads intentionally skip.

## Evidence (current repo)

- `types/index.ts` — `PrimitivePropType` includes `'file'`; `PropDefinition`/config carries `allowedFileTypes?: string[]` (documented as defaulting to `DEFAULT_ALLOWED_FILE_TYPES`).
- `contract/index.ts` — `'file'` present among the primitive prop type list.
- `utils/file-types.ts` — `DEFAULT_ALLOWED_FILE_TYPES` (6 entries: 5 image MIME types + `application/pdf`), `RASTER_MIME`, `MIME_TO_EXT` (merged image + document extension map), `intersectAccept()`.
- `utils/upload-gate.ts` — `DANGEROUS_EXTENSIONS` (`.html`, `.htm`, `.js`, `.mjs`, `.cjs`, `.exe`, `.sh`, `.bat`, `.cmd`, `.com`, `.svgz`), `DANGEROUS_MIME` + `DANGEROUS_MIME_PATTERN`, `evaluateUpload()` implementing the locked denylist-before-allowlist order.
- `utils/paths.ts:83` — `resolveUploadPath()`: `resolved !== uploadsDir && !resolved.startsWith(uploadsDir + path.sep)` (separator-safe containment check).
- `api/handlers/media.ts` — imports `MIME_TO_EXT` from `utils/file-types.ts`, derives `extension`/`derivedExtension` from the validated MIME (not `path.extname(rawName)`), and sanitizes the base filename (`rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'file'`).
- Note: obs #800 describes these two security fixes as originally landing in a monolithic `api/handlers.ts` (~line 63, ~lines 1307-1317); the current repo has since refactored that file into `api/handlers/media.ts` plus `utils/file-types.ts` (per the recent `refactor(api)` commit series). The fixes are present and verified in their current locations, not at the original line numbers.
