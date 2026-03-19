import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { getLanguages } from '../dist/utils/getLanguages.js';

test('getLanguages returns enabled languages by default and exposes defaultLocale', async () => {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-get-languages-'));

  try {
    const dataDir = path.join(tempRoot, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'languages.json'),
      JSON.stringify({
        languages: [
          { code: 'es', label: 'Español', enabled: true, isDefault: true },
          { code: 'en', label: 'English', enabled: true, isDefault: false },
          { code: 'ca', label: 'Català', enabled: false, isDefault: false },
        ],
      }),
      'utf-8'
    );

    process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

    const enabled = await getLanguages();
    assert.equal(enabled.defaultLocale, 'es');
    assert.deepEqual(
      enabled.languages.map((entry) => entry.code),
      ['es', 'en']
    );

    const all = await getLanguages({ enabledOnly: false });
    assert.deepEqual(
      all.languages.map((entry) => entry.code),
      ['es', 'en', 'ca']
    );
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

