<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0020 — Media library: server-side search + pagination

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-06-14
- **Source:** engram observation #838

> **Compliance note (2026-07-14).** Verified against the code. The **handler** is a line-for-line match
> with this decision (`src/api/handlers/media.ts:240-265`), search and pagination really are
> server-side, and the shared `fetchMedia()` utility the ADR could not verify does exist and is used by
> both the grid and the picker. **The drift is at the consumer edges.** (1) The SSR first paint
> (`src/routes/admin/media.astro:32-33`) renders the *entire* registry with no sort, filter or slice —
> exactly what this ADR's Context rejects — and in a different order than the client re-render.
> (2) The picker's `accept` filter runs client-side **after** the server's slice
> (`src/routes/admin/client/block-form.ts:499-503`), so file-mode counts and paging are wrong. That is
> the "each consumer re-implementing filtering client-side" this ADR set out to prevent. Tracked in
> **#104**.

## Context

As the media library grows, returning the full upload list on every request does not scale and makes the admin grid and the image picker slow to render. Search and pagination need to happen once, server-side, and be shared by both consumers (the admin grid and the block-form image picker) rather than each re-implementing filtering client-side.

## Decision

We will implement search and pagination server-side in `handleGetMedia` (`GET /cms/api/media`): it reads `?q` (case-insensitive filename substring search), `?page`, and `?limit` query parameters, applies them **after** `reconcileMedia()` and a newest-first sort, and returns an envelope of `{ uploads, total, page, limit }`. `limit` is clamped to `[1, 100]` (default 24 when absent/invalid); `page` defaults to 1 when absent/invalid.

Visible metadata is limited to what the registry already stores — dimensions, size, MIME type, `createdAt` — shown in both the admin card and the picker. There is no real EXIF extraction in this slice (no new dependency, and it would introduce a GPS/PII risk); real EXIF support is explicitly deferred to a possible future change.

## Consequences

- Easier: the admin grid and the picker can both page through large media libraries without loading everything at once; behavior (limit clamping, filter-then-slice order) is defined once, in one handler.
- Harder / to watch: `reconcileMedia()` still runs on every `GET /cms/api/media` call regardless of query parameters, which is the dominant cost at scale — this slice does not optimize that, it is flagged as a known future concern. No EXIF metadata (real or otherwise) is surfaced to users beyond what the upload pipeline already captures (dimensions via `image-size`, from ADR-0016's context).

This ADR is intentionally short: the source memory for this decision is thin, and the implementation is a straightforward, low-risk change confirmed directly in the handler.

See ADR-0017 for the `reconcileMedia()`/variant-status fields surfaced alongside pagination, and ADR-0019 for the usage/replace endpoints that share the same `api/handlers/media.ts` module.

## Evidence (current repo)

- `api/handlers/media.ts` — `handleGetMedia()`: parses `q`/`page`/`limit` from `URL.searchParams`; pipeline is `reconcileMedia()` → sort by `createdAt` descending → filter by `q` (case-insensitive `filename.includes`) → `total = filtered.length` → `slice((page-1)*limit, page*limit)`; response is `Response.json({ uploads, total, page, limit })`. `limit` clamped via `Math.min(100, Math.max(1, limit))`, defaulting to 24 on `NaN`.
- No EXIF-related import, dependency, or field was found in `api/handlers/media.ts`, `types/index.ts`'s `MediaEntry`, or `utils/file-types.ts` — consistent with "no real EXIF extraction."
- Could not verify from this pass: whether a shared `fetchMedia(params)` utility (mentioned in the source as intended to be used by both the admin grid and the picker) exists and is actually shared between `routes/admin/client/media.ts` (or `media-fetch.ts`) and the block-form picker — this would require reading those UI-side files, which were out of scope for verifying the server-side handler decision this ADR documents.
