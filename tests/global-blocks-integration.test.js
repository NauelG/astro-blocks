/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadGlobalBlocks, saveGlobalBlock, saveLanguages } from '../dist/api/data.js';
import { handlePutGlobalBlock, handleGetGlobalBlock } from '../dist/api/handlers.js';

async function seedMultiLanguage() {
  await saveLanguages({
    languages: [
      { code: 'es', label: 'Español', enabled: true, isDefault: true },
      { code: 'en', label: 'English', enabled: true, isDefault: false },
    ],
  });
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-gb-integration-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

// v2 registry shape
const REGISTRY = [{ slug: 'header', schemaName: 'Header', componentPath: '/fake/Header.astro', label: 'Header' }];

async function seedSchemaMap(tempRoot, schemaMap) {
  const dir = path.join(tempRoot, '.astro-blocks');
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '};',
  ];
  await fs.writeFile(path.join(dir, 'schema-map.mjs'), lines.join('\n'), 'utf-8');
}

test('PUT → loadGlobalBlocks round-trip persists props correctly', async () => {
  await withTempProject(async (tempRoot) => {
    await seedMultiLanguage();
    await seedSchemaMap(tempRoot, {
      Header: {
        name: 'Header',
        items: { title: { type: 'string', label: 'Title', localizable: true } },
      },
    });

    const props = { title: { en: 'Welcome', es: 'Bienvenido' } };

    const putResponse = await handlePutGlobalBlock(
      'header',
      new Request('http://localhost/cms/api/global-blocks/header', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ props }),
      }),
      {},
      REGISTRY
    );

    assert.equal(putResponse.status, 200);

    const stored = await loadGlobalBlocks();
    assert.ok(stored.globalBlocks['header'], 'header entry should exist');
    assert.deepEqual(stored.globalBlocks['header'].props, props);
    assert.ok(typeof stored.globalBlocks['header'].updatedAt === 'string', 'updatedAt should be set');
  });
});

test('orphan slug in data file is silently ignored in GET response', async () => {
  await withTempProject(async () => {
    await saveGlobalBlock('old-removed-slug', { old: 'data' });

    const getResponse = await handleGetGlobalBlock('old-removed-slug', REGISTRY);
    assert.equal(getResponse.status, 404, 'orphan slug should return 404 from handler');
  });
});

test('locale-structured props are preserved as-is in storage (no locale projection in handler)', async () => {
  await withTempProject(async (tempRoot) => {
    await seedMultiLanguage();
    await seedSchemaMap(tempRoot, {
      Header: {
        name: 'Header',
        items: { title: { type: 'string', label: 'Title', localizable: true } },
      },
    });

    const props = { title: { en: 'Hello', es: 'Hola' } };

    await handlePutGlobalBlock(
      'header',
      new Request('http://localhost/cms/api/global-blocks/header', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ props }),
      }),
      {},
      REGISTRY
    );

    const stored = await loadGlobalBlocks();
    assert.deepEqual(
      stored.globalBlocks['header'].props.title,
      { en: 'Hello', es: 'Hola' },
      'locale map should be preserved in storage'
    );
  });
});

test('loadGlobalBlocks normalizes legacy { blocks: [...] } entry to { props: {} } end-to-end', async () => {
  await withTempProject(async (tempRoot) => {
    const legacyData = {
      globalBlocks: {
        header: { blocks: [{ type: 'Hero', props: { title: 'Hello' } }], updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    };
    const filePath = path.join(tempRoot, 'data', 'global-blocks.json');
    await fs.writeFile(filePath, JSON.stringify(legacyData), 'utf-8');

    const data = await loadGlobalBlocks();
    assert.ok(data.globalBlocks['header'], 'header entry should exist');
    assert.deepEqual(data.globalBlocks['header'].props, {}, 'legacy blocks entry should normalize to empty props');
  });
});

test('package.json exports map includes ./components/GlobalBlock entry', async () => {
  const pkgPath = new URL('../package.json', import.meta.url);
  const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgRaw);

  assert.ok(
    pkg.exports['./components/GlobalBlock'],
    'package.json exports should have ./components/GlobalBlock'
  );

  const entry = pkg.exports['./components/GlobalBlock'];
  assert.ok(entry.import, 'export entry should have import field');
});

test('GlobalBlock.astro dist file exists after build', async () => {
  const distPath = new URL('../dist/components/GlobalBlock.astro', import.meta.url);
  try {
    await fs.access(distPath);
  } catch {
    assert.fail('dist/components/GlobalBlock.astro does not exist — component was not built');
  }
});

test('GlobalBlock.astro dist source uses single-instance render (no entry.blocks iteration)', async () => {
  const distPath = new URL('../dist/components/GlobalBlock.astro', import.meta.url);
  const source = await fs.readFile(distPath, 'utf-8');

  // v2: must NOT iterate entry.blocks
  assert.ok(!source.includes('entry.blocks'), 'v2 component must not reference entry.blocks array');
  assert.ok(!source.includes('entry?.blocks'), 'v2 component must not reference entry?.blocks array');

  // v2: must use globalBlocksRegistry for slug lookup
  assert.ok(source.includes('globalBlocksRegistry'), 'v2 component must import and use globalBlocksRegistry');
});

test('GlobalBlock.astro dist source uses props-based render (entry.props or entry?.props)', async () => {
  const distPath = new URL('../dist/components/GlobalBlock.astro', import.meta.url);
  const source = await fs.readFile(distPath, 'utf-8');

  // v2: must use entry.props / entry?.props for localization
  assert.ok(
    source.includes('entry?.props') || source.includes('entry.props'),
    'v2 component must use entry.props (not entry.blocks) for localization'
  );
});
