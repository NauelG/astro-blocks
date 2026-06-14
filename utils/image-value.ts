/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/image-value.ts
 *
 * Pure helpers for the ImageFieldValue contract:
 *   - toImageValue     : coerce any unknown input to a valid ImageFieldValue
 *   - parseImageValue  : deserialize the hidden-input JSON (handles legacy bare URLs)
 *   - imageAttrs       : map ImageFieldValue → plain attrs object for <img> rendering
 *   - isEmptyImageValue: detect an "empty / no value" ImageFieldValue
 *   - mediaEntryToImageValue: project a MediaEntry → ImageFieldValue snapshot (at pick time)
 *
 * All functions are deterministic and side-effect-free — safe to use in tests, UI,
 * server handlers, and Astro component frontmatter.
 */

import type { ImageFieldValue, MediaEntry, MediaVariant } from '../types/index.js';

/** Sentinel returned for null / undefined / malformed input. */
const EMPTY: ImageFieldValue = { url: '', alt: '' };

/**
 * Coerce any unknown value to a valid ImageFieldValue.
 *
 * Coercion rules (see spec REQ-1):
 *   - Already-conforming object → returned as-is
 *   - Non-empty string           → { url: string, alt: '' }
 *   - Empty string / null / undefined / everything else → EMPTY sentinel { url: '', alt: '' }
 */
export function toImageValue(value: unknown): ImageFieldValue {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === 'string') {
      // Valid object shape — return with normalized optional fields
      return {
        url: obj.url,
        ...(typeof obj.alt === 'string' && { alt: obj.alt }),
        ...(typeof obj.caption === 'string' && { caption: obj.caption }),
        ...(typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0 && { width: obj.width }),
        ...(typeof obj.height === 'number' && Number.isFinite(obj.height) && obj.height > 0 && { height: obj.height }),
      };
    }
    return { ...EMPTY };
  }

  if (typeof value === 'string' && value.length > 0) {
    // Legacy plain-string URL → coerce
    return { url: value, alt: '' };
  }

  return { ...EMPTY };
}

/**
 * Deserialize the hidden input value for an image field.
 *
 * The hidden input holds either:
 *   a) A JSON-serialized ImageFieldValue (new format)
 *   b) A legacy bare URL string (before this change)
 *   c) An empty string (no image selected)
 *
 * Returns a valid ImageFieldValue in all cases — never throws.
 */
export function parseImageValue(raw: string): ImageFieldValue {
  if (!raw || raw.trim() === '') {
    return { url: '' };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).url === 'string'
      ) {
        const obj = parsed as Record<string, unknown>;
        return {
          url: obj.url as string,
          ...(typeof obj.alt === 'string' && { alt: obj.alt }),
          ...(typeof obj.caption === 'string' && { caption: obj.caption }),
          // Coerce width/height to positive finite numbers or drop them (0 and negatives are invalid)
          ...(typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0 && { width: obj.width }),
          ...(typeof obj.height === 'number' && Number.isFinite(obj.height) && obj.height > 0 && { height: obj.height }),
        };
      }
    } catch {
      // Malformed JSON → fall through to sentinel
    }
    return { url: '' };
  }

  // Legacy bare URL string → coerce
  return { url: trimmed };
}

/**
 * Map an ImageFieldValue to a plain attributes object suitable for rendering
 * an <img> element (Astro omits undefined attrs natively).
 *
 * Rules:
 *   - `src`  always set to value.url
 *   - `alt`  always present (empty string for decorative images — WCAG 1.1.1)
 *   - `width`  set only when value.width is a positive integer
 *   - `height` set only when value.height is a positive integer
 */
export function imageAttrs(value: ImageFieldValue): {
  src: string;
  alt: string;
  width?: number;
  height?: number;
} {
  const alt = value.alt ?? '';
  const result: { src: string; alt: string; width?: number; height?: number } = {
    src: value.url,
    alt,
  };

  if (typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0) {
    result.width = Math.floor(value.width);
  }
  if (typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0) {
    result.height = Math.floor(value.height);
  }

  return result;
}

/**
 * Return true when the ImageFieldValue represents "no image selected".
 *
 * An empty value is:
 *   - null / undefined
 *   - not an object (e.g. a raw string — not a valid ImageFieldValue)
 *   - an object where url is absent or empty string
 */
export function isEmptyImageValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  return typeof obj.url !== 'string' || obj.url === '';
}

/**
 * Serialize an ImageFieldValue into a string that is safe to embed in an HTML
 * `value="..."` attribute (i.e. inside double-quote delimiters).
 *
 * The function JSON.stringify the value and then HTML-entity-escapes the five
 * characters that are dangerous inside attribute values:
 *   &  →  &amp;
 *   <  →  &lt;
 *   >  →  &gt;
 *   "  →  &quot;   ← CRITICAL: prevents attribute breakout
 *   '  →  &#39;
 *
 * The double-quote is the critical character: a plain escapeHtml (textContent
 * escaper) only handles & < > and would let a raw `"` in the alt or url
 * terminate the attribute value, silently truncating the serialized JSON.
 *
 * Reading side: the browser automatically decodes HTML entities when you read
 * `input.value`, so `parseImageValue(input.value)` receives clean JSON —
 * no explicit decoding step is needed on read.
 */
export function serializeImageValueAttr(value: ImageFieldValue): string {
  const json = JSON.stringify(value);
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a srcset string for a given format from an array of MediaVariant objects.
 * Filters by format, sorts by width ascending, joins as "<url> <w>w, ..." format.
 * Returns an empty string when no matching variants exist.
 */
export function buildSrcset(variants: MediaVariant[], format: string): string {
  const filtered = variants
    .filter((v) => v.format === format)
    .sort((a, b) => a.width - b.width);
  if (filtered.length === 0) return '';
  return filtered.map((v) => `${v.url} ${v.width}w`).join(', ');
}

/**
 * Project a MediaEntry to an ImageFieldValue snapshot (taken at pick time).
 *
 * Rules (spec REQ-6):
 *   - url   → entry.url
 *   - alt   → entry.alt ?? ''
 *   - width / height → included only when present on entry
 *   - caption is NOT included (no registry default; caption is per-component)
 */
export function mediaEntryToImageValue(entry: MediaEntry): ImageFieldValue {
  return {
    url: entry.url,
    alt: entry.alt ?? '',
    ...(typeof entry.width === 'number' && Number.isFinite(entry.width) && entry.width > 0 && { width: entry.width }),
    ...(typeof entry.height === 'number' && Number.isFinite(entry.height) && entry.height > 0 && { height: entry.height }),
  };
}

/**
 * Resolve the display caption for an image field value.
 *
 * Resolution order:
 *   1. override?.trim() — if non-empty, use override (caller-supplied explicit caption)
 *   2. value.caption?.trim() — if non-empty, use the stored caption
 *   3. '' — no caption (empty string means "no figure wrapper")
 *
 * Pure function — safe to call in component frontmatter and unit tests.
 */
export function getCaption(value: ImageFieldValue, override?: string): string {
  const overrideTrimmed = override?.trim() ?? '';
  if (overrideTrimmed.length > 0) return overrideTrimmed;
  const valueCaptionTrimmed = value.caption?.trim() ?? '';
  if (valueCaptionTrimmed.length > 0) return valueCaptionTrimmed;
  return '';
}
