<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0017 — Responsive images via sharp on-upload variant generation

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-06-14
- **Source:** engram observation #827

## Context

Astro's built-in `astro:assets` image optimization only applies to assets imported from `src/` at *build* time. Content uploaded through the CMS admin panel lands in `public/uploads/` at runtime and is never touched by that pipeline — so without a dedicated mechanism, every CMS-uploaded image would be served at its original size and format regardless of viewport, hurting LCP and bandwidth.

The naive fix — generating responsive variants synchronously during the upload request — would make uploads slow and fragile (sharp's native binary work blocking the HTTP response). The chosen alternative also had to decide what to do with the original file: an earlier idea to discard the original after generating variants was rejected because it removes the ability to regenerate, breaks the `<picture>` fallback path, and is lossy/irreversible.

## Decision

We will process CMS-uploaded raster images asynchronously, in-process, right after upload, using `sharp` (declared as a direct dependency in `package.json`, already an optional dependency of Astro itself):

- `handleUpload` persists the original file and creates a `MediaEntry` with `status: 'processing'`, then returns immediately. `utils/variant-generator.ts#generateAndPersistVariants` is fired without being awaited by the response path.
- Only raster MIME types (`image/jpeg`, `image/png`, `image/webp` — see `RASTER_MIME` in `utils/file-types.ts`) go through sharp. Non-raster types (SVG, GIF, PDF, and any future document type) are marked `status: 'ready'` with an empty `variants` array immediately, without invoking sharp.
- For raster images, variants are generated at fixed breakpoints (480/800/1200/1920px), for `webp` and `avif`, with **no upscaling** — a breakpoint is skipped if it is not strictly smaller than the original width.
- The **original file is always kept** as the source of truth: it backs regeneration, is the fallback inside `<picture>`, and preserves a lossless copy.
- On completion, the entry is marked `status: 'ready'` with the generated variant list; on any failure (missing sharp binary, fs error, encode error) it is marked `status: 'failed'` and never rethrows — variant generation is best-effort and must never break the upload response.
- At render time, `components/BlockImage.astro` looks up variants by URL via `utils/getMediaVariants.ts` (an mtime-cached registry reader) rather than snapshotting them into `ImageFieldValue` at pick time, because variants may not exist yet when the field value is created. While `status !== 'ready'` or there are no variants, `BlockImage` serves the original `<img>`; once ready, it emits a `<picture>` with `avif`/`webp` `<source>`s plus the original as the `<img>` fallback.
- Non-lazy rendering is opt-in via a `priority` prop (`loading="eager"` + `fetchpriority="high"`); the default is `loading="lazy"` + `decoding="async"`.

## Consequences

- Easier: CMS-uploaded images get responsive `<picture>` markup and modern formats without any author action; the upload request stays fast regardless of image size; a corrupted/unsupported image degrades gracefully to serving the original instead of failing the upload.
- Harder / to watch: this async in-process design assumes a long-lived Node process (works with the `@astrojs/node` standalone adapter); a serverless deployment target would need a different strategy (e.g., queue + worker) and is called out as a caveat, not solved here. There is no regeneration/backfill CLI for images uploaded before this feature shipped — they will simply continue serving the original with no variants until re-uploaded or replaced (see ADR-0019). `reconcileMedia()` running on every `GET` (used by `handleGetMedia`, see ADR-0020) is a known future latency concern at scale, not addressed by this slice.

See ADR-0016 for the `ImageFieldValue` shape this renders from, and ADR-0019 for how "replace" triggers re-processing (`processing` → `ready`) while keeping the same URL.

## Evidence (current repo)

- `package.json` — `"sharp": "^0.35.1"` listed as a direct dependency.
- `utils/variant-generator.ts` — `generateAndPersistVariants()`: raster-only gate via `RASTER_MIME`, breakpoints `[480, 800, 1200, 1920]`, no-upscale check (`breakpointWidth >= originalWidth` → skip), dynamic `import('sharp')`, `markMediaVariantsReady`/`markMediaVariantsFailed`, try/catch that never rethrows.
- `utils/getMediaVariants.ts` — render-time lookup by URL with mtime-keyed cache; returns `{ status: 'none', variants: [] }` on any missing/unreadable/legacy case, never throws.
- `components/BlockImage.astro` — branches on `mv.status === 'ready' && mv.variants.length > 0` to choose `<picture>` vs plain `<img>`; `priority` prop controls `loading`/`decoding`/`fetchpriority`.
- Could not verify from static reading alone: actual runtime behavior under the `@astrojs/node` deploy target, or the absence of a queue/event-bus (the source's claim of "no formal event-bus" is consistent with the code — `generateAndPersistVariants` is called directly, not published to any broker — but this is an architectural absence, not something to positively assert beyond "no such mechanism was found").
