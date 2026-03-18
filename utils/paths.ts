/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve project root (where astro.config lives). Defaults to cwd. */
export function getProjectRoot(): string {
  return process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
}

/** Path to data directory (project root / data). */
export function getDataDir(): string {
  return path.join(getProjectRoot(), 'data');
}

/** Path to public uploads directory. */
export function getUploadsDir(): string {
  return path.join(getProjectRoot(), 'public', 'uploads');
}

/** Directory of the astro-blocks package (for resolving routes inside the package). */
export function getCmsDir(): string {
  return path.resolve(__dirname, '..');
}

export function getDataPath(filename: string): string {
  return path.join(getDataDir(), filename);
}

/**
 * Resolve an upload URL or pathname (e.g. "/uploads/2025/03/abc.jpg") to a safe
 * filesystem path under the uploads directory.
 */
export function resolveUploadPath(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const normalized = url.replace(/\/+/g, '/').replace(/^\//, '');
  if (!normalized.startsWith('uploads/')) return null;

  const relative = normalized.slice('uploads/'.length);
  if (relative.includes('..')) return null;

  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(path.join(uploadsDir, relative));
  if (!resolved.startsWith(uploadsDir)) return null;

  return resolved;
}
