/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/media-tile.ts
 *
 * How a media entry is drawn in the admin: which category it belongs to, and which icon
 * stands in for it when there is no thumbnail to show.
 *
 * This exists because the answer was previously written out three times — in `media.astro`,
 * in `client/media.ts` and in `client/block-form.ts` — as three slightly different ternaries.
 * The one in `block-form.ts` did not even consult `fileCategory`; it parsed the MIME string.
 * Three copies of a rule are three chances to disagree, and a video rendering as a PDF in one
 * of the three grids is exactly the drift this change exists to stop.
 *
 * DESIGN.md §1.13: "no crear estilos ad hoc para cada pantalla si pueden resolverse dentro
 * del sistema compartido".
 *
 * ── Why the icons are DATA and not markup ────────────────────────────────────────────────
 *
 * The obvious shape is a function returning an SVG string, rendered with `set:html` in the
 * .astro and interpolated into the template literal in the client renderers. It would be safe
 * here — the input is a three-member closed enum and the output is a compile-time constant.
 *
 * We do not do it, because it would be the repo's FIRST `set:html`, and ADR-0022's source
 * guard cannot see that shape: it lexes `<script>` blocks for innerHTML/outerHTML sinks. The
 * whole point of that ADR is that escaping is enforced by a guard rather than by the current
 * author being careful, and introducing a sink the guard is blind to — for three icons —
 * trades a structural guarantee for a comment.
 *
 * So the geometry lives once, as shapes. `media.astro` renders real elements from it (no HTML
 * sink at all); the string-building client renderers serialise it (and stay under R1/R3).
 */

import type { FileCategory } from '../types/index.js';
import { lookupByMime } from './file-catalog.js';

/** Categories that are drawn as an icon. An image is drawn as itself. */
export type IconCategory = Exclude<FileCategory, 'image'>;

/** One SVG primitive. A closed union: adding a shape means teaching both renderers about it. */
export type IconShape =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; points: string };

/** The minimum an entry must carry for us to draw it. */
interface TileEntry {
  mimeType: string;
  fileCategory?: string;
}

const VALID: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'document']);

/**
 * The category to draw this entry as.
 *
 * Prefers the stored `fileCategory`, which the backend declares from the catalog row at upload
 * time. Entries written before the field existed resolve through the catalog by MIME, and a
 * MIME with no row falls back to 'document' — the conservative tile.
 */
export function resolveTileCategory(entry: TileEntry): FileCategory {
  if (entry.fileCategory && VALID.has(entry.fileCategory)) {
    return entry.fileCategory as FileCategory;
  }
  return lookupByMime(entry.mimeType)?.category ?? 'document';
}

/** The icon geometry, at 24×24, stroked with `currentColor` by the surrounding tile. */
export const CATEGORY_ICON: Record<IconCategory, readonly IconShape[]> = {
  // Film frame with a play triangle. Reads as "video" at 28px, with no poster to show.
  video: [
    { kind: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
    { kind: 'path', d: 'M2 9h20' },
    { kind: 'path', d: 'M7 4v5' },
    { kind: 'path', d: 'M17 4v5' },
    { kind: 'path', d: 'M10 13l4 2.5-4 2.5z' },
  ],
  audio: [
    { kind: 'path', d: 'M9 18V6l10-2v12' },
    { kind: 'circle', cx: 6, cy: 18, r: 3 },
    { kind: 'circle', cx: 16, cy: 16, r: 3 },
  ],
  // The existing document icon, geometry unchanged — a page with lines.
  document: [
    { kind: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
    { kind: 'polyline', points: '14 2 14 8 20 8' },
    { kind: 'line', x1: 16, y1: 13, x2: 8, y2: 13 },
    { kind: 'line', x1: 16, y1: 17, x2: 8, y2: 17 },
    { kind: 'polyline', points: '10 9 9 9 8 9' },
  ],
};

/** The thumb modifier class. Layout is shared across categories; only the icon differs. */
export function categoryThumbClass(category: IconCategory): string {
  return `cms-media-card-thumb--${category === 'document' ? 'doc' : category}`;
}

/**
 * Serialise the icon to an SVG string, for the client renderers that build HTML as text.
 *
 * Every value interpolated here comes from CATEGORY_ICON — compile-time constants indexed by a
 * closed enum. No caller data reaches this string.
 */
export function categoryIconSvg(category: IconCategory): string {
  const body = CATEGORY_ICON[category]
    .map((s) => {
      switch (s.kind) {
        case 'path':
          return `<path d="${s.d}"/>`;
        case 'rect':
          return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.rx}"/>`;
        case 'circle':
          return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
        case 'line':
          return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`;
        case 'polyline':
          return `<polyline points="${s.points}"/>`;
      }
    })
    .join('');

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" class="cms-media-doc-icon">${body}</svg>`
  );
}
