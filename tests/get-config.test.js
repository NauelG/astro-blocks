/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { getConfig, getConfigMap } from '../dist/utils/getConfig.js';

test('getConfig reads values case-insensitively and getConfigMap returns all entries', async () => {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-get-config-'));

  try {
    const dataDir = path.join(tempRoot, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'configs.json'),
      JSON.stringify({
        configs: [
          { id: 'c1', key: 'GOOGLE_MAPS_API_KEY', value: 'maps-key' },
          { id: 'c2', key: 'Form_Recipient', value: 'forms@example.com', description: 'Forms inbox' },
        ],
      }),
      'utf-8'
    );

    process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

    assert.equal(await getConfig('google_maps_api_key'), 'maps-key');
    assert.equal(await getConfig('FORM_RECIPIENT'), 'forms@example.com');
    assert.equal(await getConfig('MISSING_KEY'), undefined);

    const map = await getConfigMap();
    assert.deepEqual(map, {
      GOOGLE_MAPS_API_KEY: 'maps-key',
      Form_Recipient: 'forms@example.com',
    });
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
