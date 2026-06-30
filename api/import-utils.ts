/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/** Default per-file decompression ceiling: 50 MB */
export const DEFAULT_MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

/** Default total uncompressed ceiling: 500 MB */
export const DEFAULT_MAX_IMPORT_TOTAL_BYTES = 500 * 1024 * 1024;

export interface CeilingLimits {
  perFile: number;
  total: number;
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
  if (dirNames.length <= keep) return [];
  const sorted = [...dirNames].sort(); // ISO names sort correctly lexicographically
  return sorted.slice(0, sorted.length - keep);
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
 * Reads the decompression ceiling env vars and returns their values.
 * Env var names are locked (do not rename):
 *   ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES  (default: 50 MB)
 *   ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES (default: 500 MB)
 */
export function readCeilingEnvVars(): CeilingLimits {
  const perFile = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES']
    ? parseInt(process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'], 10)
    : DEFAULT_MAX_IMPORT_FILE_BYTES;
  const total = process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES']
    ? parseInt(process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'], 10)
    : DEFAULT_MAX_IMPORT_TOTAL_BYTES;
  return { perFile, total };
}
