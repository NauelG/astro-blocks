# Media — Roadmap & Backlog

Backlog of media-management improvements for the CMS, captured during the `media-library` work.
Ordered by SEO / accessibility / scale impact vs. effort. **Not yet committed to a slice** — to be
analyzed before implementation.

> Current slice in progress (separate SDD change): **`alt` text (hybrid model) + `width`/`height`**.
> See "Decided / in progress" at the bottom.

---

## High impact

### 1. Responsive image optimization (the big one)
Generate modern formats (`webp`/`avif`), multiple sizes, `srcset`, and `loading="lazy"` so the final
site ships optimized images. **Largest performance/SEO win** (Core Web Vitals: LCP).

- **Architectural note (important):** Astro's `astro:assets` / `<Image>` optimizes assets in `src/`
  at **build time**. CMS uploads land in `public/uploads` and are served as-is — `astro:assets` does
  **not** cover them. To optimize uploaded media we must **process on upload** (e.g. `sharp` to emit
  `webp` + generated thumbnails), or run a runtime image service. This is effectively a feature on its
  own and adds a dependency.
- Impact: SEO/perf **high**. Effort: **high**.

### 2. Store `width`/`height` in the registry → kill CLS
Persist intrinsic dimensions in each `MediaEntry` so the final `<img>` emits `width`/`height` →
eliminates **Cumulative Layout Shift** (a Core Web Vital). Quick win.

- Open question: how to read dimensions without a heavy dep — parse image header bytes, a micro lib
  like `image-size`, or have the browser send `naturalWidth/Height` at upload time.
- Impact: SEO **high**. Effort: **low–medium**. *(Bundled into the current slice.)*

---

## Medium impact

### 3. Library search + pagination
`loadMedia` currently loads the **entire** registry; the grid and the picker render everything. With
hundreds of images this does not scale. Add search (by filename/type/date) + pagination / lazy load
in both the `/cms/media` grid and the picker modal.

- Impact: scale/UX **medium**. Effort: **medium**.

### 4. "Where is this used?" before delete (referential integrity)
Before deleting an image, show where it is referenced (pages/components) so deleting can't silently
break published pages. Mature CMSs warn "used in 3 pages". Relates to the existing reconciliation.

- Impact: integrity **medium**. Effort: **medium–high** (requires scanning content for URL refs).

### 5. `caption` field (NOT `title`)
A visible caption below the image is genuinely useful for users and context. **Deliberately not
`title`**: the HTML `title` attribute is ignored/inconsistent in screen readers, invisible on touch,
and not used by Google for image understanding (Google uses `alt`). Skip `title`; consider `caption`.

- Impact: UX/content **low–medium**. Effort: **low**.

---

## Lower priority / nice-to-have

### 6. Replace file keeping the same URL/references
Swap the bytes behind an existing entry without changing its URL, so all references stay valid.

### 7. Folders / tags
Organize media into folders or tag-based groups for large libraries.

### 8. Focal point / crop
Store a focal point so responsive crops don't cut off the subject.

### 9. Visible EXIF / metadata
Surface dimensions, file weight, and basic EXIF in the library UI.

---

## Explicitly rejected (with reason)

- **`title` attribute on images** — low a11y value (screen readers ignore/inconsistent), no SEO value
  (Google uses `alt`), invisible on touch. Use `alt` (required) and optionally `caption`. See item 5.

---

## Decided / in progress

- **Slice now:** `alt` text + `width`/`height`.
  - `alt` model = **hybrid (C)**: a default `alt` stored on the media entry + a per-component override
    on each image field. Rationale: `alt` has two natures — intrinsic (what the photo shows, a sane
    default) and contextual (what it means on this page, what a11y/SEO reward).
  - **a11y driver:** `alt` is **WCAG 2.2 §1.1.1 Non-text Content, Level A** — not optional. SEO is the
    bonus, accessibility is the floor.
  - **Contract:** the image field value changes from a plain `string` (URL) to an object
    `{ url, alt?, width?, height? }`. The media library is **not yet published**, so this breaking
    change is acceptable — no published consumers to migrate. All internal call sites
    (`block-form.ts`, `block-validation.ts` `STRING_LIKE_TYPES`, the playground `MediaShowcase.astro`,
    validation) are updated together.
  - **Dimensions capture:** `image-size` (small, pure-JS dep) reads `width`/`height` on upload for all
    5 formats (SVG via viewBox).
  - **Hybrid model:** registry (`MediaEntry`) holds the default `alt` + `width`/`height`; the field
    value snapshots `{ url, alt, width, height }` at pick time (alt override editable per component).
