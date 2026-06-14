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
 * Build the filename for a responsive image variant.
 * Strips the extension from the original filename, appends `-<w>.<format>`.
 *
 * Example: buildVariantFilename('ab12-photo.jpg', 800, 'webp') → 'ab12-photo-800.webp'
 */
export function buildVariantFilename(originalFilename: string, width: number, format: string): string {
  const ext = path.extname(originalFilename);
  const base = ext ? originalFilename.slice(0, -ext.length) : originalFilename;
  return `${base}-${width}.${format}`;
}

/**
 * Derive the URL for a responsive image variant from the original upload URL.
 * Keeps the same directory, applying the variant filename convention.
 *
 * Example: variantUrlFor('/uploads/2026/06/ab12-photo.jpg', 800, 'webp')
 *          → '/uploads/2026/06/ab12-photo-800.webp'
 */
export function variantUrlFor(originalUrl: string, width: number, format: string): string {
  // Normalize slashes, remove trailing slash
  const normalized = originalUrl.replace(/\/+/g, '/').replace(/\/$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const variantFilename = buildVariantFilename(filename, width, format);
  return dir ? `${dir}/${variantFilename}` : variantFilename;
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
  if (resolved !== uploadsDir && !resolved.startsWith(uploadsDir + path.sep)) return null;

  return resolved;
}
