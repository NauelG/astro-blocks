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
  mimesForCategory,
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
 * What this field may UPLOAD: `def.accept ∩ global allowlist` (full allowlist when `def.accept` is
 * omitted). Drives the file input's `accept` attribute.
 *
 * Intersecting is correct HERE: offering to upload a type the server will reject is a lie. Note the
 * attribute remains a picker hint — the server is the gate (spec R7, R16).
 *
 * Delegates to intersectAccept() which normalises both sides to lowercase, so mixed-case schema
 * entries like `'Application/PDF'` are correctly matched against the lowercase global allowlist.
 *
 * `allowlist` is injectable for the same reason `catalog` is in file-catalog.ts: getGlobalAllowlist()
 * reads a build-time bake that node --test cannot set (#81).
 */
export function computeUploadAccept(
  def: PrimitivePropDef,
  allowlist: string[] = getGlobalAllowlist(),
): string[] {
  return intersectAccept(def.accept, allowlist);
}

/**
 * What this field may PICK from the library that already exists. Travels to the server as the
 * `?accept` query parameter, which filters the listing before it is sliced (ADR-0036).
 *
 * Deliberately NOT intersected with the allowlist — the opposite rule to computeUploadAccept, and
 * the distinction is the whole point of having two functions. The allowlist gates uploads; an asset
 * uploaded while a type was enabled stays selectable after that type is switched off, because
 * published pages may still reference it. Intersecting here made a STRICTER allowlist yield a MORE
 * permissive picker: the intersection went empty, and the picker's `length > 0` guard then disabled
 * filtering altogether.
 *
 * An empty result means "no type filter" — the whole library — which is what an unrestricted `file`
 * prop means. An `image` prop declares no `accept` (its type is the constraint), so its list comes
 * from the catalog's image rows.
 */
export function computeBrowseAccept(def: PrimitivePropDef, mode: 'image' | 'file'): string[] {
  if (def.accept && def.accept.length > 0) return def.accept.map((mime) => mime.toLowerCase());
  return mode === 'image' ? mimesForCategory('image') : [];
}
