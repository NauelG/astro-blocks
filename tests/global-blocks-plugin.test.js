/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateGlobalBlocks, generateRuntime } from '../dist/plugin/index.js';

// Minimal valid schema with __componentPath set
function makeSchema(name, componentPath) {
  return {
    name,
    items: {},
    __componentPath: componentPath ?? `/fake/${name}.astro`,
  };
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-plugin-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

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

test('validateGlobalBlocks throws on duplicate slug with slug name in message', () => {
  const declarations = [
    { slug: 'header', schema: makeSchema('Header'), label: 'Header' },
    { slug: 'footer', schema: makeSchema('Footer'), label: 'Footer' },
    { slug: 'header', schema: makeSchema('Header2'), label: 'Header Again' },
  ];

  assert.throws(
    () => validateGlobalBlocks(declarations),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('header'), `expected "header" in: ${err.message}`);
      return true;
    }
  );
});

test('validateGlobalBlocks throws on slug failing regex', () => {
  const invalidSlugs = ['Header', 'my slug', '-bad', '123_foo', 'CAPS'];

  for (const slug of invalidSlugs) {
    assert.throws(
      () => validateGlobalBlocks([{ slug, schema: makeSchema('X'), label: 'Test' }]),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(slug), `expected "${slug}" in: ${err.message}`);
        return true;
      },
      `expected throw for invalid slug: "${slug}"`
    );
  }
});

test('validateGlobalBlocks throws when schema is missing __componentPath (SCEN-3b)', () => {
  const declarations = [
    { slug: 'header', schema: { name: 'Header', items: {} } /* no __componentPath */ },
  ];

  assert.throws(
    () => validateGlobalBlocks(declarations),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('__componentPath') || err.message.includes('componentPath') || err.message.includes('defineBlockSchema'),
        `expected componentPath reference in: ${err.message}`
      );
      return true;
    }
  );
});

test('validateGlobalBlocks does not throw on valid config with schemas', () => {
  const declarations = [
    { slug: 'header', schema: makeSchema('Header'), label: 'Header' },
    { slug: 'footer', schema: makeSchema('Footer'), label: 'Footer' },
    { slug: 'hero-banner', schema: makeSchema('HeroBanner') },
  ];

  assert.doesNotThrow(() => validateGlobalBlocks(declarations));
});

test('validateGlobalBlocks does not throw on empty array', () => {
  assert.doesNotThrow(() => validateGlobalBlocks([]));
});

test('generateRuntime emits globalBlocksRegistry with schemaName and componentPath', async () => {
  await withTempProject(async (tempRoot) => {
    const options = {
      blocks: [],
      globalBlocks: [
        { slug: 'site-header', schema: makeSchema('GlobalHeader', '/fake/GlobalHeader.astro'), label: 'Header' },
        { slug: 'site-footer', schema: makeSchema('GlobalFooter', '/fake/GlobalFooter.astro') },
      ],
    };

    await generateRuntime(tempRoot, options);

    const runtimePath = path.join(tempRoot, '.astro-blocks', 'runtime.mjs');
    const content = await fs.readFile(runtimePath, 'utf-8');

    assert.ok(
      content.includes('export const globalBlocksRegistry'),
      `runtime.mjs should export globalBlocksRegistry, got:\n${content}`
    );
    assert.ok(content.includes('"site-header"'), 'registry should include site-header slug');
    assert.ok(content.includes('"site-footer"'), 'registry should include site-footer slug');
    assert.ok(content.includes('"GlobalHeader"') || content.includes('schemaName'), 'registry should include schemaName');
    assert.ok(content.includes('"Header"'), 'registry should include label for Header');
  });
});

test('generateRuntime includes global block schemas in schemaMap and componentMap', async () => {
  await withTempProject(async (tempRoot) => {
    const options = {
      blocks: [],
      globalBlocks: [
        { slug: 'site-header', schema: makeSchema('GlobalHeader', '/fake/GlobalHeader.astro'), label: 'Header' },
      ],
    };

    await generateRuntime(tempRoot, options);

    const runtimePath = path.join(tempRoot, '.astro-blocks', 'runtime.mjs');
    const content = await fs.readFile(runtimePath, 'utf-8');

    // schemaMap should contain GlobalHeader
    assert.ok(content.includes('"GlobalHeader"'), 'schemaMap should contain GlobalHeader schema key');
    // componentMap should reference GlobalHeader
    assert.ok(content.includes('GlobalHeader'), 'componentMap should include GlobalHeader');
  });
});

test('generateRuntime writes empty globalBlocksRegistry when no globalBlocks declared', async () => {
  await withTempProject(async (tempRoot) => {
    const options = { blocks: [] };

    await generateRuntime(tempRoot, options);

    const runtimePath = path.join(tempRoot, '.astro-blocks', 'runtime.mjs');
    const content = await fs.readFile(runtimePath, 'utf-8');

    assert.ok(
      content.includes('export const globalBlocksRegistry = []'),
      `runtime.mjs should export empty globalBlocksRegistry, got:\n${content}`
    );
  });
});
