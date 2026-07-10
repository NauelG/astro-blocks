<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0016 — Image field value is a structured object (alt, dimensions, caption)

- **Status:** Draft — proposed (triaged from engram memory, awaiting review)
- **Date:** 2026-06-13
- **Source:** engram observation(s) #807, #809, #849

## Context

Before this decision, an image prop's value was a bare URL string end-to-end (block-form.ts, block-validation.ts STRING_LIKE_TYPES, the registry). That shape cannot carry accessibility or layout-stability data: there was nowhere to put `alt` text (WCAG 2.2 §1.1.1, Level A — an accessibility floor, not just an SEO nicety), nowhere to store `width`/`height` to prevent Cumulative Layout Shift, and no place for a per-use caption.

The non-obvious part is *where* each piece of data belongs. Naively, one might store everything on the media asset itself (the registry entry). That works for `alt` — an image usually has one sensible default description regardless of where it's used — but it breaks down for `caption`, which is contextual to the page/use ("this photo, in this article, means X") rather than intrinsic to the asset. Mirroring alt's model for caption would force every reuse of an image to share one caption, which is wrong. The change was accepted as a breaking contract change (string → object) because the media library was not yet published and had no external consumers to migrate.

## Decision

We will change the image field value contract from a bare URL string to a structured object:

```
ImageFieldValue = { url: string, alt?: string, caption?: string, width?: number, height?: number }
```

defined in `types/index.ts`. The model is deliberately **hybrid per field**:

- **`alt`** follows a hybrid default-plus-override model: the `MediaEntry` (registry) carries a default `alt` (editable on `/cms/media`), and `mediaEntryToImageValue()` snapshots it into the field value at pick time; the per-component value can then be overridden independently. Rationale: alt is intrinsic to the asset (has a sensible default) *and* contextual (a given use may need a different description).
- **`caption`** lives ONLY on `ImageFieldValue`, never on `MediaEntry`. There is no default, no PATCH endpoint, no grid editor for it. Rationale: a caption is inherently about how an image is used in a specific place, not a property of the asset.
- **`width`/`height`** are captured once at upload time and stored to eliminate CLS; they are optional and only rendered when they are positive, finite numbers.
- The `title` attribute was explicitly rejected: low accessibility value, no SEO value, and it is not exposed on touch devices.

Rendering (`components/BlockImage.astro`) wraps the image in `<figure class="cms-figure">` **only when a caption is present**; with no caption, it renders a plain `<img>`/`<picture>` exactly as before, preserving full backward compatibility. `class` and any other spread `...rest` attributes stay on the `<img>`/`<picture>` element, never migrate to the `<figure>`, so consumers styling the image directly are unaffected.

## Consequences

- Easier: components get accessible alt text and CLS-safe dimensions "for free" via `imageAttrs()`/`toImageValue()`; captions are supported without inventing new i18n or storage machinery (caption follows the same `localizable` flag as the rest of the image prop, since it lives inside `ImageFieldValue`).
- Harder / to watch: every legacy call site that produced or consumed a bare string had to be updated (`block-form.ts` in ~7 spots, `block-validation.ts`'s `STRING_LIKE_TYPES` hard-reject-of-objects check, `MediaEntry` normalization on load, `handleUpload`, and the playground `MediaShowcase.astro`). Backward compatibility for existing string values is preserved via coercion (`toImageValue`/`parseImageValue` treat a bare string as `{ url: string, alt: '' }`), not by keeping the old shape as a first-class type.
- Residual: caption is plain text only (no markdown/formatting) by decision; if richer captions are ever needed, that is a new, separate slice.

See ADR-0017 for how responsive variants are resolved on top of this same `ImageFieldValue` shape, and ADR-0019 for how the default `alt`/dimensions on `MediaEntry` interact with delete/replace.

## Evidence (current repo)

- `types/index.ts` — `ImageFieldValue` interface (`url`, `alt?`, `caption?`, `width?`, `height?`) and `MediaEntry` carrying `alt?`, `width?`, `height?` but no `caption` field.
- `utils/image-value.ts` — `toImageValue()` and `parseImageValue()` both coerce legacy bare strings to `{ url, alt: '' }` and normalize width/height to positive finite numbers only; `mediaEntryToImageValue()` explicitly excludes `caption` with the comment "caption is not included (no registry default; caption is per-component)"; `getCaption()` implements the override-then-stored-then-empty resolution order.
- `components/BlockImage.astro` — conditionally wraps in `<figure class="cms-figure">`/`<figcaption>` only when `getCaption()` is non-empty; `{...rest}` and computed attrs stay on `<img>`/`<picture>` in both branches; no `title` attribute is set anywhere in the component.
- `tests/media-alt-dimensions.test.js`, `tests/image-value.test.js` — present in `tests/`, exercising this contract.
