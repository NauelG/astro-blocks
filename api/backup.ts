/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * api/backup.ts — Export service for streaming zip archives.
 *
 * Implements ADR-4: buildExportStream enumerates only the 9-file allowlist
 * (UNIT_TO_DATA_FILES) and, for the media unit, also includes the
 * public/uploads tree as `uploads/...` entries.
 *
 * Checksums (sha256) are computed for every entry; manifest.json is written
 * LAST so its checksums map is complete.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ZipDeflate } from 'fflate';
import { fflateZipToReadableStream } from './backup-stream.js';
import { UNIT_TO_DATA_FILES, buildManifest, sha256Hex } from './manifest.js';
import type { ExportUnit } from './manifest.js';
import { getDataPath, getUploadsDir } from '../utils/paths.js';

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
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absPath);
    } catch {
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

  // Resolve the project root (allows injection for tests)
  const root = projectRoot ?? (process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd());

  // Collect all data file entries synchronously before starting the stream.
  // We need the bytes to compute checksums before building the manifest.
  const dataEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const uploadsEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const counts: Partial<Record<ExportUnit, number>> = {};

  for (const unit of units) {
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
  const manifest = buildManifest(units, counts, checksums);
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
