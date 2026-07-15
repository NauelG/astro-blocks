/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * file-accept.ts — effective accept computation for 'file' block props
 * (schema accept ∩ global allowlist).
 */

import type { PrimitivePropDef } from '../../../../types/index.js';
import { DEFAULT_ALLOWED_FILE_TYPES, intersectAccept } from '../../../../utils/file-catalog.js';

// ─── Global allowlist (for file-prop effectiveAccept) ────────────────────────
// Read once at module load; falls back to DEFAULT_ALLOWED_FILE_TYPES when the
// vite.define env var is absent (e.g. no build or test context).
let _globalAllowlist: string[] | null = null;

export function getGlobalAllowlist(): string[] {
  if (_globalAllowlist) return _globalAllowlist;
  // import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES is injected by vite.define at build time.
  // Casting through unknown avoids TS complaints about the ImportMeta type not having
  // an index signature — this is safe because vite.define replaces the literal at build time.
  const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
  const raw: string = (metaEnv.ASTRO_BLOCKS_ALLOWED_FILE_TYPES as string) ?? '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        _globalAllowlist = parsed as string[];
        return _globalAllowlist;
      }
    } catch {
      /* ignore */
    }
  }
  _globalAllowlist = DEFAULT_ALLOWED_FILE_TYPES;
  return _globalAllowlist;
}

/**
 * Compute the effectiveAccept for a file field:
 *   - If def.accept is provided: intersection with global allowlist (warn-and-drop per ADR-6)
 *   - If def.accept is omitted: full global allowlist
 *
 * Delegates to intersectAccept() which normalises both sides to lowercase, so
 * mixed-case schema entries like `'Application/PDF'` are correctly matched
 * against the lowercase global allowlist. The returned values are always
 * lowercase, ensuring consistent comparison in renderPickerGrid and in the
 * data-file-accept attribute.
 */
export function computeEffectiveAccept(def: PrimitivePropDef): string[] {
  return intersectAccept(def.accept, getGlobalAllowlist());
}
