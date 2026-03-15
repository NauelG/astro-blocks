import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve project root (where astro.config lives). Defaults to cwd. */
export function getProjectRoot() {
  return process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
}

/** Path to data directory (project root / data) */
export function getDataDir() {
  return path.join(getProjectRoot(), 'data');
}

/** Path to public uploads directory */
export function getUploadsDir() {
  return path.join(getProjectRoot(), 'public', 'uploads');
}

/** Directory of the astro-blocks package (for resolving routes inside the package) */
export function getCmsDir() {
  return path.resolve(__dirname, '..');
}

export function getDataPath(filename) {
  return path.join(getDataDir(), filename);
}
