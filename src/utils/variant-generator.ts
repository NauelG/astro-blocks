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
import { isRaster } from './file-catalog.js';
import type { MediaEntry, MediaVariant } from '../types/index.js';

/** Breakpoints in pixels for variant generation. */
const BREAKPOINTS = [480, 800, 1200, 1920] as const;

/**
 * Generate WebP and AVIF variants at each configured breakpoint (no-upscale)
 * for the given MediaEntry, then persist results via data mutations.
 *
 * Only rows the catalog marks `raster: true` (jpeg/png/webp) trigger sharp processing.
 * Everything else — SVG, GIF, AVIF, PDF, video, audio — receives status:'ready' with an
 * empty variants array without invoking sharp.
 *
 * Fire-and-forget safe: never throws; always resolves.
 */
export async function generateAndPersistVariants(entry: MediaEntry): Promise<void> {
  // Non-raster types skip processing — mark ready with empty variants.
  // The answer comes from the catalog row, not from a set kept in parallel with it.
  if (!isRaster(entry.mimeType)) {
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

// In-flight variant jobs spawned fire-and-forget from the media handlers. The
// job resolves the store path lazily at write time, so one that outlives its
// caller writes to whatever process.cwd() resolves to then (see #96). Tracking
// the promises lets a test drain them before it tears down the temp project.
const pendingVariantJobs = new Set<Promise<void>>();

/**
 * Spawn variant generation as fire-and-forget (production behaviour) while
 * registering the promise so tests can await completion via drainVariantJobs.
 * Never throws; the job's own error handling marks the entry failed.
 */
export function spawnVariantGeneration(entry: MediaEntry): void {
  const job = generateAndPersistVariants(entry).catch(() => {});
  pendingVariantJobs.add(job);
  void job.finally(() => pendingVariantJobs.delete(job));
}

/**
 * Await every variant job spawned so far. Loops because draining is only
 * meaningful before teardown, and a settling job could still be registered.
 * Tests call this in withTempProject's teardown, before the temp root is
 * removed and ASTRO_BLOCKS_PROJECT_ROOT is unset.
 */
export async function drainVariantJobs(): Promise<void> {
  while (pendingVariantJobs.size > 0) {
    await Promise.all([...pendingVariantJobs]);
  }
}
