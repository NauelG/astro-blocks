/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/getMediaVariants.ts
 *
 * Render-time accessor for responsive image variants.
 * Reads the consumer's data/media.json with an mtime-keyed in-memory cache so
 * repeated calls within a render cycle do not re-read disk.
 *
 * Graceful fallback contract:
 *   - Missing/unreadable registry  → { status: 'none', variants: [] }
 *   - URL not in registry          → { status: 'none', variants: [] }
 *   - Legacy entry (no status)     → { status: 'none', variants: [] }
 *   - Never throws into render
 *
 * Cache strategy:
 *   - Module-level singleton keyed by the file mtime.
 *   - On each call: stat the file. If mtime matches → reuse Map. Else reload.
 *   - Concurrency: the Node.js event loop is single-threaded; a redundant
 *     concurrent load is harmless (idempotent).
 */

import fs from 'node:fs/promises';
import { getDataPath } from './paths.js';
import { loadMedia } from '../api/data.js';
import type { MediaEntry, MediaVariant } from '../types/index.js';

export interface MediaVariantsResult {
  status: 'ready' | 'processing' | 'failed' | 'none';
  variants: MediaVariant[];
  width?: number;
  height?: number;
  alt?: string;
}

/** Module-level mtime-keyed cache. */
let cache: { mtimeMs: number; byUrl: Map<string, MediaEntry> } | null = null;

/**
 * Look up a MediaEntry by its original upload URL and return its variant info.
 * Reads data/media.json with mtime-keyed caching.
 *
 * Returns { status: 'none', variants: [] } on any error or when URL is unknown.
 * Never throws.
 */
export async function getMediaVariants(url: string): Promise<MediaVariantsResult> {
  const EMPTY: MediaVariantsResult = { status: 'none', variants: [] };

  try {
    const mediaJsonPath = getDataPath('media.json');

    // Stat the file to get current mtime
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(mediaJsonPath);
    } catch {
      // File does not exist or is unreadable — return graceful fallback
      return EMPTY;
    }

    const currentMtimeMs = stat.mtimeMs;

    // Rebuild cache if stale or absent
    if (cache === null || cache.mtimeMs !== currentMtimeMs) {
      const mediaData = await loadMedia();
      const byUrl = new Map<string, MediaEntry>();
      for (const entry of mediaData.uploads) {
        byUrl.set(entry.url, entry);
      }
      cache = { mtimeMs: currentMtimeMs, byUrl };
    }

    // Look up the entry
    const entry = cache.byUrl.get(url);
    if (!entry) {
      return EMPTY;
    }

    // Map entry fields to result
    // Entries without status (legacy) are treated as 'none' → plain <img>
    const status: MediaVariantsResult['status'] =
      entry.status === 'ready' || entry.status === 'processing' || entry.status === 'failed'
        ? entry.status
        : 'none';

    const result: MediaVariantsResult = {
      status,
      variants: entry.variants ?? [],
    };

    if (typeof entry.width === 'number') result.width = entry.width;
    if (typeof entry.height === 'number') result.height = entry.height;
    if (typeof entry.alt === 'string') result.alt = entry.alt;

    return result;
  } catch {
    // Any unexpected error → graceful fallback
    return EMPTY;
  }
}
