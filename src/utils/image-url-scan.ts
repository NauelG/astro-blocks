/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * image-url-scan.ts — Pure, schema-free URL walker for block props.
 *
 * Detects all references to a target URL within a block-props object using
 * EXACT VALUE EQUALITY only (never substring/includes). This prevents false
 * positives where an unrelated `.url` field happens to contain a similar path.
 *
 * Handles:
 *   S-A  Direct ImageFieldValue  { url: target }
 *   S-B  Localized image map     { es: { url: target }, en: { url: other } }
 *   S-C  Array of image items    [{ url: target }, { url: other }]
 *   S-D  Legacy bare string      prop = target
 *   S-E  Plain string in a map   { image: target }
 *   S-F  Localized string map    { image: { es: target, en: other } }
 *   S-G  False-positive guard    { url: other } → 0 matches
 *
 * NOTE on `page.seo.image`: this walker does NOT scan it. findMediaUsages (api/data.ts) checks that
 * field directly, because normalizePage has already reduced it to a locale map — a legacy bare
 * string on disk arrives here as { [locale]: string } via withLegacyLocale. S-E/S-F above describe
 * shapes found in BLOCK PROPS, not a seo path this module handles.
 */

export interface WalkerMatch {
  propName: string;
  shape: 'direct' | 'localizedMap' | 'arrayItem' | 'legacyString' | 'seoLocalizedMap';
}

/**
 * UsageRef describes a content location that references a given media URL.
 * Consumed by findMediaUsages in api/data.ts and returned by the usage endpoint.
 */
export interface UsageRef {
  /** Content source type */
  source: 'page' | 'globalBlock' | 'seo';
  /** page.id, globalBlock slug, or page.id (for seo) */
  id: string;
  /** Human-readable label */
  label: string;
  /** Block index within page.blocks (page source only) */
  blockIndex?: number;
  /** Matched prop key (or 'seo.image' for seo source) */
  propName?: string;
}

const MAX_DEPTH = 4;

/**
 * Inspect a single value at a given depth.
 * Returns the list of shape hits found. propName is filled by the caller.
 */
function matchValue(
  value: unknown,
  targetUrl: string,
  depth: number,
): Array<{ shape: WalkerMatch['shape'] }> {
  if (depth > MAX_DEPTH) return [];

  // S-D / S-E: bare string equality
  if (typeof value === 'string') {
    if (value === targetUrl) {
      return [{ shape: 'legacyString' }];
    }
    return [];
  }

  // Arrays: walk each item
  if (Array.isArray(value)) {
    const hits: Array<{ shape: WalkerMatch['shape'] }> = [];
    for (const item of value) {
      if (typeof item === 'string') {
        if (item === targetUrl) hits.push({ shape: 'arrayItem' });
      } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.url === 'string') {
          // Direct ImageFieldValue in array
          if (obj.url === targetUrl) hits.push({ shape: 'arrayItem' });
        } else {
          // ObjectArrayItem — recurse into its values (one level)
          const subHits = walkObject(obj, targetUrl, depth + 1);
          // Flatten sub-hits: they are children of this array item → report as arrayItem shape
          for (const _hit of subHits) {
            hits.push({ shape: 'arrayItem' });
          }
        }
      }
    }
    return hits;
  }

  // Non-null, non-array object
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // S-A: Direct ImageFieldValue — has a string .url key
    if (typeof obj.url === 'string') {
      // Equality guard — NEVER substring
      if (obj.url === targetUrl) return [{ shape: 'direct' }];
      // url present but different — do NOT recurse further into this object
      // (alt, caption are not uploads paths; recursing risks false positives)
      return [];
    }

    // S-B / S-F: no .url key → treat as localized map or nested plain object
    // Check if ALL values are primitives (string/bool/number) → localized string map
    // Check if values contain { url } objects → localized image map
    const entries = Object.entries(obj);
    if (entries.length === 0) return [];

    // Determine shape: if any value is a string, treat as localized STRING map (S-F)
    const hasStringValues = entries.some(([, v]) => typeof v === 'string');
    const hasObjectValues = entries.some(
      ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
    );

    if (hasStringValues && !hasObjectValues) {
      // Localized string map: { es: '/uploads/...', en: '/uploads/...' }
      const hits: Array<{ shape: WalkerMatch['shape'] }> = [];
      for (const [, v] of entries) {
        if (typeof v === 'string' && v === targetUrl) {
          hits.push({ shape: 'seoLocalizedMap' });
        }
      }
      return hits;
    }

    if (hasObjectValues) {
      // Could be localized ImageFieldValue map { es: { url: ... }, en: { url: ... } }
      // or a nested object with sub-keys — recurse
      const hits: Array<{ shape: WalkerMatch['shape'] }> = [];
      for (const [, v] of entries) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          const nested = v as Record<string, unknown>;
          if (typeof nested.url === 'string') {
            // Localized ImageFieldValue map entry
            if (nested.url === targetUrl) hits.push({ shape: 'localizedMap' });
          } else {
            // Plain nested object — recurse (depth-guarded)
            const subHits = walkObject(nested, targetUrl, depth + 1);
            hits.push(...subHits.map((h) => ({ shape: h.shape })));
          }
        } else if (typeof v === 'string' && v === targetUrl) {
          hits.push({ shape: 'seoLocalizedMap' });
        }
      }
      return hits;
    }

    return [];
  }

  return [];
}

/**
 * Walk a props object one level (top-level keys), collecting all matches.
 * Returns matches with propName filled.
 */
function walkObject(
  props: Record<string, unknown>,
  targetUrl: string,
  depth: number,
): WalkerMatch[] {
  const results: WalkerMatch[] = [];
  for (const [key, value] of Object.entries(props)) {
    const hits = matchValue(value, targetUrl, depth);
    for (const hit of hits) {
      results.push({ propName: key, shape: hit.shape });
    }
  }
  return results;
}

/**
 * Scan a block-props object for all references to `targetUrl`.
 * Returns one WalkerMatch per reference found (multiple matches possible if
 * the same URL appears in multiple props or multiple array items).
 *
 * EQUALITY ONLY — never substring. This is the data-loss acceptance gate.
 */
export function scanPropsForUrl(props: Record<string, unknown>, targetUrl: string): WalkerMatch[] {
  return walkObject(props, targetUrl, 0);
}

/**
 * Alias used by the data layer (api/data.ts).
 * Same function, named to clarify caller intent.
 */
export function findUrlRefsInProps(
  props: Record<string, unknown>,
  targetUrl: string,
): { propName: string }[] {
  return scanPropsForUrl(props, targetUrl);
}
