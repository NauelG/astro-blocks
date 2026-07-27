/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { getUploadsDir, resolveUploadPath } from '../../utils/paths.js';
import { spawnVariantGeneration } from '../../utils/variant-generator.js';
import { readBakedConfig } from '../../utils/baked.js';
import {
  DEFAULT_ALLOWED_FILE_TYPES,
  decodeAllowlist,
  lookupByMime,
} from '../../utils/file-catalog.js';
import { evaluateUpload } from '../../utils/upload-gate.js';
import type { FileCategory, MediaEntry } from '../../types/index.js';
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

  const resolved = readBakedConfig('ASTRO_BLOCKS_ALLOWED_FILE_TYPES', {
    decode: decodeAllowlist,
    fallback: DEFAULT_ALLOWED_FILE_TYPES,
  });

  // Belt and braces: intersect with the catalog (ADR-0023).
  //
  // validateFileTypeConfig() already throws at build time for any MIME the catalog has no row
  // for, so for a valid config this filter removes nothing. It exists so that NO path — not a
  // hand-edited bundle, not a future config source we have not thought of — can admit a MIME
  // the system cannot name a file for. V4 makes the misconfiguration loud; this makes the bad
  // state impossible, which is what lets handleUpload treat a missing row as a server bug
  // rather than pretending the client sent something unsupported.
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

/**
 * Per-category upload ceilings, in bytes. `image` keeps today's 5 MB exactly — this change
 * must not move the limit for the common case.
 */
const DEFAULT_MAX_BYTES: Record<FileCategory, number> = {
  image: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

/** Memoised per-category policy from the plugin config (baked in by vite.define). */
let _maxUploadBytesCache: Partial<Record<FileCategory, number>> | null = null;

function getCategoryPolicy(): Partial<Record<FileCategory, number>> {
  if (_maxUploadBytesCache !== null) return _maxUploadBytesCache;

  _maxUploadBytesCache = readBakedConfig('ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY', {
    decode: (parsed) =>
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Partial<Record<FileCategory, number>>)
        : null,
    fallback: {},
  });
  return _maxUploadBytesCache;
}

/**
 * ASTRO_BLOCKS_MAX_UPLOAD_BYTES — the RUNTIME global limit. Read from process.env on every
 * call, so it takes effect without a rebuild (`maxUploadBytes` is baked in by vite.define).
 *
 * It REPLACES the per-category defaults; it does not clamp them. That is the semantics it has
 * always had — docs/media.md documents it as "Maximum accepted upload size", and consumers
 * raise it as readily as they lower it. Treating it as a hard ceiling (min(policy, env)) would
 * silently cut anyone who had raised it back down to the 5 MB image default, and they would
 * only find out when an editor failed to upload a photo in production.
 *
 * Not deprecated. It is the only knob that works without a rebuild, and it still lets whoever
 * runs the server cap everything in one move.
 */
function getGlobalLimitOverride(): number | null {
  const envVal = process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
  if (!envVal) return null;
  const parsed = Number.parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The effective limit for a category.
 *
 *   maxUploadBytes[category]  — explicit per-category policy (build time), most specific
 *   ASTRO_BLOCKS_MAX_UPLOAD_BYTES — global override (runtime)
 *   DEFAULT_MAX_BYTES[category]   — the shipped default
 *
 * Most specific wins. A consumer with no maxUploadBytes and an env var set gets exactly
 * today's behaviour: that one number, for everything.
 */
function limitFor(category: FileCategory): number {
  return getCategoryPolicy()[category] ?? getGlobalLimitOverride() ?? DEFAULT_MAX_BYTES[category];
}

function tooLarge(request: Request, limit: number): Response {
  const limitMb = Math.ceil(limit / (1024 * 1024));
  return localizedJsonError(request, 'errors.fileTooLarge', 413, { limitMb: String(limitMb) });
}

/** Why a streamed ingest ended. A number is the byte count written. */
type StreamOutcome = number | 'too-large' | 'empty' | 'write-failed';

/**
 * Stream a request body to disk without ever holding it whole in memory.
 *
 * The bytes written are counted as they go, and the counter — not the Content-Length header —
 * is the authority: the header is client-supplied and a body is free to lie about it. The
 * preflight in handleUpload is a cheap early-out; this is the guarantee.
 *
 * The failure mode that matters is the partial file. Between the first byte and the rename,
 * this function owns a real file on disk, and EVERY exit — overrun, aborted connection, write
 * error — must remove it. A leaked partial upload is the thing a streaming ingest gets wrong,
 * so the cleanup lives in one place and the tests assert an empty uploads directory after a
 * 413 rather than trusting that it happened.
 *
 * Bytes land under a temporary name and are renamed into place only on success, so a partial
 * file is never observable at its final URL. rename(2) is atomic on POSIX.
 */
async function streamBodyToFile(
  body: ReadableStream<Uint8Array> | null,
  destPath: string,
  limit: number,
): Promise<StreamOutcome> {
  if (!body) return 'empty';

  const tmpPath = `${destPath}.${crypto.randomBytes(6).toString('hex')}.part`;
  const handle = await fs.open(tmpPath, 'w');

  let written = 0;
  const cleanup = async () => {
    try {
      await handle.close();
    } catch {
      /* already closed */
    }
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* never existed, or already gone */
    }
  };

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      written += value.byteLength;
      if (written > limit) {
        await reader.cancel().catch(() => {});
        await cleanup();
        return 'too-large';
      }
      await handle.write(value);
    }
  } catch {
    // Aborted connection, read error, disk full — all the same from here: leave nothing behind.
    await cleanup();
    return 'write-failed';
  }

  if (written === 0) {
    await cleanup();
    return 'empty';
  }

  try {
    await handle.close();
    await fs.rename(tmpPath, destPath);
  } catch {
    await cleanup();
    return 'write-failed';
  }

  return written;
}

export async function handleUpload(request: Request): Promise<Response> {
  // NOTHING here reads the request body. The Content-Type header carries the file's real MIME,
  // so the file can be authorised — denylist, allowlist, size — before a single byte is
  // accepted. That property always existed; it was simply never used, and the old code called
  // request.arrayBuffer() first and checked the size afterwards, so the 413 rejected what the
  // server had already swallowed.
  //
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).

  // Decode filename from x-cms-filename header (percent-encoded); fall back to 'upload'.
  let rawName = 'upload';
  try {
    rawName = decodeURIComponent(request.headers.get('x-cms-filename') ?? 'upload');
  } catch {
    rawName = 'upload';
  }

  // 1. MIME from the header — denylist + allowlist gate (ADR-0018, order untouched)
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

  // 2. Size preflight, still without touching the body. Content-Length is client-supplied and
  //    may be absent or a lie, so this is a cheap early-out, not the guarantee — the bytes
  //    actually written are counted below.
  const limit = limitFor(row.category);
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > limit) return tooLarge(request, limit);
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
  const destPath = path.join(dir, filename);

  // 3. Ingest, branching on the category.
  //
  //    Images are buffered: sharp and imageSize both need the bytes resident, and images are
  //    bounded at 5 MB by default. Everything else — video, audio, documents — streams to disk
  //    and is never held whole in memory. That is the difference between a 200 MB video costing
  //    200 MB of RAM per concurrent upload and costing a chunk.
  let sizeOnDisk: number;
  let imageBuffer: Buffer | null = null;

  if (row.category === 'image') {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');
    if (buffer.byteLength > limit) return tooLarge(request, limit);
    imageBuffer = Buffer.from(buffer);
    sizeOnDisk = imageBuffer.byteLength;
    await fs.writeFile(destPath, imageBuffer);
  } else {
    const streamed = await streamBodyToFile(request.body, destPath, limit);
    if (streamed === 'too-large') return tooLarge(request, limit);
    if (streamed === 'empty') return localizedJsonError(request, 'errors.noFile');
    if (streamed === 'write-failed') {
      return localizedJsonError(request, 'errors.uploadFailed', 500);
    }
    sizeOnDisk = streamed;
  }

  const url = `/uploads/${subdir}/${filename}`.replace(/\/+/, '/');

  // Capture image dimensions from the in-memory buffer (REQ-4).
  // Only the 'image' category has meaningful pixel dimensions; imageSize cannot parse the rest.
  // Video and audio are passthrough: no dimensions, no duration, no poster, and therefore no
  // ffprobe — a native binary would be a new system requirement for every consumer (ADR-0024).
  // Wrapped in try/catch so corrupt headers or unsupported formats never fail the upload.
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  if (imageBuffer !== null) {
    try {
      const dim = imageSize(imageBuffer);
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
    size: sizeOnDisk,
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
  spawnVariantGeneration(entry);
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

  // Parse query parameters: q, accept, page, limit
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  // `accept` narrows the listing to a set of MIME types — the picker's browseAccept (ADR-0036).
  // Absent, empty, or all-blank means no filter.
  const accept = (url.searchParams.get('accept') ?? '')
    .split(',')
    .map((mime) => mime.trim().toLowerCase())
    .filter((mime) => mime !== '');

  let page = parseInt(url.searchParams.get('page') ?? '', 10);
  if (Number.isNaN(page) || page < 1) page = 1;

  let limit = parseInt(url.searchParams.get('limit') ?? '', 10);
  // NaN (non-numeric or absent) → default 24; otherwise clamp to [1, 100]
  if (Number.isNaN(limit)) limit = 24;
  limit = Math.min(100, Math.max(1, limit));

  // Pipeline: reconcile → sort newest-first → filter(q) → filter(accept) → count total → slice page
  const reconciled = await data.reconcileMedia();

  const sorted = [...reconciled.uploads].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Filter by filename substring (case-insensitive) if q is non-empty
  const filtered = q ? sorted.filter((entry) => entry.filename.toLowerCase().includes(q)) : sorted;

  // Filter by MIME type. EXACT equality, never a prefix or wildcard: 'image/sv' must not match
  // 'image/svg+xml'. Both sides are lowercased so a stored 'IMAGE/PNG' is comparable.
  //
  // Deliberately NOT intersected with getAllowedFileTypes(). The allowlist is the UPLOAD gate
  // (spec R7, R16); this reads files that are already on disk. Intersecting here would mean that
  // narrowing allowedFileTypes hides assets published pages still reference, with no way for the
  // owner to select them again — hardening in appearance, deferred data loss in practice. An
  // unknown MIME therefore matches nothing: an empty page, not an error. (ADR-0036)
  const typed =
    accept.length > 0
      ? filtered.filter((entry) => accept.includes(entry.mimeType.toLowerCase()))
      : filtered;

  const total = typed.length;
  const uploads = typed.slice((page - 1) * limit, page * limit);

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

  // Same shape as handleUpload: authorise from the headers, then ingest. Nothing below this
  // line reads the body until the file has passed the gate and the size preflight.
  //
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).

  // MIME validation — denylist + allowlist gate (ADR-0018), then same-MIME constraint
  const mimeType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mimeType) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const row = lookupByMime(mimeType);
  const replaceGateResult = evaluateUpload({
    mimeType,
    derivedExtension: row?.ext ?? null,
    allowed: getAllowedFileTypes(),
  });
  if (!replaceGateResult.ok) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  if (mimeType !== entry.mimeType) {
    return localizedJsonError(request, 'errors.replaceSameType', 415, { mimeType: entry.mimeType });
  }
  if (!row) {
    throw new Error(
      `[astro-blocks] catalog invariant violated: "${mimeType}" passed the allowlist gate but has no catalog row.`,
    );
  }

  // The replacement must carry the original's MIME, so its category — and therefore its limit
  // and its ingest strategy — are identical to the original's by construction.
  const limit = limitFor(row.category);
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > limit) return tooLarge(request, limit);
  }

  // Resolve the on-disk path (reuses traversal guard)
  const filePath = resolveUploadPath(entry.url);
  if (!filePath) return localizedJsonError(request, 'errors.invalidUrl', 500);

  // Overwrite bytes ATOMICALLY: write to a temp file then rename into place. rename(2) is
  // atomic on POSIX, so a read never observes a half-written file, and on any failure the
  // temp file is removed and the ORIGINAL is left intact — the replace is all-or-nothing.
  let replacedSize: number;
  let imageBuffer: Buffer | null = null;

  if (row.category === 'image') {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');
    if (buffer.byteLength > limit) return tooLarge(request, limit);
    imageBuffer = Buffer.from(buffer);
    replacedSize = imageBuffer.byteLength;

    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmpPath, imageBuffer);
      await fs.rename(tmpPath, filePath);
    } catch {
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      return localizedJsonError(request, 'errors.replaceWriteFailed', 500);
    }
  } else {
    const streamed = await streamBodyToFile(request.body, filePath, limit);
    if (streamed === 'too-large') return tooLarge(request, limit);
    if (streamed === 'empty') return localizedJsonError(request, 'errors.noFile');
    if (streamed === 'write-failed') {
      return localizedJsonError(request, 'errors.replaceWriteFailed', 500);
    }
    replacedSize = streamed;
  }

  // Recompute dimensions — only images have any. This used to run imageSize over every
  // replacement, PDFs included; the try/catch made it harmless but it was never meaningful.
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  if (imageBuffer !== null) {
    try {
      const dim = imageSize(imageBuffer);
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
  }

  // Update registry under lock. replaceMediaEntryBytes atomically captures
  // the current variant list and clears it, then returns { entry, oldVariants }.
  // We use oldVariants (the set that was live at mutation time) to unlink —
  // not the pre-lock snapshot from the early loadMedia(), which avoids the race
  // where a concurrent regen re-populates variants between the snapshot and lock.
  const result = await data.replaceMediaEntryBytes(id, {
    size: replacedSize,
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
  spawnVariantGeneration(updated);
  return res;
}
