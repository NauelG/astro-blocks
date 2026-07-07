/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { AuthUser } from '../../types/index.js';
import * as data from '../data.js';
import { buildExportStream, runImportPipeline } from '../backup.js';
import { UNIT_TO_DATA_FILES } from '../manifest.js';
import type { ExportUnit } from '../manifest.js';
import { readCeilingEnvVars } from '../import-utils.js';
import { jsonError, localizedJsonError } from './shared.js';
import type { HandlerContext } from './shared.js';
import { requireOwner } from './auth-core.js';

/**
 * GET /cms/api/export?units=pages,media,...
 *
 * Owner-only streaming zip export of selected CMS units (ADR-4).
 * Returns the zip archive as a ReadableStream with Content-Type application/zip.
 */
export async function handleExport(
  request: Request,
  authUser?: AuthUser | null,
): Promise<Response> {
  // Auth gate: must be authenticated
  if (!authUser) {
    return request
      ? localizedJsonError(request, 'errors.unauthorized', 401)
      : jsonError('Unauthorized', 401);
  }

  // Owner-only gate
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  // Parse ?units=pages,media,... from the query string
  const url = new URL(request.url);
  const unitsParam = url.searchParams.get('units') ?? '';
  const rawUnits = [
    ...new Set(
      unitsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

  if (rawUnits.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Validate each unit against the known allowlist
  const knownUnits = new Set<string>(Object.keys(UNIT_TO_DATA_FILES));
  for (const unit of rawUnits) {
    if (!knownUnits.has(unit)) {
      return localizedJsonError(request, 'errors.invalidBody', 400);
    }
  }

  const units = rawUnits as ExportUnit[];

  try {
    const stream = await buildExportStream(units);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `astro-blocks-export-${timestamp}.zip`;

    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Export failed', 500);
  }
}

/**
 * POST /cms/api/import
 *
 * Owner-only import handler (ADR-5).
 * Reads the request body as a stream (never fully buffered in memory beyond what
 * we collect for fflate extraction). Orchestrates:
 *   requireOwner → readCeilingEnvVars → runImportPipeline → JSON response.
 *
 * Maps failures to HTTP status codes:
 *   400 — empty or corrupt zip
 *   413 — decompression ceiling exceeded (zip-bomb guard)
 *   422 — schemaVersion mismatch, checksum failure, or structural validation error
 *   401 — not authenticated
 *   403 — not owner
 */
export async function handleImport(
  request: Request,
  authUser: AuthUser | null | undefined,
  context: HandlerContext = {},
): Promise<Response> {
  // Auth gate
  if (!authUser) {
    return request
      ? localizedJsonError(request, 'errors.unauthorized', 401)
      : jsonError('Unauthorized', 401);
  }

  // Owner-only gate
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  // Read ceiling limits first so we can reject oversized payloads early.
  const ceilings = readCeilingEnvVars();

  // FIX 2: Reject oversized compressed body BEFORE buffering it.
  // Content-Length may be absent or spoofed, so we also check after buffering.
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const clBytes = parseInt(contentLength, 10);
    if (Number.isFinite(clBytes) && clBytes > ceilings.compressed) {
      return jsonError(
        `Compressed body too large: Content-Length ${clBytes} exceeds limit ${ceilings.compressed}`,
        413,
      );
    }
  }

  // Read the request body — collect stream into a Buffer for fflate processing.
  // The zip is never written to a temp file on disk here; fflate decompresses
  // directly from the in-memory buffer into the staging directory.
  let bodyBuffer: Buffer;
  try {
    const ab = await request.arrayBuffer();
    bodyBuffer = Buffer.from(ab);
  } catch {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Post-buffer compressed size check (catches absent/spoofed Content-Length)
  if (bodyBuffer.length > ceilings.compressed) {
    return jsonError(
      `Compressed body too large: ${bodyBuffer.length} bytes exceeds limit ${ceilings.compressed}`,
      413,
    );
  }

  if (bodyBuffer.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();

  // FIX 5c: Wrap runImportPipeline in a top-level try/catch to guarantee a JSON error
  // response even if the pipeline throws unexpectedly.
  let result: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    result = await runImportPipeline(bodyBuffer, {
      projectRoot,
      ceilings,
      context,
    });
  } catch (err) {
    // Log the real error server-side; never expose raw message or paths to callers.
    console.error('[handleImport] unexpected error:', err);
    return jsonError('Import failed.', 500);
  }

  if (!result.ok) {
    switch (result.errorCode) {
      case 'empty':
      case 'corrupt':
        return localizedJsonError(request, 'errors.invalidBody', 400);
      case 'ceiling':
        return jsonError(result.reason ?? 'Decompression ceiling exceeded', 413);
      case 'validation':
        return jsonError(result.reason ?? 'Validation failed', 422);
      case 'apply-failed':
        return jsonError(result.reason ?? 'Import apply failed (rollback attempted)', 500);
      default:
        return jsonError('Import failed.', 500);
    }
  }

  return Response.json({ success: true, usersReplaced: result.usersReplaced ?? false });
}

/**
 * POST /cms/api/import/bootstrap
 *
 * Unauthenticated import endpoint for seeding a fresh instance (ADR-6).
 * SECURITY-CRITICAL: this surface is public — the zero-user gate is the ONLY
 * protection. The gate MUST be checked before any request-body access.
 *
 * Flow:
 *   1. Load users — check length BEFORE reading the request body.
 *   2. If users.length !== 0 → 403 IMMEDIATELY (body never read).
 *   3. If users.length === 0 → run the shared runImportPipeline (same validation,
 *      ceilings, checksum, path guards, backup, atomic apply as the authed import).
 *
 * Status codes:
 *   200 {success:true, usersReplaced}   — pipeline succeeded
 *   400                                  — empty or corrupt zip
 *   403                                  — instance already has users
 *   413                                  — decompression ceiling exceeded
 *   422                                  — schemaVersion mismatch / checksum / structural
 */
export async function handleBootstrapImport(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  // GATE: load users FIRST — before reading/consuming any request body.
  // If any user exists, refuse immediately without touching the body.
  const usersData = await data.loadUsers();
  if (usersData.users.length !== 0) {
    return jsonError('Forbidden: instance already has users', 403);
  }

  // Read ceiling limits so we can reject oversized payloads early.
  const ceilings = readCeilingEnvVars();

  // Compressed body size check via Content-Length (may be absent or spoofed).
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const clBytes = parseInt(contentLength, 10);
    if (Number.isFinite(clBytes) && clBytes > ceilings.compressed) {
      return jsonError(
        `Compressed body too large: Content-Length ${clBytes} exceeds limit ${ceilings.compressed}`,
        413,
      );
    }
  }

  // Read the request body for fflate processing.
  let bodyBuffer: Buffer;
  try {
    const ab = await request.arrayBuffer();
    bodyBuffer = Buffer.from(ab);
  } catch {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Post-buffer compressed size check (catches absent/spoofed Content-Length).
  if (bodyBuffer.length > ceilings.compressed) {
    return jsonError(
      `Compressed body too large: ${bodyBuffer.length} bytes exceeds limit ${ceilings.compressed}`,
      413,
    );
  }

  if (bodyBuffer.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();

  // Run the shared import pipeline — same validation, ceilings, path guards,
  // backup snapshot, and atomic apply as the authenticated import (C-5/ADR-5).
  // bootstrapMode:true enables the in-lock re-check inside _runImportPipelineCore
  // to close the TOCTOU race between the outer gate above and pipeline start.
  let result: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    result = await runImportPipeline(bodyBuffer, {
      projectRoot,
      ceilings,
      context,
      bootstrapMode: true,
    });
  } catch (err) {
    // Log the real error server-side; never expose raw message to anonymous callers.
    console.error('[handleBootstrapImport] unexpected error:', err);
    return jsonError('Bootstrap import failed.', 500);
  }

  if (!result.ok) {
    switch (result.errorCode) {
      case 'empty':
      case 'corrupt':
        return localizedJsonError(request, 'errors.invalidBody', 400);
      case 'ceiling':
        return jsonError(result.reason ?? 'Decompression ceiling exceeded', 413);
      case 'validation':
        return jsonError(result.reason ?? 'Validation failed', 422);
      case 'apply-failed':
        return jsonError(
          result.reason ?? 'Bootstrap import apply failed (rollback attempted)',
          500,
        );
      case 'bootstrap-users-exist':
        return jsonError('Forbidden: instance already has users', 403);
      default:
        return jsonError('Bootstrap import failed.', 500);
    }
  }

  return Response.json({ success: true, usersReplaced: result.usersReplaced ?? false });
}
