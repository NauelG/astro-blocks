/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';

import { validateFeaturesManifest } from '../scripts/features-manifest.mjs';

test('build output includes a valid dist/meta/features.json manifest', async () => {
  const manifestPath = path.join(process.cwd(), 'dist', 'meta', 'features.json');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);

  const errors = validateFeaturesManifest(manifest);
  assert.equal(errors.length, 0, `features manifest should be valid:\n${errors.join('\n')}`);

  assert.ok(Array.isArray(manifest.features), 'features must be an array');
  assert.ok(manifest.features.length > 0, 'features must not be empty');
});
