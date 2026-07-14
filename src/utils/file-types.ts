/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/file-types.ts
 *
 * Single source of truth for file-type constants used by the media subsystem.
 *
 * Exports:
 *   - DEFAULT_ALLOWED_FILE_TYPES : default MIME allowlist for uploads
 *   - RASTER_MIME                : Set of raster image MIMEs that go through sharp
 *   - DOCUMENT_MIME_TO_EXT       : extension map for document file types
 *   - MIME_TO_EXT                : merged extension map (images + documents)
 *
 * All values are read-only constants. Pure module — no side effects.
 */

/**
 * Default MIME-type allowlist for the upload endpoint.
 *
 * Binding decision D1: 6 entries exactly.
 * Named export per D2 so consumers can inspect or reference defaults without
 * constructing the plugin config.
 */
export const DEFAULT_ALLOWED_FILE_TYPES: string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'application/pdf',
];

/**
 * Set of raster image MIME types that are processed by sharp
 * (variant generation, imageSize, width/height extraction).
 *
 * Binding decision D4: raster-only positive check.
 * Any MIME not in this set skips sharp entirely (SVG, GIF, PDF, all documents).
 */
export const RASTER_MIME: Set<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Extension map for document (non-image) file types.
 * Separate from image extension map for clarity; merged into MIME_TO_EXT below.
 */
export const DOCUMENT_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
};

/**
 * Extension map for image MIME types.
 * Extension is always derived from the validated MIME type, never from the user filename.
 */
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

/**
 * Merged MIME-to-extension map covering both images and documents.
 * Use this map when deriving the stored file extension from the validated MIME type.
 */
export const MIME_TO_EXT: Record<string, string> = {
  ...IMAGE_MIME_TO_EXT,
  ...DOCUMENT_MIME_TO_EXT,
};

/**
 * Compute the intersection of a schema-defined accept list and a global allowlist.
 *
 * Both sides are normalised to lowercase before comparison so that a schema
 * entry like `'Application/PDF'` matches a lowercase allowlist entry like
 * `'application/pdf'`. The returned values are always lowercase.
 *
 * Behaviour:
 *   - `accept` omitted or empty  → returns the full `allowlist` unchanged
 *   - `accept` provided          → returns `accept` lowercased, keeping only
 *                                  entries that appear in `allowlist`
 *
 * @param accept    - MIME types from the schema prop definition (may be mixed-case)
 * @param allowlist - Global allowed MIME types (expected to be lowercase)
 */
export function intersectAccept(accept: string[] | undefined, allowlist: string[]): string[] {
  if (!accept || accept.length === 0) return allowlist;
  return accept.map((m) => m.toLowerCase()).filter((m) => allowlist.includes(m));
}
