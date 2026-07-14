/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { getUploadsDir, resolveUploadPath } from '../../utils/paths.js';
import { generateAndPersistVariants } from '../../utils/variant-generator.js';
import { DEFAULT_ALLOWED_FILE_TYPES, lookupByMime } from '../../utils/file-catalog.js';
import { evaluateUpload } from '../../utils/upload-gate.js';
import type { MediaEntry } from '../../types/index.js';
import * as data from '../data.js';
import { localizedJsonError, parseJsonBody } from './shared.js';
import { getAuth } from './auth-core.js';

// Media upload constants

/**
 * Memoized parsed allowlist. Populated on first call to getAllowedFileTypes().
 * Exported resetAllowedFileTypesCache() clears it for test isolation.
 */
let _allowedFileTypesCache: Set<string> | null = null;

/**
 * Returns the resolved allowlist as a Set<string>.
 *
 * Source priority (ADR-1):
 *   1. import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES (injected by vite.define as JSON string)
 *   2. DEFAULT_ALLOWED_FILE_TYPES fallback
 *
 * Result is memoized; call resetAllowedFileTypesCache() between test runs.
 */
function getAllowedFileTypes(): Set<string> {
  if (_allowedFileTypesCache !== null) return _allowedFileTypesCache;

  // biome-ignore lint/suspicious/noExplicitAny: import.meta.env is untyped at this call site; narrowed immediately below
  const raw: string =
    (((import.meta as any).env as Record<string, unknown> | undefined)
      ?.ASTRO_BLOCKS_ALLOWED_FILE_TYPES as string) ?? '';
  let parsed: string[] | null = null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const decoded = JSON.parse(raw);
      if (
        Array.isArray(decoded) &&
        decoded.every((v) => typeof v === 'string' && v.trim().length > 0)
      ) {
        parsed = [...new Set(decoded.map((v: string) => v.toLowerCase().trim()))];
      }
    } catch {
      // Malformed env — fall through to default
    }
  }

  // Belt and braces: intersect with the catalog (ADR-0023).
  //
  // validateFileTypeConfig() already throws at build time for any MIME the catalog has no row
  // for, so for a valid config this filter removes nothing. It exists so that NO path — not a
  // hand-edited bundle, not a future config source we have not thought of — can admit a MIME
  // the system cannot name a file for. V4 makes the misconfiguration loud; this makes the bad
  // state impossible, which is what lets handleUpload treat a missing row as a server bug
  // rather than pretending the client sent something unsupported.
  const resolved = parsed ?? DEFAULT_ALLOWED_FILE_TYPES;
  _allowedFileTypesCache = new Set(resolved.filter((mime) => lookupByMime(mime) !== null));
  return _allowedFileTypesCache;
}

/**
 * Test hook: clears the memoized allowlist so the next call to getAllowedFileTypes()
 * re-reads from the environment. Required when tests change env vars between calls.
 */
export function resetAllowedFileTypesCache(): void {
  _allowedFileTypesCache = null;
}

/**
 * Test hook: seed the allowlist directly. Pass null to restore normal resolution.
 *
 * The allowlist reaches the runtime through import.meta.env, which vite.define replaces
 * at COMPILE time — so `node --test` running against dist/ cannot influence it by any
 * ordinary means. That is not a trivia point: it is why this bug shipped. The
 * "allowlisted MIME with no extension mapping" state was known to be unreachable from
 * the test suite (see the FIX M-1 note this hook's first test replaced), so it was
 * approximated by a neighbouring case and the real one was never exercised.
 *
 * Test-only, hence the __ prefix. It adds no production configuration surface — routing
 * the allowlist through process.env would have created a runtime path to WIDEN a
 * security-relevant allowlist behind the back of the config-time validator.
 */
export function __setAllowedFileTypesForTest(mimes: string[] | null): void {
  _allowedFileTypesCache = mimes === null ? null : new Set(mimes.map((m) => m.toLowerCase()));
}

const MAX_UPLOAD_BYTES = (() => {
  const envVal = process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 5 * 1024 * 1024; // 5 MB default
})();

export async function handleUpload(request: Request): Promise<Response> {
  // Read raw binary body. The request Content-Type carries the file's real MIME.
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');

  // Decode filename from x-cms-filename header (percent-encoded); fall back to 'upload'.
  let rawName = 'upload';
  try {
    rawName = decodeURIComponent(request.headers.get('x-cms-filename') ?? 'upload');
  } catch {
    rawName = 'upload';
  }

  // Validate MIME type BEFORE disk write (denylist + allowlist gate — ADR-4)
  const mimeType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mimeType) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const row = lookupByMime(mimeType);
  const gateResult = evaluateUpload({
    mimeType,
    derivedExtension: row?.ext ?? null,
    allowed: getAllowedFileTypes(),
  });
  if (!gateResult.ok) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }

  // The gate passed, so the MIME is in the allowlist — and the allowlist is intersected with
  // the catalog (and validated against it at config time), so its row exists. Reaching this
  // means our own invariant is broken: a server bug, not an unsupported file. Saying 415 here
  // is the lie that produced this incident — the gate approved the upload and the caller was
  // told their file type was unsupported. Fail as what it is.
  if (!row) {
    throw new Error(
      `[astro-blocks] catalog invariant violated: "${mimeType}" passed the allowlist gate but has no catalog row.`,
    );
  }

  // Validate size BEFORE disk write
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    const limitMb = Math.ceil(MAX_UPLOAD_BYTES / (1024 * 1024));
    return localizedJsonError(request, 'errors.fileTooLarge', 413, { limitMb: String(limitMb) });
  }

  // Extension is derived from the already-validated MIME type — never from the user-supplied filename.
  // This prevents a stored-XSS bypass where an SVG uploaded as "foo.jpg" would be served inline.
  const extension = row.ext;
  const subdir = new Date().toISOString().slice(0, 7).replace(/-/g, '/');
  const dir = path.join(getUploadsDir(), subdir);

  await fs.mkdir(dir, { recursive: true });

  const token = crypto.randomBytes(4).toString('hex');
  const rawBase = path.basename(rawName || 'upload', path.extname(rawName || ''));
  const base = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'file';
  const filename = `${token}-${base}${extension}`;
  await fs.writeFile(path.join(dir, filename), Buffer.from(buffer));

  const url = `/uploads/${subdir}/${filename}`.replace(/\/+/, '/');

  // Capture image dimensions from the in-memory buffer (REQ-4).
  // Only the 'image' category has meaningful pixel dimensions; imageSize cannot parse the rest.
  // Wrapped in try/catch so corrupt headers or unsupported formats never fail the upload.
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  if (row.category === 'image') {
    try {
      const dim = imageSize(Buffer.from(buffer));
      if (
        typeof dim.width === 'number' &&
        typeof dim.height === 'number' &&
        Number.isFinite(dim.width) &&
        Number.isFinite(dim.height)
      ) {
        capturedWidth = Math.floor(dim.width);
        capturedHeight = Math.floor(dim.height);
      }
    } catch {
      // Swallow dimension errors — never fail the upload
    }
  }

  // The category is DECLARED on the catalog row, never parsed out of the MIME string.
  const fileCategory = row.category;

  // Append MediaEntry to registry with status:'processing' (variants generated async)
  const entry: MediaEntry = {
    id: data.generateId(),
    url,
    filename: rawName || filename,
    size: buffer.byteLength,
    mimeType,
    fileCategory,
    createdAt: new Date().toISOString(),
    ...(capturedWidth !== undefined && { width: capturedWidth }),
    ...(capturedHeight !== undefined && { height: capturedHeight }),
    status: 'processing',
  };
  await data.appendMediaEntry(entry);

  // Build response first, then fire-and-forget variant generation (after response returns)
  const res = Response.json({ url, entry });
  void generateAndPersistVariants(entry).catch(() => {});
  return res;
}

export async function handleDeleteUpload(request: Request): Promise<Response> {
  const { data: body, error } = await parseJsonBody<{ url?: string }>(request);
  if (error || !body) return error as Response;

  const url = body.url ?? '';
  const filePath = resolveUploadPath(url);
  if (!filePath) return localizedJsonError(request, 'errors.invalidUrl');

  // Look up the entry BEFORE removing from registry so we can access its variants
  const mediaData = await data.loadMedia();
  const entry = mediaData.uploads.find((e) => e.url === url);

  // Delete variant files (cascade) — ENOENT is tolerated (idempotent)
  if (entry?.variants && entry.variants.length > 0) {
    for (const variant of entry.variants) {
      const variantPath = resolveUploadPath(variant.url);
      if (variantPath) {
        try {
          await fs.unlink(variantPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // Non-ENOENT errors are swallowed: cascade is best-effort
          }
        }
      }
    }
  }

  // Attempt to unlink original from disk; ENOENT is treated as no-error (idempotent)
  try {
    await fs.unlink(filePath);
  } catch (deleteError) {
    if ((deleteError as NodeJS.ErrnoException).code !== 'ENOENT') {
      return localizedJsonError(request, 'errors.deleteFailed', 500);
    }
  }

  // Always prune the registry entry by URL (idempotent for both normal and ENOENT cases).
  // Serialized read-modify-write — concurrency-safe.
  await data.removeMediaEntryByUrl(url);

  return new Response(null, { status: 204 });
}

export async function handleGetMedia(request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  // Parse query parameters: q, page, limit
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  let page = parseInt(url.searchParams.get('page') ?? '', 10);
  if (Number.isNaN(page) || page < 1) page = 1;

  let limit = parseInt(url.searchParams.get('limit') ?? '', 10);
  // NaN (non-numeric or absent) → default 24; otherwise clamp to [1, 100]
  if (Number.isNaN(limit)) limit = 24;
  limit = Math.min(100, Math.max(1, limit));

  // Pipeline: reconcile → sort newest-first → filter(q) → count total → slice page
  const reconciled = await data.reconcileMedia();

  const sorted = [...reconciled.uploads].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Filter by filename substring (case-insensitive) if q is non-empty
  const filtered = q ? sorted.filter((entry) => entry.filename.toLowerCase().includes(q)) : sorted;

  const total = filtered.length;
  const uploads = filtered.slice((page - 1) * limit, page * limit);

  return Response.json({ uploads, total, page, limit });
}

/**
 * PATCH /cms/api/media/:id — Update the default alt text of a media entry.
 *
 * Request body: { alt: string }
 * Response 200: { entry: MediaEntry } — the updated entry
 * Errors: 401 (unauth), 404 (unknown id), 400 (malformed body)
 */
export async function handleUpdateMediaAlt(id: string, request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const { data: body, error } = await parseJsonBody<{ alt?: unknown }>(request);
  if (error || !body) return error as Response;

  if (typeof body.alt !== 'string') {
    return localizedJsonError(request, 'errors.altMustBeString');
  }

  const updated = await data.updateMediaEntryAlt(id, body.alt);
  if (!updated) return localizedJsonError(request, 'errors.notFound', 404);

  return Response.json({ entry: updated });
}

/**
 * GET /cms/api/media/:id/usage
 * Returns { count, usages[] } for the given media entry URL.
 * 401 if unauthenticated; 404 if media id not found.
 */
export async function handleGetMediaUsage(id: string, request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const m = await data.loadMedia();
  const entry = m.uploads.find((e) => e.id === id);
  if (!entry) return localizedJsonError(request, 'errors.notFound', 404);

  const result = await data.findMediaUsages(entry.url);
  return Response.json(result);
}

/**
 * POST /cms/api/media/:id/replace
 * Replaces the bytes of an existing media entry in-place (same URL, same MIME).
 * 401 unauth; 404 unknown id; 400 no file; 415 wrong/disallowed MIME; 413 oversize.
 * On success: 200 { entry } with status:'processing'; fires variant regen async.
 */
export async function handleReplaceUpload(request: Request, id: string): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const m = await data.loadMedia();
  const entry = m.uploads.find((e) => e.id === id);
  if (!entry) return localizedJsonError(request, 'errors.notFound', 404);

  // Read raw binary body. The request Content-Type carries the file's real MIME.
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');

  // Decode filename from x-cms-filename header; fall back to 'upload'.
  let rawReplaceName = 'upload';
  try {
    rawReplaceName = decodeURIComponent(request.headers.get('x-cms-filename') ?? 'upload');
  } catch {
    rawReplaceName = 'upload';
  }

  // MIME validation — denylist + allowlist gate (ADR-4), then same-MIME constraint
  const mimeType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mimeType) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const replaceGateResult = evaluateUpload({
    mimeType,
    derivedExtension: lookupByMime(mimeType)?.ext ?? null,
    allowed: getAllowedFileTypes(),
  });
  if (!replaceGateResult.ok) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  if (mimeType !== entry.mimeType) {
    return localizedJsonError(request, 'errors.replaceSameType', 415, { mimeType: entry.mimeType });
  }

  // Size guard
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    const limitMb = Math.ceil(MAX_UPLOAD_BYTES / (1024 * 1024));
    return localizedJsonError(request, 'errors.fileTooLarge', 413, { limitMb: String(limitMb) });
  }

  // Resolve the on-disk path (reuses traversal guard)
  const filePath = resolveUploadPath(entry.url);
  if (!filePath) return localizedJsonError(request, 'errors.invalidUrl', 500);

  // Overwrite bytes ATOMICALLY: write to a temp file then rename into place.
  // rename(2) is atomic on POSIX, so a read never observes a half-written file.
  // On failure the temp file is cleaned up and the original is left intact.
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmpPath, Buffer.from(buffer));
    await fs.rename(tmpPath, filePath);
  } catch (writeErr) {
    // Clean up the temp file on error (best-effort) and abort before any
    // variant unlink or registry update so the original stays intact.
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* ignore */
    }
    return localizedJsonError(request, 'errors.replaceWriteFailed', 500);
  }

  // Recompute dimensions
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  try {
    const dim = imageSize(Buffer.from(buffer));
    if (
      typeof dim.width === 'number' &&
      typeof dim.height === 'number' &&
      Number.isFinite(dim.width) &&
      Number.isFinite(dim.height)
    ) {
      capturedWidth = Math.floor(dim.width);
      capturedHeight = Math.floor(dim.height);
    }
  } catch {
    // Swallow dimension errors — never fail the replace
  }

  // Update registry under lock. replaceMediaEntryBytes atomically captures
  // the current variant list and clears it, then returns { entry, oldVariants }.
  // We use oldVariants (the set that was live at mutation time) to unlink —
  // not the pre-lock snapshot from the early loadMedia(), which avoids the race
  // where a concurrent regen re-populates variants between the snapshot and lock.
  const result = await data.replaceMediaEntryBytes(id, {
    size: buffer.byteLength,
    width: capturedWidth,
    height: capturedHeight,
  });
  if (!result) return localizedJsonError(request, 'errors.notFound', 404);

  const { entry: updated, oldVariants } = result;

  // Delete stale variant files (they map to old bytes; new image may be smaller).
  // ENOENT is tolerated: variant may already be gone.
  for (const variant of oldVariants) {
    const variantPath = resolveUploadPath(variant.url);
    if (variantPath) {
      try {
        await fs.unlink(variantPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Non-ENOENT errors are swallowed: cascade is best-effort
        }
      }
    }
  }

  // Build response, then fire-and-forget variant regen (same as handleUpload)
  const res = Response.json({ entry: updated });
  void generateAndPersistVariants(updated).catch(() => {});
  return res;
}
