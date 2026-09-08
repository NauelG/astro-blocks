/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/getMediaVariants.ts
 *
 * Render-time accessor for responsive image variants.
 * Reads the consumer's data/media.json with an in-memory cache keyed off the
 * file's identity, so repeated calls within a render cycle do not re-read disk.
 *
 * Graceful fallback contract:
 *   - Missing/unreadable registry  → { status: 'none', variants: [] }
 *   - URL not in registry          → { status: 'none', variants: [] }
 *   - Legacy entry (no status)     → { status: 'none', variants: [] }
 *   - Never throws into render
 *
 * Cache strategy (see ADR-0042 — supersedes the mtime-only description in
 * ADR-0017):
 *   - `mtimeMs` alone is NOT a reliable change signal: sampled writes on this
 *     repo's dev/CI filesystems (tmpfs, ext4) collapse onto the same
 *     millisecond routinely, and even nanosecond resolution
 *     (`fs.stat(..., { bigint: true }).mtimeNs`) still collides on back-to-back
 *     writes ~90% of the time — the underlying clock source `stat` reads is
 *     coarser than the nanosecond field suggests.
 *   - `data.ts#writeJson` — the sole writer of every store file, media.json
 *     included — writes to a fresh randomly-named temp file and `fs.rename`s
 *     it over the target. That rename always allocates a NEW inode number for
 *     the target path; the previous inode is freed. Measured across 500
 *     back-to-back writes with no delay, `ino` never repeated once.
 *   - The cache key is therefore the triple `(ino, size, mtimeNs)`: `ino`
 *     does the real work for every write that goes through `writeJson`;
 *     `size`/`mtimeNs` are cheap belt-and-braces for the one write path in
 *     this codebase that does NOT go through it (direct `fs.writeFile`
 *     in-place, used only by test fixtures).
 *   - On each call: stat the file (`{ bigint: true }`). If the key matches →
 *     reuse the Map. Else reload.
 *   - Concurrency: the Node.js event loop is single-threaded; a redundant
 *     concurrent load is harmless (idempotent).
 */

import fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
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

/** Module-level cache keyed off the registry file's identity (see comment above). */
let cache: { key: string; byUrl: Map<string, MediaEntry> } | null = null;

/**
 * Look up a MediaEntry by its original upload URL and return its variant info.
 * Reads data/media.json with identity-keyed caching (see module doc above).
 *
 * Returns { status: 'none', variants: [] } on any error or when URL is unknown.
 * Never throws.
 */
export async function getMediaVariants(url: string): Promise<MediaVariantsResult> {
  const EMPTY: MediaVariantsResult = { status: 'none', variants: [] };

  try {
    const mediaJsonPath = getDataPath('media.json');

    // Stat the file (bigint form: nanosecond mtime + full-precision ino/size)
    // to build the current identity key.
    let stat: BigIntStats;
    try {
      stat = await fs.stat(mediaJsonPath, { bigint: true });
    } catch {
      // File does not exist or is unreadable — return graceful fallback
      return EMPTY;
    }

    const currentKey = `${stat.ino}:${stat.size}:${stat.mtimeNs}`;

    // Rebuild cache if stale or absent
    if (cache === null || cache.key !== currentKey) {
      const mediaData = await loadMedia();
      const byUrl = new Map<string, MediaEntry>();
      for (const entry of mediaData.uploads) {
        byUrl.set(entry.url, entry);
      }
      cache = { key: currentKey, byUrl };
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
