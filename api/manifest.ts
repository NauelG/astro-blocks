/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATA_SCHEMA_VERSION } from './schema-version.js';
import type { BackupManifest, ExportUnit } from '../types/index.js';

export type { BackupManifest, ExportUnit };

const require = createRequire(import.meta.url);

/**
 * Mapping of ExportUnit to the data file paths it covers (relative to data/).
 * This is the 5-unit → 9-file allowlist.
 * data/_backups/ is intentionally excluded.
 */
export const UNIT_TO_DATA_FILES: Record<ExportUnit, string[]> = {
  pages: ['data/pages.json'],
  media: ['data/media.json'],
  users: ['data/users.json'],
  configuration: [
    'data/site.json',
    'data/configs.json',
    'data/menus.json',
    'data/redirects.json',
    'data/languages.json',
  ],
  'global-blocks': ['data/global-blocks.json'],
};

/** All 9 allowed data file paths (for allowlist validation on import). */
export const ALL_DATA_FILES = new Set<string>(
  Object.values(UNIT_TO_DATA_FILES).flat(),
);

function readPackageVersion(): string {
  try {
    // At runtime the package.json is at dist/package.json, resolved relative to this module.
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Builds a BackupManifest from the given units, counts, and checksums.
 */
export function buildManifest(
  units: ExportUnit[],
  counts: Partial<Record<ExportUnit, number>>,
  checksums: Record<string, string>,
): BackupManifest {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    astroBlocksVersion: readPackageVersion(),
    exportedAt: new Date().toISOString(),
    units,
    counts,
    checksums,
  };
}

/**
 * Validates a raw (unknown) object as a BackupManifest.
 * Returns { ok: true } on success, or { ok: false, reason } on failure.
 */
export function validateManifest(obj: unknown): { ok: boolean; reason?: string } {
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, reason: 'manifest must be a non-null object' };
  }
  const m = obj as Record<string, unknown>;

  if (typeof m['schemaVersion'] !== 'number') {
    return { ok: false, reason: 'schemaVersion is missing or not a number' };
  }
  if (m['schemaVersion'] !== DATA_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `version mismatch: archive has schemaVersion ${m['schemaVersion']}, expected ${DATA_SCHEMA_VERSION}`,
    };
  }
  if (typeof m['astroBlocksVersion'] !== 'string' || !m['astroBlocksVersion']) {
    return { ok: false, reason: 'astroBlocksVersion is missing or empty' };
  }
  if (typeof m['exportedAt'] !== 'string' || !m['exportedAt']) {
    return { ok: false, reason: 'exportedAt is missing or empty' };
  }
  if (!Array.isArray(m['units'])) {
    return { ok: false, reason: 'units must be an array' };
  }
  // Validate every units element is a known ExportUnit.
  const knownUnits = new Set<string>(Object.keys(UNIT_TO_DATA_FILES));
  for (const unit of m['units'] as unknown[]) {
    if (typeof unit !== 'string' || !knownUnits.has(unit)) {
      return { ok: false, reason: `unknown unit "${unit}" — must be one of: ${[...knownUnits].join(', ')}` };
    }
  }
  if (typeof m['counts'] !== 'object' || m['counts'] === null) {
    return { ok: false, reason: 'counts must be an object' };
  }
  if (typeof m['checksums'] !== 'object' || m['checksums'] === null || Array.isArray(m['checksums'])) {
    return { ok: false, reason: 'checksums must be a non-null object' };
  }
  // Validate every checksums KEY and VALUE.
  // Keys must be either a known data file (data/<name>.json from the 9-file allowlist)
  // or an uploads/ path. Keys containing ".." or absolute paths are rejected immediately
  // as a defense-in-depth measure against crafted manifests that could cause arbitrary
  // file reads in validateStagedImport.
  for (const [entryPath, hash] of Object.entries(m['checksums'] as Record<string, unknown>)) {
    if (typeof hash !== 'string' || hash === '') {
      return { ok: false, reason: `checksums entry "${entryPath}" must be a non-empty string` };
    }
    // Reject absolute paths and path traversal sequences
    if (path.isAbsolute(entryPath) || entryPath.includes('..')) {
      return {
        ok: false,
        reason: `checksums key "${entryPath}" contains a path traversal or absolute path — not allowed`,
      };
    }
    // Key must be in the data/ allowlist OR start with uploads/
    if (!ALL_DATA_FILES.has(entryPath) && !entryPath.startsWith('uploads/')) {
      return {
        ok: false,
        reason: `checksums key "${entryPath}" is not an allowed path — must be a known data file or start with uploads/`,
      };
    }
  }
  return { ok: true };
}

/**
 * Computes the SHA-256 hex digest of the given bytes.
 */
export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Verifies that staged file contents match checksums in the manifest.
 * Returns { ok: true } if all match, or { ok: false, failed: string[] } listing mismatches.
 */
export function verifyChecksums(
  staged: Record<string, Buffer>,
  manifest: BackupManifest,
): { ok: boolean; failed?: string[] } {
  const failed: string[] = [];
  for (const [entryPath, expectedHash] of Object.entries(manifest.checksums)) {
    const fileBytes = staged[entryPath];
    if (!fileBytes) {
      failed.push(entryPath);
      continue;
    }
    const actualHash = sha256Hex(fileBytes);
    if (actualHash !== expectedHash) {
      failed.push(entryPath);
    }
  }
  // Second pass: any staged path not present in manifest.checksums is an injection attempt.
  for (const stagedPath of Object.keys(staged)) {
    if (!(stagedPath in manifest.checksums)) {
      failed.push(stagedPath);
    }
  }
  if (failed.length > 0) {
    return { ok: false, failed };
  }
  return { ok: true };
}
