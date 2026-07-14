/**
 * Global setup for the e2e suite.
 *
 * Wipes the isolated data directory so every run starts from a clean slate.
 *
 * It deliberately does NOT place `.astro-blocks/` next to the standalone server.
 * That gitignored build artifact is absent on a deployed server, so the e2e run
 * must be absent it too — otherwise the suite proves the CMS works in a world
 * that does not exist. Both generated registries are baked into the bundle at
 * build time (`vite.define`); the filesystem is a dev/test seam, never a
 * resolution strategy. See ADR-0009 and ADR-0025.
 *
 * A previous version copied the artifact in "so the standalone server can find
 * block schemas" — which is exactly the defect #101 reported, hidden by the
 * harness that was supposed to catch it. Do not reintroduce the copy.
 *
 * This must run after `npm run build:playground` and before any test.
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const E2E_DATA_DIR = path.join(REPO_ROOT, '.e2e-data');

export default async function globalSetup(_config: FullConfig): Promise<void> {
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });

  // Wipe the isolated data directory so each run starts from a clean slate
  // (no pre-existing users, pages, etc.). The first login will recreate the owner.
  const dataDir = path.join(E2E_DATA_DIR, 'data');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  // Remove any stale artifact left behind by an older harness (see header).
  const staleArtifact = path.join(E2E_DATA_DIR, '.astro-blocks');
  if (fs.existsSync(staleArtifact)) {
    fs.rmSync(staleArtifact, { recursive: true, force: true });
  }
}
