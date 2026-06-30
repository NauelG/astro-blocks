/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/file-value.ts
 *
 * Pure helpers for the FileFieldValue contract (ADR-3, ADR-5).
 * Mirrors utils/image-value.ts — same hidden-input JSON pattern, different semantics.
 *
 * Exports:
 *   - toFileValue           : coerce any unknown input to a valid FileFieldValue
 *   - parseFileValue        : deserialize the hidden-input JSON (never throws)
 *   - serializeFileValueAttr: serialize FileFieldValue to a safe HTML attribute string
 *   - isEmptyFileValue      : detect an "empty / no value" FileFieldValue
 *   - mediaEntryToFileValue : project a MediaEntry → FileFieldValue snapshot
 *   - fileDownloadUrl       : resolve the URL for an anchor href, appending ?download when needed
 *
 * All functions are deterministic and side-effect-free — safe to use in tests,
 * UI, server handlers, and Astro component frontmatter.
 */

import type { FileFieldValue, MediaEntry } from '../types/index.js';

/** Sentinel returned for null / undefined / malformed input. */
const EMPTY: FileFieldValue = { url: '' };

/**
 * Coerce any unknown value to a valid FileFieldValue.
 *
 * Coercion rules:
 *   - Already-conforming object (has string url) → returned with normalized optional fields
 *   - null / undefined / non-object / missing url → EMPTY sentinel { url: '' }
 *
 * Note: unlike toImageValue, there is no legacy bare-string coercion for file values
 * because file fields never stored bare URLs (new feature).
 */
export function toFileValue(value: unknown): FileFieldValue {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === 'string') {
      return {
        url: obj.url,
        ...(typeof obj.filename === 'string' && { filename: obj.filename }),
        ...(typeof obj.mimeType === 'string' && { mimeType: obj.mimeType }),
        ...(typeof obj.download === 'boolean' && { download: obj.download }),
      };
    }
    return { ...EMPTY };
  }

  return { ...EMPTY };
}

/**
 * Deserialize the hidden input value for a file field.
 *
 * The hidden input holds either:
 *   a) A JSON-serialized FileFieldValue (standard format)
 *   b) An empty string (no file selected)
 *
 * Returns a valid FileFieldValue in all cases — never throws.
 */
export function parseFileValue(raw: string): FileFieldValue {
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
          ...(typeof obj.filename === 'string' && { filename: obj.filename }),
          ...(typeof obj.mimeType === 'string' && { mimeType: obj.mimeType }),
          ...(typeof obj.download === 'boolean' && { download: obj.download }),
        };
      }
    } catch {
      // Malformed JSON → fall through to sentinel
    }
    return { url: '' };
  }

  // Non-JSON input (bare string) → not a valid FileFieldValue
  return { url: '' };
}

/**
 * Serialize a FileFieldValue into a string safe to embed in an HTML `value="..."` attribute.
 *
 * Applies the same HTML entity escaping as serializeImageValueAttr:
 *   &  →  &amp;
 *   <  →  &lt;
 *   >  →  &gt;
 *   "  →  &quot;   ← CRITICAL: prevents attribute breakout
 *   '  →  &#39;
 *
 * The browser automatically decodes HTML entities when reading input.value, so
 * parseFileValue(input.value) receives clean JSON — no explicit decoding needed.
 */
export function serializeFileValueAttr(value: FileFieldValue): string {
  const json = JSON.stringify(value);
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return true when the FileFieldValue represents "no file selected".
 *
 * An empty value is:
 *   - null / undefined
 *   - not an object (e.g. a raw string)
 *   - an object where url is absent or an empty string
 */
export function isEmptyFileValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  return typeof obj.url !== 'string' || obj.url === '';
}

/**
 * Project a MediaEntry to a FileFieldValue snapshot (taken at pick time).
 *
 * Rules:
 *   - url      → entry.url
 *   - filename → entry.filename
 *   - mimeType → entry.mimeType
 *   - download → NOT set from entry (comes from schema's download meta at pick time)
 */
export function mediaEntryToFileValue(entry: MediaEntry): FileFieldValue {
  return {
    url: entry.url,
    filename: entry.filename,
    mimeType: entry.mimeType,
  };
}

/**
 * Returns true when the URL already carries a `download` search parameter
 * (with or without a value), using the URL constructor for precise key
 * matching — immune to false positives from params like `?downloadtoken=...`.
 */
function hasDownloadParam(url: string): boolean {
  try {
    const base = url.startsWith('http://') || url.startsWith('https://') ? undefined : 'http://x';
    return new URL(url, base).searchParams.has('download');
  } catch {
    return false;
  }
}

/**
 * Resolve the URL to use for a file anchor href.
 *
 * When value.download === true, appends the ?download query parameter so the
 * serving route (routes/uploads-get.ts) sets Content-Disposition: attachment.
 *
 * Handles existing query strings defensively:
 *   - No existing query string → append ?download
 *   - Existing query string    → append &download
 *   - Already carries a `download` key → return url as-is (no duplication)
 *
 * When download is false or undefined, returns value.url unchanged.
 *
 * Usage in component frontmatter:
 *   <a href={fileDownloadUrl(file)} download={file.download ? (file.filename ?? '') : undefined}>
 */
export function fileDownloadUrl(value: FileFieldValue): string {
  const { url, download } = value;
  if (!download) return url;
  if (hasDownloadParam(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}download`;
}
