/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/variant-generator.ts
 *
 * Asynchronous variant generation pipeline.
 * Called from handleUpload as fire-and-forget; exported for direct testing.
 *
 * Contract:
 *   - Only raster types (image/jpeg, image/png, image/webp) go through sharp.
 *   - All other types (SVG, GIF, PDF, any non-raster) → markMediaVariantsReady(id, []) and return.
 *   - Raster: import('sharp') dynamically → resize per breakpoint (no-upscale) → toFormat(webp|avif) → write file
 *   - On success → markMediaVariantsReady(id, variants)
 *   - On ANY error (import, fs, encode) → markMediaVariantsFailed(id), never rethrow
 */

import fs from 'node:fs/promises';
import { resolveUploadPath, buildVariantFilename, variantUrlFor } from './paths.js';
import * as data from '../api/data.js';
import { RASTER_MIME } from './file-types.js';
import type { MediaEntry, MediaVariant } from '../types/index.js';

/** Breakpoints in pixels for variant generation. */
const BREAKPOINTS = [480, 800, 1200, 1920] as const;

/**
 * Generate WebP and AVIF variants at each configured breakpoint (no-upscale)
 * for the given MediaEntry, then persist results via data mutations.
 *
 * Only raster MIME types (jpeg/png/webp) trigger sharp processing.
 * All other types — SVG, GIF, PDF, and any future document types — receive
 * status:'ready' with an empty variants array without invoking sharp.
 *
 * Fire-and-forget safe: never throws; always resolves.
 */
export async function generateAndPersistVariants(entry: MediaEntry): Promise<void> {
  // Non-raster types skip processing — mark ready with empty variants.
  // This covers SVG, GIF, PDF, and any other non-raster file.
  if (!RASTER_MIME.has(entry.mimeType)) {
    await data.markMediaVariantsReady(entry.id, []);
    return;
  }

  try {
    // Resolve the original file path
    const originalPath = resolveUploadPath(entry.url);
    if (!originalPath) {
      await data.markMediaVariantsFailed(entry.id);
      return;
    }

    // Dynamic import of sharp so a missing native binary is a caught error, not a load crash
    const sharp = (await import('sharp')).default;

    // Read the original buffer once
    const originalBuffer = await fs.readFile(originalPath);

    // Probe the original dimensions
    const metadata = await sharp(originalBuffer).metadata();
    const originalWidth = metadata.width ?? 0;

    const variants: MediaVariant[] = [];
    const formats = ['webp', 'avif'] as const;

    for (const breakpointWidth of BREAKPOINTS) {
      // No-upscale: only generate variants for widths STRICTLY less than original
      if (breakpointWidth >= originalWidth) continue;

      for (const format of formats) {
        // Build the variant filename and path
        const originalFilename = entry.url.split('/').pop() ?? entry.filename;
        const variantFilename = buildVariantFilename(originalFilename, breakpointWidth, format);
        const variantDir = originalPath.slice(0, originalPath.lastIndexOf('/'));
        const variantPath = `${variantDir}/${variantFilename}`;

        await sharp(originalBuffer)
          .resize({ width: breakpointWidth, withoutEnlargement: true })
          .toFormat(format)
          .toFile(variantPath);

        const variantUrl = variantUrlFor(entry.url, breakpointWidth, format);
        variants.push({ format, width: breakpointWidth, url: variantUrl });
      }
    }

    await data.markMediaVariantsReady(entry.id, variants);
  } catch {
    // Any error in import, fs, or encode → failed status; never rethrow
    await data.markMediaVariantsFailed(entry.id);
  }
}
