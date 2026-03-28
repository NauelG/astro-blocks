/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { readAndValidateFeaturesManifest } from './features-manifest.mjs';

try {
  const { manifest, manifestPath } = await readAndValidateFeaturesManifest();
  console.log(`Features manifest is valid: ${manifestPath} (${manifest.features.length} features)`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
