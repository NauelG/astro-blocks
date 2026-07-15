/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * api/backup.ts — Export and import service for streaming zip archives.
 *
 * Implements ADR-4: buildExportStream enumerates only the 9-file allowlist
 * (UNIT_TO_DATA_FILES) and, for the media unit, also includes the
 * public/uploads tree as `uploads/...` entries.
 *
 * Implements ADR-5: extractToStaging, validateStagedImport, createBackupSnapshot,
 * applyImport — the four steps of the import pipeline.
 *
 * Checksums (sha256) are computed for every entry; manifest.json is written
 * LAST so its checksums map is complete.
 */

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { ZipDeflate, Unzip, UnzipInflate } from 'fflate';
import { fflateZipToReadableStream } from './backup-stream.js';
import {
  ALL_DATA_FILES,
  UNIT_TO_DATA_FILES,
  buildManifest,
  sha256Hex,
  validateManifest,
  verifyChecksums,
} from './manifest.js';
import type { ExportUnit, BackupManifest } from './manifest.js';
import { unitValidators } from './import-validate.js';
import type { CeilingLimits } from './import-utils.js';
import { CeilingExceededError, selectBackupsToPrune } from './import-utils.js';
import * as data from './data.js';

/** Converts a string to Uint8Array (UTF-8). */
function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Read a raw file from disk and return its contents as a Buffer.
 * Returns null when the file does not exist (data not yet initialised).
 */
async function readRawFile(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Recursively walk a directory and yield { relPath, absPath } for every file.
 * relPath is relative to the base directory.
 */
async function* walkDir(
  dir: string,
  base: string = dir,
): AsyncGenerator<{ relPath: string; absPath: string }> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // Directory does not exist — skip silently
    return;
  }
  for (const name of names) {
    const absPath = path.join(dir, name);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      // Use lstat (not stat) so we inspect the symlink itself, not its target.
      // Symlinks are skipped entirely to prevent path-traversal leaks via
      // crafted uploads pointing outside the project root.
      stat = await fs.lstat(absPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Skip symlinks — do not follow, do not include
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkDir(absPath, base);
    } else if (stat.isFile()) {
      const relPath = path.relative(base, absPath);
      yield { relPath, absPath };
    }
  }
}

/**
 * Add a single entry to an fflate Zip synchronously.
 * Returns the sha256 hex digest of the raw bytes written.
 */
function addZipEntry(
  zip: InstanceType<typeof import('fflate').Zip>,
  entryName: string,
  bytes: Uint8Array,
): string {
  const entry = new ZipDeflate(entryName);
  zip.add(entry);
  entry.push(bytes, true);
  return sha256Hex(bytes);
}

/**
 * Build a streaming zip export for the given units.
 *
 * @param units   - Non-empty array of ExportUnit keys to include.
 * @param projectRoot - Project root directory (defaults to ASTRO_BLOCKS_PROJECT_ROOT / cwd).
 * @returns A ReadableStream<Uint8Array> of the zip archive bytes.
 * @throws Error when units is empty.
 */
export async function buildExportStream(
  units: ExportUnit[],
  projectRoot?: string,
): Promise<ReadableStream<Uint8Array>> {
  if (!units || units.length === 0) {
    throw new Error('units must be a non-empty array');
  }

  // Defense-in-depth: deduplicate units so callers cannot produce duplicate zip entries.
  const dedupedUnits = [...new Set(units)];

  // Resolve the project root (allows injection for tests)
  const root = projectRoot ?? (process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd());

  // SOURCE BUFFERING NOTE (v1 tradeoff): source file bytes are read into memory
  // before the zip stream opens. The zip OUTPUT is streamed to the client;
  // SOURCE buffering is a known v1 tradeoff acceptable for typical CMS backup sizes.
  // True source streaming (pipe each file directly into the zip deflate entry) is a
  // future optimization.
  //
  // Collect all data file entries synchronously before starting the stream.
  // We need the bytes to compute checksums before building the manifest.
  const dataEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const uploadsEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const counts: Partial<Record<ExportUnit, number>> = {};

  for (const unit of dedupedUnits) {
    const dataFiles = UNIT_TO_DATA_FILES[unit];
    let unitCount = 0;

    for (const dataFile of dataFiles) {
      // dataFile is like "data/pages.json" — resolve to absolute path
      const filename = path.basename(dataFile); // e.g. "pages.json"
      const absPath = path.join(root, 'data', filename);
      const buf = await readRawFile(absPath);
      if (buf) {
        dataEntries.push({ entryName: dataFile, bytes: new Uint8Array(buf) });
        // Count records for the manifest
        try {
          const parsed = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
          // Each data file has a primary array — find the first array value
          for (const val of Object.values(parsed)) {
            if (Array.isArray(val)) {
              unitCount += val.length;
              break;
            }
          }
        } catch {
          // Not parseable JSON — count = 0, still include the file
        }
      }
    }

    counts[unit] = unitCount;

    // Media unit: also walk public/uploads tree
    if (unit === 'media') {
      const uploadsDir = path.join(root, 'public', 'uploads');
      for await (const { relPath, absPath } of walkDir(uploadsDir)) {
        const buf = await readRawFile(absPath);
        if (buf) {
          // relPath is relative to uploadsDir; zip entry path is uploads/<relPath>
          const entryName = 'uploads/' + relPath.replace(/\\/g, '/');
          uploadsEntries.push({ entryName, bytes: new Uint8Array(buf) });
        }
      }
    }
  }

  // Compute checksums for all data + uploads entries
  const checksums: Record<string, string> = {};
  for (const { entryName, bytes } of dataEntries) {
    checksums[entryName] = sha256Hex(bytes);
  }
  for (const { entryName, bytes } of uploadsEntries) {
    checksums[entryName] = sha256Hex(bytes);
  }

  // Build the manifest (written last into the zip)
  const manifest = buildManifest(dedupedUnits, counts, checksums);
  const manifestBytes = strToBytes(JSON.stringify(manifest, null, 2));

  // Create the streaming zip
  const stream = fflateZipToReadableStream((zip) => {
    // Write data entries
    for (const { entryName, bytes } of dataEntries) {
      addZipEntry(zip, entryName, bytes);
    }
    // Write uploads entries
    for (const { entryName, bytes } of uploadsEntries) {
      addZipEntry(zip, entryName, bytes);
    }
    // Write manifest.json LAST
    addZipEntry(zip, 'manifest.json', manifestBytes);
    zip.end();
  });

  return stream;
}

// ---------------------------------------------------------------------------
// C-1: extractToStaging — stream-extract a zip into a staging directory,
//      enforcing path guards and decompression ceilings at the CHUNK level
//      (M-1: abort mid-inflation when a ceiling is exceeded).
// ---------------------------------------------------------------------------

/**
 * Stream-extract the zip bytes in `zipBody` into `stagingDir`.
 *
 * Security guarantees:
 * - Every data/* entry is validated against ALL_DATA_FILES allowlist BEFORE writing.
 * - Every uploads/* entry path is validated (no `..`, absolute-path guard) BEFORE writing.
 * - Both per-file and total decompression ceilings are enforced during streaming
 *   (M-1): chunk bytes are counted BEFORE assembling the full decompressed file,
 *   aborting as soon as a ceiling is exceeded so zip-bomb payloads never fully
 *   inflate into memory or touch disk.
 *
 * @throws CeilingExceededError when a ceiling is exceeded.
 * @throws Error when an entry path is not in the allowlist or resolves outside uploads.
 */
export async function extractToStaging(
  zipBody: Buffer | Uint8Array,
  stagingDir: string,
  ceilings: CeilingLimits,
  projectRoot: string,
): Promise<void> {
  await fs.mkdir(stagingDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);

    let totalUncompressedBytes = 0;
    const pendingWrites: Promise<void>[] = [];
    let aborted = false;

    unzip.onfile = (file) => {
      // Early-exit when a previous entry already aborted the extraction.
      // Avoids calling file.start() and wasting CPU decompressing zip-bomb tails.
      if (aborted) {
        return;
      }

      const entryName = file.name;

      // ---------- path guard BEFORE writing ----------
      let destPath: string;
      if (entryName === 'manifest.json') {
        destPath = path.join(stagingDir, 'manifest.json');
      } else if (entryName.startsWith('data/')) {
        // Must be in the 9-file allowlist; data/_backups/ and unknowns are rejected.
        if (!ALL_DATA_FILES.has(entryName)) {
          aborted = true;
          reject(
            new Error(
              `Entry "${entryName}" is not allowed — only the 9 known data files are accepted`,
            ),
          );
          return;
        }
        destPath = path.join(stagingDir, entryName);
      } else if (entryName.startsWith('uploads/')) {
        // Path guard: resolve the relative portion and ensure it stays under stagingUploadsDir.
        const stagingUploadsDir = path.join(stagingDir, 'uploads');
        const relative = entryName.slice('uploads/'.length);
        if (!relative || relative.includes('..')) {
          aborted = true;
          reject(new Error(`Path traversal attempt in uploads entry: "${entryName}"`));
          return;
        }
        // Additional absolute path guard: ensure resolved path stays under stagingUploadsDir
        const resolved = path.resolve(path.join(stagingUploadsDir, relative));
        if (!resolved.startsWith(stagingUploadsDir + path.sep) && resolved !== stagingUploadsDir) {
          aborted = true;
          reject(new Error(`Path traversal attempt in uploads entry: "${entryName}"`));
          return;
        }
        destPath = resolved;
      } else {
        // Unknown top-level key — reject
        aborted = true;
        reject(
          new Error(
            `Entry "${entryName}" is not allowed — only data/, uploads/, and manifest.json entries are accepted`,
          ),
        );
        return;
      }

      // ---------- streaming decompression with chunk-level ceiling check (M-1) ----------
      const chunks: Uint8Array[] = [];
      let perFileBytes = 0;

      file.ondata = (err, chunk, final) => {
        // Early-exit after abort: a prior entry already hit a ceiling or path-guard
        // reject. Do NOT decompress further chunks — saves CPU on zip-bomb tails.
        if (aborted) {
          return;
        }
        if (err) {
          aborted = true;
          reject(err);
          return;
        }

        // Enforce ceilings at chunk level BEFORE accumulating
        perFileBytes += chunk.length;
        totalUncompressedBytes += chunk.length;

        if (perFileBytes > ceilings.perFile) {
          aborted = true;
          reject(
            new CeilingExceededError(
              `per-file decompression ceiling exceeded for "${entryName}": ${perFileBytes} bytes > ${ceilings.perFile} bytes`,
            ),
          );
          return;
        }
        if (totalUncompressedBytes > ceilings.total) {
          aborted = true;
          reject(
            new CeilingExceededError(
              `total decompression ceiling exceeded: ${totalUncompressedBytes} bytes > ${ceilings.total} bytes`,
            ),
          );
          return;
        }

        chunks.push(chunk);

        if (final && !aborted) {
          // Assemble buffer and write to staging
          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const buf = Buffer.allocUnsafe(totalLen);
          let offset = 0;
          for (const c of chunks) {
            buf.set(c, offset);
            offset += c.length;
          }

          const writePromise = (async () => {
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.writeFile(destPath, buf);
          })().catch((writeErr: unknown) => {
            if (!aborted) {
              aborted = true;
              reject(writeErr);
            }
          });
          pendingWrites.push(writePromise as Promise<void>);
        }
      };

      file.start();
    };

    // Push the entire zip body into fflate
    try {
      unzip.push(zipBody instanceof Buffer ? zipBody : Buffer.from(zipBody), true);
    } catch (err) {
      reject(err);
      return;
    }

    // Wait for all pending file writes
    Promise.all(pendingWrites).then(() => {
      if (!aborted) resolve();
    }, reject);
  });
}

// ---------------------------------------------------------------------------
// C-2: validateStagedImport — manifest + checksum + structural validators
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a staged import directory:
 * 1. Parse and validate manifest.json (presence, shape, schemaVersion).
 * 2. Verify checksums of all staged files against the manifest.
 * 3. Run per-unit structural validators for each selected unit.
 *
 * All validation occurs on STAGING files; zero live writes happen here.
 */
export async function validateStagedImport(
  stagingDir: string,
  selectedUnits: ExportUnit[],
  _projectRoot: string,
): Promise<ValidationResult> {
  // 1. Read and validate manifest.json
  const manifestPath = path.join(stagingDir, 'manifest.json');
  let manifest: BackupManifest;
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const validResult = validateManifest(parsed);
    if (!validResult.ok) {
      return { ok: false, reason: validResult.reason };
    }
    manifest = parsed as BackupManifest;
  } catch (err) {
    return {
      ok: false,
      reason: `manifest.json missing or unparseable: ${(err as Error).message}`,
    };
  }

  // 2. Collect staged files by WALKING the staging directory (not by iterating
  //    manifest.checksums keys). Walking the disk is the authoritative source of
  //    what was actually extracted; it prevents a crafted manifest key like
  //    "../../etc/passwd" from causing an arbitrary file read via path.join.
  //    Only files physically inside stagingDir are included.
  //    Key format mirrors the zip entry naming: "data/<file>.json", "uploads/..."
  const staged: Record<string, Buffer> = {};
  for await (const { relPath, absPath } of walkDir(stagingDir)) {
    // Skip manifest.json itself — it is not in checksums
    if (relPath === 'manifest.json') continue;
    // Normalize to forward-slashes (Windows safety)
    const normalizedRel = relPath.replace(/\\/g, '/');
    staged[normalizedRel] = await fs.readFile(absPath);
  }

  const checksumResult = verifyChecksums(staged, manifest);
  if (!checksumResult.ok) {
    return {
      ok: false,
      reason: `checksum verification failed for: ${(checksumResult.failed ?? []).join(', ')}`,
    };
  }

  // 3. Per-unit structural validation
  for (const unit of selectedUnits) {
    const validator = unitValidators[unit];
    if (!validator) continue;

    // Each unit maps to one or more data files; validate the primary file
    const dataFiles = UNIT_TO_DATA_FILES[unit];
    for (const dataFile of dataFiles) {
      const absPath = path.join(stagingDir, dataFile);
      let parsed: unknown;
      try {
        const raw = await fs.readFile(absPath, 'utf-8');
        parsed = JSON.parse(raw);
      } catch {
        continue; // File may not be in archive if unit partially overlaps
      }
      const result = validator(parsed);
      if (!result.ok) {
        return {
          ok: false,
          reason: `structural validation failed for unit "${unit}": ${result.reason}`,
        };
      }
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// C-3: createBackupSnapshot — copy current live state to data/_backups/<ISO>/
// ---------------------------------------------------------------------------

/**
 * Copy the current live state of the selected units to a timestamped backup dir.
 * Retention: keep the last 5 backups (prune oldest beyond that).
 *
 * - Always copies the 9 data files (unconditionally — simple and safe for restore).
 * - Copies public/uploads tree only when 'media' unit is in selectedUnits.
 */
export async function createBackupSnapshot(
  projectRoot: string,
  selectedUnits: ExportUnit[],
): Promise<string> {
  // Use ISO 8601 timestamp with colons replaced by hyphens for cross-platform
  // directory name safety (Windows does not allow colons in file names).
  // e.g. "2026-06-30T18-19-06.976Z" — still sorts lexicographically correctly.
  const iso = new Date().toISOString().replace(/:/g, '-');
  const backupsDir = path.join(projectRoot, 'data', '_backups');
  const snapshotDir = path.join(backupsDir, iso);
  const snapshotDataDir = path.join(snapshotDir, 'data');

  await fs.mkdir(snapshotDataDir, { recursive: true });

  // Copy the 9 known data files
  for (const dataFiles of Object.values(UNIT_TO_DATA_FILES)) {
    for (const dataFile of dataFiles) {
      const filename = path.basename(dataFile);
      const src = path.join(projectRoot, 'data', filename);
      const dest = path.join(snapshotDataDir, filename);
      try {
        await fs.copyFile(src, dest);
      } catch {
        // File may not exist in a fresh project — skip silently
      }
    }
  }

  // If media unit is selected, copy public/uploads tree
  if (selectedUnits.includes('media')) {
    const uploadsDir = path.join(projectRoot, 'public', 'uploads');
    const snapshotUploadsDir = path.join(snapshotDir, 'uploads');
    await copyDirRecursive(uploadsDir, snapshotUploadsDir);
  }

  // Apply retention: keep at most 5 backups (prune oldest)
  const entries = await fs.readdir(backupsDir).catch(() => [] as string[]);
  const toPrune = selectBackupsToPrune(entries, 5);
  for (const name of toPrune) {
    await fs.rm(path.join(backupsDir, name), { recursive: true, force: true });
  }

  return snapshotDir;
}

/**
 * Recursively copy a directory tree from src to dest.
 * Missing src is silently ignored.
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(src);
  } catch {
    return; // Source dir doesn't exist
  }
  await fs.mkdir(dest, { recursive: true });
  for (const name of names) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(srcPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (stat.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
    // Skip symlinks (consistent with export security posture)
  }
}

// ---------------------------------------------------------------------------
// C-4: applyImport — atomic replace per unit from staging
// ---------------------------------------------------------------------------

export interface ApplyImportResult {
  usersReplaced: boolean;
}

/**
 * Replace live data from staging using the existing atomic savers.
 * - Per-unit savers (savePages/saveSite/etc.) write atomically via writeJson
 *   (temp file + rename); they are NOT individually mutex-guarded.
 * - The users unit is the exception: bootstrap import callers hold
 *   withUsersLock across the whole pipeline run (see
 *   `_runImportPipelineCore`'s bootstrapMode branch), and handleLogin's
 *   first-user path acquires the same lock — so users.json IS
 *   lock-protected, via withUsersLock rather than withFileLock directly.
 * - For the media unit: writes the registry via data.replaceMedia (which takes
 *   withFileLock(mediaLockKey()) — a separate mutex from withUsersLock — so the
 *   whole-registry overwrite cannot lose a concurrent upload's append, per
 *   ADR-0008), then replaces the public/uploads tree.
 * - Calls handleInvalidateCache equivalent (invalidates global cache via context.cache).
 * - Returns { usersReplaced } based on whether users unit was in selectedUnits.
 *
 * Precondition: staging has been fully validated (C-2) and a backup snapshot
 * created (C-3) before this function is called.
 */
export async function applyImport(
  stagingDir: string,
  projectRoot: string,
  selectedUnits: ExportUnit[],
  context: { cache?: unknown },
): Promise<ApplyImportResult> {
  const prevRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = projectRoot;

  try {
    for (const unit of selectedUnits) {
      switch (unit) {
        case 'pages': {
          const raw = await fs.readFile(path.join(stagingDir, 'data', 'pages.json'), 'utf-8');
          await data.savePages(JSON.parse(raw));
          break;
        }
        case 'configuration': {
          // configuration maps to 5 files: site, configs, menus, redirects, languages
          const confFiles: Array<[string, (d: unknown) => Promise<void>]> = [
            ['site.json', async (d) => data.saveSite(d as Parameters<typeof data.saveSite>[0])],
            [
              'configs.json',
              async (d) => data.saveConfigs(d as Parameters<typeof data.saveConfigs>[0]),
            ],
            ['menus.json', async (d) => data.saveMenus(d as Parameters<typeof data.saveMenus>[0])],
            [
              'redirects.json',
              async (d) => data.saveRedirects(d as Parameters<typeof data.saveRedirects>[0]),
            ],
            [
              'languages.json',
              async (d) => data.saveLanguages(d as Parameters<typeof data.saveLanguages>[0]),
            ],
          ];
          for (const [filename, saver] of confFiles) {
            try {
              const raw = await fs.readFile(path.join(stagingDir, 'data', filename), 'utf-8');
              await saver(JSON.parse(raw));
            } catch (err) {
              // Swallow only ENOENT (file absent in a partial import).
              // All other errors (ENOSPC, parse error, saver failure) propagate so
              // the pipeline can attempt rollback rather than silently returning success.
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
              }
            }
          }
          break;
        }
        case 'users': {
          const raw = await fs.readFile(path.join(stagingDir, 'data', 'users.json'), 'utf-8');
          await data.saveUsers(JSON.parse(raw));
          break;
        }
        case 'media': {
          // Save media registry
          const raw = await fs.readFile(path.join(stagingDir, 'data', 'media.json'), 'utf-8');
          await data.replaceMedia(JSON.parse(raw));

          // Replace public/uploads tree atomically:
          // 1. Copy staging uploads into a temp sibling dir (minimises destructive window).
          // 2. Rename temp dir into place (atomic on same filesystem).
          // 3. Remove the old uploads dir.
          const liveUploadsDir = path.join(projectRoot, 'public', 'uploads');
          const stagingUploadsDir = path.join(stagingDir, 'uploads');
          const tempUploadsDir = liveUploadsDir + '.import-tmp';
          // Clean up any leftover temp dir from a previous failed attempt
          await fs.rm(tempUploadsDir, { recursive: true, force: true });
          // Step 1: copy staging → temp (no destructive action on live yet)
          await copyDirRecursive(stagingUploadsDir, tempUploadsDir);
          // Step 2: swap — rename live → old, then temp → live
          const oldUploadsDir = liveUploadsDir + '.import-old';
          await fs.rm(oldUploadsDir, { recursive: true, force: true });
          // Move live aside (non-destructive move; fails gracefully if absent)
          await fs.rename(liveUploadsDir, oldUploadsDir).catch(() => {
            /* live dir absent — ok */
          });
          // Promote the prepared temp dir to live
          await fs.rename(tempUploadsDir, liveUploadsDir);
          // Step 3: remove the old dir
          await fs.rm(oldUploadsDir, { recursive: true, force: true });
          // Reconcile media to prune registry/disk drift
          await data.reconcileMedia();
          break;
        }
        case 'global-blocks': {
          const raw = await fs.readFile(
            path.join(stagingDir, 'data', 'global-blocks.json'),
            'utf-8',
          );
          await data.saveGlobalBlocks(JSON.parse(raw));
          break;
        }
      }
    }

    // Invalidate cache if available
    if (
      context.cache &&
      typeof (context.cache as { enabled?: boolean }).enabled === 'boolean' &&
      (context.cache as { enabled?: boolean }).enabled
    ) {
      const { getGlobalCachePaths, getGlobalCacheTags } = await import('../utils/cache.js');
      const cacheCtx = context.cache as {
        invalidate: (opts: { path?: string; tags?: string[] }) => Promise<void>;
      };
      try {
        for (const pathname of getGlobalCachePaths()) {
          await cacheCtx.invalidate({ path: pathname });
        }
        await cacheCtx.invalidate({ tags: getGlobalCacheTags() });
      } catch {
        // Cache invalidation failure is non-fatal — log only
      }
    }

    return { usersReplaced: selectedUnits.includes('users') };
  } finally {
    if (prevRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = prevRoot;
    }
  }
}

// ---------------------------------------------------------------------------
// C-5 helper: runImportPipeline — reusable core (factored for Slice D reuse)
// ---------------------------------------------------------------------------

/**
 * Module-level import serialization lock.
 * Only one runImportPipeline may execute at a time: concurrent imports race on
 * applyImport's env mutation (process.env.ASTRO_BLOCKS_PROJECT_ROOT) and on
 * live file replacement. Chain all pipeline calls through this promise so they
 * run sequentially.
 */
let _importLock: Promise<void> = Promise.resolve();

export interface ImportPipelineOptions {
  projectRoot: string;
  ceilings: CeilingLimits;
  selectedUnits?: ExportUnit[];
  context: { cache?: unknown };
  /**
   * When true the pipeline re-checks users.length === 0 INSIDE the users
   * lock (after lock acquisition, before extraction) to close the TOCTOU
   * window between the outer gate in handleBootstrapImport and the
   * pipeline start.
   *
   * The held lock (withUsersLock) now spans the ENTIRE run — from this
   * in-lock re-check through applyImport's users write — so a concurrent
   * handleLogin first-user creation cannot interleave with any part of the
   * bootstrap pipeline while it holds the lock. No residual window remains
   * for the login-vs-bootstrap race (GitHub #25, closed via withUsersLock
   * shared between this pipeline and handleLogin). Concurrent bootstrap
   * imports racing each other still fall through to this same re-check
   * (see the B1 tests).
   */
  bootstrapMode?: boolean;
}

export interface ImportPipelineResult {
  ok: boolean;
  usersReplaced?: boolean;
  errorCode?:
    | 'empty'
    | 'corrupt'
    | 'ceiling'
    | 'validation'
    | 'apply-failed'
    | 'bootstrap-users-exist';
  reason?: string;
}

/**
 * Core import pipeline: extract → validate → backup → apply → cleanup staging.
 *
 * Serialized: concurrent calls are queued and executed one at a time.
 *
 * Factor for reuse: handleImport (C-5) and handleBootstrapImport (D-1) both call
 * this function.
 *
 * @param body        - Raw zip bytes (Buffer/Uint8Array).
 * @param opts        - Options including projectRoot, ceilings, selectedUnits, context.
 * @returns           - ImportPipelineResult with ok flag and usersReplaced indicator.
 */
export function runImportPipeline(
  body: Buffer | Uint8Array,
  opts: ImportPipelineOptions,
): Promise<ImportPipelineResult> {
  // Acquire the lock: chain our work after whatever is currently running.
  let resolveLock!: () => void;
  const nextLock = new Promise<void>((res) => {
    resolveLock = res;
  });

  const prevLock = _importLock;
  _importLock = nextLock;

  return prevLock
    .then(() => _runImportPipelineCore(body, opts))
    .finally(() => {
      resolveLock();
    });
}

async function _runImportPipelineCore(
  body: Buffer | Uint8Array,
  opts: ImportPipelineOptions,
): Promise<ImportPipelineResult> {
  const { projectRoot, ceilings, context } = opts;

  const run = async (): Promise<ImportPipelineResult> => {
    // B1 — in-lock bootstrap re-check (TOCTOU hardening).
    // This runs AFTER the users lock is acquired, closing the race window
    // between the outer gate in handleBootstrapImport and this pipeline
    // execution. Two concurrent bootstrap POSTs cannot both pass: the
    // second one will observe users written by the first inside this
    // serialized check. It also closes the race against a concurrent
    // handleLogin first-user creation (GitHub #25), since both paths now
    // share the same withUsersLock.
    if (opts.bootstrapMode) {
      const currentUsers = await data.loadUsers();
      if (currentUsers.users.length !== 0) {
        return {
          ok: false,
          errorCode: 'bootstrap-users-exist',
          reason: 'instance already has users (in-lock check)',
        };
      }
    }

    if (!body || body.length === 0) {
      return { ok: false, errorCode: 'empty', reason: 'request body is empty' };
    }

    // Create a temp staging dir under os.tmpdir() (not inside the project to avoid
    // polluting data/_backups before validation is complete)
    const stagingDir = path.join(
      (await import('node:os')).default.tmpdir(),
      `astro-import-${crypto.randomBytes(6).toString('hex')}`,
    );

    try {
      // Step 1: Extract with guards
      try {
        await extractToStaging(body, stagingDir, ceilings, projectRoot);
      } catch (err) {
        if (err instanceof CeilingExceededError) {
          return { ok: false, errorCode: 'ceiling', reason: (err as Error).message };
        }
        return { ok: false, errorCode: 'corrupt', reason: (err as Error).message };
      }

      // Determine which units to import: all units declared in the manifest
      let selectedUnits: ExportUnit[];
      if (opts.selectedUnits) {
        selectedUnits = opts.selectedUnits;
      } else {
        // Read manifest to discover available units
        try {
          const manifestRaw = await fs.readFile(path.join(stagingDir, 'manifest.json'), 'utf-8');
          const manifest = JSON.parse(manifestRaw) as BackupManifest;
          selectedUnits = manifest.units as ExportUnit[];
        } catch {
          return {
            ok: false,
            errorCode: 'corrupt',
            reason: 'could not read manifest from staging',
          };
        }
      }

      // Step 2: Validate (manifest + checksums + structural)
      const validationResult = await validateStagedImport(stagingDir, selectedUnits, projectRoot);
      if (!validationResult.ok) {
        return { ok: false, errorCode: 'validation', reason: validationResult.reason };
      }

      // Step 3: Backup snapshot BEFORE any live writes (FIX 5b: used for rollback on apply failure)
      const snapshotDir = await createBackupSnapshot(projectRoot, selectedUnits);

      // Step 4: Atomic replace per unit — with rollback on failure
      try {
        const applyResult = await applyImport(stagingDir, projectRoot, selectedUnits, context);
        return { ok: true, usersReplaced: applyResult.usersReplaced };
      } catch (applyErr) {
        // Attempt rollback from the snapshot just created
        try {
          await _rollbackFromSnapshot(snapshotDir, projectRoot, selectedUnits);
        } catch {
          // Rollback failure is non-fatal here — return the original apply error
        }
        return {
          ok: false,
          errorCode: 'apply-failed',
          reason: `apply failed: ${(applyErr as Error).message}`,
        };
      }
    } finally {
      // Always cleanup staging dir (success AND failure paths)
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  };

  // SAME-MICROTASK INVARIANT (GitHub #25 — do not break on refactor): this
  // call MUST happen with ZERO awaits between _runImportPipelineCore's
  // entry and here, so withUsersLock's key (getDataPath('users.json'),
  // read from the ambient ASTRO_BLOCKS_PROJECT_ROOT) is captured against
  // the SAME ambient root that opts.projectRoot was resolved from,
  // synchronously, at handleBootstrapImport's call site. Verified in the
  // apply phase's T0 risk check — see design doc D1/D3.
  //
  // Non-bootstrap imports (bootstrapMode falsy) never acquire the users
  // lock, so authenticated imports keep their existing latency profile.
  return opts.bootstrapMode ? data.withUsersLock(run) : run();
}

/**
 * Attempt to roll back live data by restoring from a snapshot directory.
 * Best-effort: errors are surfaced to the caller (which logs and swallows them).
 *
 * Exported for direct unit testing; do NOT call from outside the import pipeline.
 */
export async function _rollbackFromSnapshot(
  snapshotDir: string,
  projectRoot: string,
  selectedUnits: ExportUnit[],
): Promise<void> {
  const snapshotDataDir = path.join(snapshotDir, 'data');
  const liveDataDir = path.join(projectRoot, 'data');

  // Restore data files
  let snapshotFiles: string[];
  try {
    snapshotFiles = await fs.readdir(snapshotDataDir);
  } catch {
    return;
  }
  for (const filename of snapshotFiles) {
    const src = path.join(snapshotDataDir, filename);
    const dest = path.join(liveDataDir, filename);
    try {
      await fs.copyFile(src, dest);
    } catch {
      // Best effort
    }
  }

  // Restore uploads if media unit was selected
  if (selectedUnits.includes('media')) {
    const snapshotUploadsDir = path.join(snapshotDir, 'uploads');
    const liveUploadsDir = path.join(projectRoot, 'public', 'uploads');
    try {
      await fs.rm(liveUploadsDir, { recursive: true, force: true });
      await copyDirRecursive(snapshotUploadsDir, liveUploadsDir);
    } catch {
      // Best effort
    }
  }
}
