/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/upload-gate.ts
 *
 * Hard denylist + allowlist gate for file uploads (ADR-4).
 *
 * Exports:
 *   - DANGEROUS_EXTENSIONS : Set of always-denied file extensions
 *   - DANGEROUS_MIME       : Set of always-denied MIME types
 *   - evaluateUpload       : gate function returning ok | denied | unsupported
 *
 * Evaluation ORDER (locked — denylist always beats allowlist):
 *   1. denylist on MIME           → { ok: false, reason: 'denied' }
 *   2. denylist on derived ext    → { ok: false, reason: 'denied' }
 *   3. allowlist membership (MIME)→ { ok: false, reason: 'unsupported' } if absent
 *   4. { ok: true }
 *
 * Pure module — no I/O, no HTTP, no side effects. Safe to import in tests.
 *
 * Security note:
 *   SVG (image/svg+xml) is NOT in the denylist. It is allowed in uploads and
 *   served with Content-Disposition: attachment (XSS guard in the serving route).
 *   SVGZ (.svgz) IS in the extension denylist — compressed SVG with gzip magic
 *   bytes can bypass MIME sniffing in some browsers.
 */

/**
 * File extensions that are always denied, regardless of the allowlist.
 * All values are lowercase including the leading dot.
 */
export const DANGEROUS_EXTENSIONS: Set<string> = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.com',
  '.svgz',
]);

/**
 * MIME types that are always denied, regardless of the allowlist.
 * All values are lowercase.
 */
export const DANGEROUS_MIME: Set<string> = new Set([
  'text/html',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-bat',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
]);

/**
 * Regex for dangerous MIME type families not captured by the exact set above.
 * Matches any MIME matching these patterns.
 */
const DANGEROUS_MIME_PATTERN =
  /^(text\/(html|javascript)|application\/(javascript|x-javascript|x-sh|x-bat|x-msdownload|x-msdos-program|x-executable))(?:[;\s]|$)/i;

/** Input to evaluateUpload. */
export interface EvaluateUploadInput {
  /** The validated MIME type (lowercase, from Content-Type or sniffed). */
  mimeType: string;
  /**
   * The extension derived from the validated MIME type (e.g. '.pdf').
   * Pass null when no mapping exists (evaluateUpload skips extension denylist check).
   */
  derivedExtension: string | null;
  /** The resolved allowlist set for this request. */
  allowed: Set<string>;
}

/** Result of evaluateUpload. */
export type EvaluateUploadResult = { ok: true } | { ok: false; reason: 'denied' | 'unsupported' };

/**
 * Evaluate whether a file upload should be accepted, denied, or rejected as unsupported.
 *
 * Evaluation ORDER (locked):
 *   1. Denylist on MIME type (exact set + family regex) → denied
 *   2. Denylist on derived extension (exact set)         → denied
 *   3. Allowlist membership on MIME type                 → unsupported if absent
 *   4. ok
 *
 * The denylist always wins — even a misconfigured allowlist that includes a
 * dangerous MIME cannot re-enable a denied type.
 */
export function evaluateUpload(input: EvaluateUploadInput): EvaluateUploadResult {
  const { mimeType, derivedExtension, allowed } = input;

  // Step 1: Denylist on MIME (exact set or family pattern)
  if (DANGEROUS_MIME.has(mimeType) || DANGEROUS_MIME_PATTERN.test(mimeType)) {
    return { ok: false, reason: 'denied' };
  }

  // Step 2: Denylist on derived extension
  if (derivedExtension !== null && DANGEROUS_EXTENSIONS.has(derivedExtension.toLowerCase())) {
    return { ok: false, reason: 'denied' };
  }

  // Step 3: Allowlist membership check
  if (!allowed.has(mimeType)) {
    return { ok: false, reason: 'unsupported' };
  }

  // Step 4: All checks passed
  return { ok: true };
}
