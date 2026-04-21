/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadGlobalBlocks, saveGlobalBlock, saveGlobalBlocks } from '../dist/api/data.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-global-blocks-'));

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

test('ensureDefaultFiles creates global-blocks.json with empty globalBlocks', async () => {
  await withTempProject(async (tempRoot) => {
    const filePath = path.join(tempRoot, 'data', 'global-blocks.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    assert.deepEqual(data, { globalBlocks: {} });
  });
});

test('loadGlobalBlocks returns { globalBlocks: {} } on empty file', async () => {
  await withTempProject(async () => {
    const data = await loadGlobalBlocks();

    assert.deepEqual(data, { globalBlocks: {} });
  });
});

test('saveGlobalBlock round-trips props for a slug', async () => {
  await withTempProject(async () => {
    const props = { title: { en: 'Hello' }, subtitle: 'World' };
    await saveGlobalBlock('header', props);

    const data = await loadGlobalBlocks();
    assert.ok(data.globalBlocks['header'], 'header entry should exist');
    assert.deepEqual(data.globalBlocks['header'].props, props);
    assert.ok(typeof data.globalBlocks['header'].updatedAt === 'string', 'updatedAt should be a string');
  });
});

test('saveGlobalBlock preserves other slugs when saving one', async () => {
  await withTempProject(async () => {
    const footerProps = { copyright: '2026' };
    const headerProps = { title: 'My Site' };

    await saveGlobalBlock('footer', footerProps);
    await saveGlobalBlock('header', headerProps);

    const data = await loadGlobalBlocks();
    assert.deepEqual(data.globalBlocks['footer'].props, footerProps);
    assert.deepEqual(data.globalBlocks['header'].props, headerProps);
  });
});

test('saveGlobalBlocks replaces entire dataset', async () => {
  await withTempProject(async () => {
    const payload = {
      globalBlocks: {
        header: { props: { title: 'My Site' }, updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    };
    await saveGlobalBlocks(payload);

    const data = await loadGlobalBlocks();
    assert.deepEqual(data, payload);
  });
});

test('loadGlobalBlocks normalises legacy entry { blocks: [...] } to { props: {} }', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed legacy v1 data directly
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
    assert.equal(data.globalBlocks['header'].updatedAt, '2026-01-01T00:00:00.000Z', 'updatedAt preserved from legacy');
  });
});
