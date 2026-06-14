<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Media management

AstroBlocks ships a complete image pipeline: a media library in the admin, an image field picker in the block editor, and a render component that serves optimized responsive images automatically. You upload an image once; AstroBlocks captures its dimensions, generates WebP/AVIF variants in the background, and serves the best format the browser supports — with no extra work in your block components.

This guide has two audiences:

- [For CMS editors](#for-cms-editors) — how to use the media library and the image field in the admin.
- [For developers](#for-developers) — how to render image fields, the data shapes, the API, and configuration.

If you only need the short version, see the [Media Library and Responsive Images](../README.md#media-library-and-responsive-images) section in the README.

---

## Concepts (read this first)

These three ideas explain how the whole pipeline behaves. Everything else follows from them.

| Concept | What it means |
| --- | --- |
| **Original is the source of truth** | The file you upload is never modified or deleted by the pipeline. It is always kept on disk and always served as the `<img>` fallback, even if variant generation fails. |
| **Variants are a regenerable cache** | The WebP/AVIF responsive variants are derived artifacts. They can be deleted and regenerated from the original at any time without losing anything. |
| **Replace keeps the URL** | Replacing a file (same MIME type) overwrites the bytes in place, so the URL stays identical. Every page that references that image updates at once — no need to re-pick it anywhere. |

Two more rules worth knowing:

- **alt vs. caption.** `alt` is alternative text for screen readers and SEO (WCAG 1.1.1) — it describes the image and is required for meaningful images. `caption` is a visible `<figcaption>` shown under the image. They are independent: an image can have alt without a caption, or both.
- **Where-used is warn-and-allow.** Deleting or replacing an image that is referenced by pages shows you a warning with the list of usages, but never blocks the action. You stay in control.

---

## For CMS editors

### The media library (`/cms/media`)

![The /cms/media library: upload area, image grid with metadata, search and pagination](../img/media-library.png)

The media library is where every uploaded asset lives. From there you can:

| Action | How |
| --- | --- |
| **Upload** | Drag-and-drop or click to select. Accepts JPEG, PNG, WebP, SVG, GIF up to 5 MB (configurable). |
| **Search** | Type in the search box to filter by filename. |
| **Paginate** | Use Prev / Next to move through pages (24 per page by default). |
| **See metadata** | Each tile shows filename, dimensions, size, and processing status. |
| **Set default alt** | Edit the alt text inline. This becomes the default alt whenever the image is picked in a block. |
| **Replace a file** | Upload a new file over an existing one. It must be the **same file type**. The URL stays the same, so every page using that image updates at once. |
| **Delete** | Removes the original, all responsive variants, and the registry entry. If the image is used on any page, you see a where-used warning first — but you can still proceed. |

### The image field picker (in the block editor)

![The image field picker: searchable grid plus alt and caption inputs](../img/image-picker.png)

When a block has an `image` field, the page editor shows a picker. From it you can:

- **Choose** an image from the library (searchable, paginated, with a load-more control).
- **Replace** the currently selected image with a different one.
- **Clear** the selection.
- Set a **per-component alt** and a **per-component caption** for this specific placement.

The per-component alt overrides the library default for this block only. The caption is always per-component — there is no library-wide caption.

### What alt and caption do

- **alt** — describes the image for screen readers and search engines. Required for meaningful images; leave empty (`alt=""`) only for purely decorative images. The picker pre-fills it with the library default; you can override it here.
- **caption** — a visible text shown directly under the image as a `<figcaption>`. Set it only when you want a visible caption.

### Responsive images happen automatically

You do not configure anything. When you upload a raster image (JPEG, PNG, WebP):

1. The upload completes immediately and the tile shows **processing**.
2. In the background, AstroBlocks generates optimized WebP and AVIF versions at several sizes.
3. The status flips to **ready**.

On the public site, the browser is automatically served the smallest, most modern format it supports (AVIF, then WebP, then the original). The original is always available as a fallback, so the image is never broken — even while still processing or if generation fails.

SVG files are served as-is (no rasterization).

---

## For developers

### Quick start: render an image field

Use the `<BlockImage>` component. It is the single render seam for image fields — it handles responsive `<picture>`/srcset, the `<figure>`/`<figcaption>` wrapper, alt, dimensions, and lazy loading for you.

```astro
---
import BlockImage from '@astroblocks/astro-blocks/components/BlockImage';

const { image } = Astro.props; // image: ImageFieldValue
---

<!-- Default: lazy loading, 100vw sizing -->
<BlockImage image={image} />

<!-- Hero / LCP image: eager + fetchpriority=high -->
<BlockImage image={heroImage} priority={true} />

<!-- Grid layout: custom sizes + a CSS class -->
<BlockImage
  image={galleryImage}
  sizes="(max-width: 640px) 100vw, 50vw"
  class="card-image"
/>
```

That is all most consumers ever need. The rest of this section is reference.

### The `ImageFieldValue` shape

This is the value stored for an `image` block field and passed to `<BlockImage image={...}>`.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `url` | `string` | yes | Path to the original upload (e.g. `/uploads/2026/06/abcd-photo.jpg`) |
| `alt` | `string` | no | Alternative text (per-component override of the library default) |
| `caption` | `string` | no | Visible `<figcaption>` text — when present, the image is wrapped in `<figure>` |
| `width` | `number` | no | Original pixel width (captured at upload — used to prevent CLS) |
| `height` | `number` | no | Original pixel height (captured at upload) |

```ts
import type { ImageFieldValue } from '@astroblocks/astro-blocks/contract';
```

> **Legacy strings are coerced.** A bare string URL is automatically converted to `{ url, alt: '' }`, so older content keeps working without migration.

### `<BlockImage>` props

```ts
import BlockImage from '@astroblocks/astro-blocks/components/BlockImage';
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `image` | `ImageFieldValue \| string` | required | Image field value (or a legacy URL string, coerced automatically) |
| `sizes` | `string` | `'100vw'` | Value for the `sizes` attribute on the `<source>` elements |
| `priority` | `boolean` | `false` | When `true`: `loading="eager"` + `fetchpriority="high"`. Use for LCP/hero images |
| `caption` | `string` | — | Explicit caption override (takes precedence over `image.caption`) |
| `class`, `...rest` | any | — | Any extra HTML `img` attributes are spread onto the `<img>` |

### What `<BlockImage>` emits

**When variants are ready** (`status: 'ready'` and at least one variant exists):

```html
<picture>
  <source type="image/avif" srcset="…-480.avif 480w, …-800.avif 800w" sizes="100vw" />
  <source type="image/webp" srcset="…-480.webp 480w, …-800.webp 800w" sizes="100vw" />
  <img src="/uploads/2026/06/original.jpg" alt="…" width="1920" height="1080"
       loading="lazy" decoding="async" />
</picture>
```

**In every other state** (processing, failed, no variants, legacy value, or SVG) it emits a plain `<img>` with the same attributes — so the page is never broken (graceful degradation).

**When a caption is present**, the output above is wrapped in a figure:

```html
<figure class="cms-figure">
  <!-- <picture> or <img> as above -->
  <figcaption>Your caption text</figcaption>
</figure>
```

Rendering guarantees:

- `alt` is **always present**, even when empty (`alt=""`) — WCAG 1.1.1.
- `width`/`height` are emitted when captured, to reserve layout space and avoid CLS.
- `priority={false}` → `loading="lazy"` + `decoding="async"`; `priority={true}` → `loading="eager"` + `fetchpriority="high"`.

### The `getMediaVariants` helper

For advanced cases where you need variant data directly (custom rendering, debugging):

```ts
import { getMediaVariants } from '@astroblocks/astro-blocks/getMediaVariants';

const mv = await getMediaVariants('/uploads/2026/06/my-image.jpg');
// mv.status   → 'ready' | 'processing' | 'failed' | 'none'
// mv.variants → [{ format: 'webp', width: 480, url: '…' }, …]
// mv.width    → original width (when captured)
// mv.height   → original height (when captured)
// mv.alt      → default alt text from the registry
```

It reads `data/media.json` with an mtime-keyed in-memory cache, so repeated calls within a render cycle do not re-read disk. It returns `{ status: 'none', variants: [] }` gracefully when the registry is missing (SSG build safety) — it never throws.

### How responsive variants are generated

When a raster image (JPEG, PNG, WebP) is uploaded, AstroBlocks generates WebP and AVIF variants at these breakpoints — but **only when the breakpoint is strictly smaller than the original width** (no upscaling):

| Breakpoint | Generated when |
| --- | --- |
| 480 px | original width > 480 |
| 800 px | original width > 800 |
| 1200 px | original width > 1200 |
| 1920 px | original width > 1920 |

Generation is **asynchronous**: the upload response returns immediately with `status: 'processing'`. The status becomes `'ready'` when all variants are written, or `'failed'` on any error. The original is always retained and served as the fallback regardless of outcome. SVG entries get `status: 'ready'` with no variants.

> **Serverless caveat.** Variant generation runs in-process after the upload response returns. On serverless targets the process may freeze before generation completes. `@astrojs/node` standalone is the supported deployment target for variant generation. Generation uses `sharp` (a transitive dependency of Astro), loaded via dynamic import; if it is unavailable the entry becomes `status: 'failed'` and the original still works.

### Where files live

| Path | Purpose |
| --- | --- |
| `public/uploads/YYYY/MM/` | Original uploads and their generated variants, bucketed by year/month |
| `data/media.json` | The media registry — one `MediaEntry` per upload (see below) |

The plugin injects a file-serving route at `/uploads/[...path]`. Do **not** create `src/pages/uploads/` in your project. Commit `public/uploads/` and `data/media.json` if you want uploads to persist in your repository.

### The `MediaEntry` shape (`data/media.json`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique entry id |
| `url` | `string` | Public path to the original (e.g. `/uploads/2026/06/abcd-photo.jpg`) |
| `filename` | `string` | Original filename as uploaded |
| `size` | `number` | File size in bytes |
| `mimeType` | `string` | Validated MIME type |
| `createdAt` | `string` | ISO timestamp |
| `alt` | `string?` | Default alt text (editable inline on `/cms/media`) |
| `width` | `number?` | Pixel width captured at upload |
| `height` | `number?` | Pixel height captured at upload |
| `variants` | `MediaVariant[]?` | Generated responsive variants: `{ format: 'webp' \| 'avif', width, url }` |
| `status` | `'processing' \| 'ready' \| 'failed'?` | Variant generation status |

### API endpoints

All endpoints live under `/cms/api/` and require authentication (a valid CMS session token).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/cms/api/media?q=&page=&limit=` | List media. `q` filters by filename; `page` (default 1); `limit` (default 24, max 100). Returns `{ uploads, total, page, limit }`, newest first. |
| `POST` | `/cms/api/upload` | Upload a file (`multipart/form-data`, field `file`). Returns `{ url, entry }` with `status: 'processing'`. |
| `DELETE` | `/cms/api/upload` | Delete by `{ url }` (JSON body). Removes original, variants, and registry entry. Idempotent. |
| `PATCH` | `/cms/api/media/:id` | Update default alt text. Body `{ alt: string }`. Returns `{ entry }`. |
| `GET` | `/cms/api/media/:id/usage` | Where-used scan. Returns `{ count, usages[] }`. |
| `POST` | `/cms/api/media/:id/replace` | Replace bytes in place (`multipart/form-data`, field `file`). Must be the **same MIME type**. Keeps the URL; returns `{ entry }` with `status: 'processing'`. |

Uploads are validated **before** any disk write: the MIME type must be in the allowlist (`image/jpeg`, `image/png`, `image/webp`, `image/svg+xml`, `image/gif`) and the size must be within the limit. The stored file extension is derived from the validated MIME type, never from the user-supplied filename (this prevents an SVG-as-JPG stored-XSS bypass). SVG files are served with `Content-Disposition: attachment` to neutralize inline script execution.

### Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` | `5242880` (5 MB) | Maximum accepted upload size, in bytes. Set as an environment variable. |

---

## Limitations and future work

These are known boundaries of the current implementation, not bugs:

- **EXIF is not extracted.** Only pixel dimensions are captured at upload (via `image-size`). Real EXIF metadata extraction (camera, orientation, GPS) is deferred.
- **Reconciliation runs on every media GET.** Listing media reconciles the registry against disk on each `GET /cms/api/media`. This keeps the registry honest but adds latency as the library grows — a scaling consideration for very large media sets.
- **No folders or tags yet.** Media is a single flat, searchable list. Organizing assets into folders or tagging them is not implemented.
- **No focal point / crop.** There is no UI to set a focal point or crop region; variants are width-resized from the full original.
- **Admin UI language.** The CMS admin currently mixes languages in places (navigation vs. content). Full UI i18n is not yet settled.

---

## Related docs

- [README — Media Library and Responsive Images](../README.md#media-library-and-responsive-images) — the short overview.
- [AGENTS.consumer.md](../AGENTS.consumer.md) — AI-context reference for `BlockImage`, `getMediaVariants`, and the data model.
- [DEVELOPING.md](../DEVELOPING.md) — playground setup and the `/cms/media` manual test checklist.
