/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/** Default per-file decompression ceiling: 50 MB */
export const DEFAULT_MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

/** Default total uncompressed ceiling: 500 MB */
export const DEFAULT_MAX_IMPORT_TOTAL_BYTES = 500 * 1024 * 1024;

/** Default compressed body ceiling: 1 GB */
export const DEFAULT_MAX_IMPORT_COMPRESSED_BYTES = 1024 * 1024 * 1024;

export interface CeilingLimits {
  perFile: number;
  total: number;
  /** Maximum allowed compressed request body size in bytes (before decompression). */
  compressed: number;
}

/**
 * Custom error thrown when a decompression ceiling is exceeded.
 */
export class CeilingExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CeilingExceededError';
  }
}

/**
 * Given a list of backup directory names (ISO-sortable strings) and a retention count,
 * returns the names that should be pruned (oldest ones beyond `keep`).
 * Sorts ascending by name (ISO timestamps sort lexicographically).
 */
export function selectBackupsToPrune(dirNames: string[], keep: number): string[] {
  // Clamp keep to a minimum of 1 so we never select everything for deletion.
  const effectiveKeep = keep < 1 ? 1 : keep;
  if (dirNames.length <= effectiveKeep) return [];
  const sorted = [...dirNames].sort(); // ISO names sort correctly lexicographically
  return sorted.slice(0, sorted.length - effectiveKeep);
}

/**
 * Asserts that the given per-file and total byte counts are within the provided limits.
 * Throws CeilingExceededError with a descriptive message if a ceiling is exceeded.
 */
export function assertWithinCeilings(
  perFileBytes: number,
  totalBytes: number,
  limits: CeilingLimits,
): void {
  if (perFileBytes > limits.perFile) {
    throw new CeilingExceededError(
      `per-file decompression ceiling exceeded: ${perFileBytes} bytes > ${limits.perFile} bytes`,
    );
  }
  if (totalBytes > limits.total) {
    throw new CeilingExceededError(
      `total decompression ceiling exceeded: ${totalBytes} bytes > ${limits.total} bytes`,
    );
  }
}

/**
 * Parses a raw env var string to a positive integer.
 * Returns `defaultValue` if the string is absent, non-numeric (NaN), zero, or negative.
 */
function parseCeilingEnvVar(raw: string | undefined, defaultValue: number): number {
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/**
 * Reads the decompression and compressed-body ceiling env vars and returns their values.
 * Env var names are locked (do not rename):
 *   ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES        (default: 50 MB)
 *   ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES       (default: 500 MB)
 *   ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES  (default: 1 GB)
 */
export function readCeilingEnvVars(): CeilingLimits {
  const perFile = parseCeilingEnvVar(
    process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'],
    DEFAULT_MAX_IMPORT_FILE_BYTES,
  );
  const total = parseCeilingEnvVar(
    process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'],
    DEFAULT_MAX_IMPORT_TOTAL_BYTES,
  );
  const compressed = parseCeilingEnvVar(
    process.env['ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES'],
    DEFAULT_MAX_IMPORT_COMPRESSED_BYTES,
  );
  return { perFile, total, compressed };
}
