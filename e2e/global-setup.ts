/**
 * Global setup for the e2e suite.
 *
 * Copies the .astro-blocks/ directory (schema-map.mjs, runtime.mjs) from the
 * playground build output into .e2e-data/ so the standalone server can find
 * block schemas while using the isolated data directory.
 *
 * This must run after `npm run build:playground` and before any test.
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const PLAYGROUND_DIR = path.join(REPO_ROOT, 'playgrounds', 'basic');
const E2E_DATA_DIR = path.join(REPO_ROOT, '.e2e-data');

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const src = path.join(PLAYGROUND_DIR, '.astro-blocks');
  const dest = path.join(E2E_DATA_DIR, '.astro-blocks');

  if (!fs.existsSync(src)) {
    throw new Error(
      `Playground .astro-blocks not found at ${src}. Run "npm run build:playground" first.`,
    );
  }

  // Ensure the e2e-data directory exists
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });

  // Wipe the isolated data directory so each run starts from a clean slate
  // (no pre-existing users, pages, etc.). The first login will recreate the owner.
  const dataDir = path.join(E2E_DATA_DIR, 'data');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  // Remove stale copy and re-copy from playground
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}
