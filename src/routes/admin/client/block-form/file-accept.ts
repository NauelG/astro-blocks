/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * file-accept.ts — effective accept computation for 'file' block props
 * (schema accept ∩ global allowlist).
 */

import type { PrimitivePropDef } from '../../../../types/index.js';
import { readBakedConfig } from '../../../../utils/baked.js';
import {
  DEFAULT_ALLOWED_FILE_TYPES,
  decodeAllowlist,
  intersectAccept,
} from '../../../../utils/file-catalog.js';

// ─── Global allowlist (for file-prop effectiveAccept) ────────────────────────
// Read once at module load; falls back to DEFAULT_ALLOWED_FILE_TYPES when the
// vite.define env var is absent (e.g. no build or test context).
let _globalAllowlist: string[] | null = null;

export function getGlobalAllowlist(): string[] {
  if (_globalAllowlist) return _globalAllowlist;
  // Decoded through the same shared path (readBakedConfig + decodeAllowlist) the server uses, so the
  // picker no longer drifts from it and a malformed element is rejected rather than cast through
  // (#116, ADR-0033). baked.ts is browser-safe by construction. The resulting accept list is only a
  // picker hint; the server enforces the allowlist (an empty one rejects every upload there).
  _globalAllowlist = readBakedConfig('ASTRO_BLOCKS_ALLOWED_FILE_TYPES', {
    decode: decodeAllowlist,
    fallback: DEFAULT_ALLOWED_FILE_TYPES,
  });
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
