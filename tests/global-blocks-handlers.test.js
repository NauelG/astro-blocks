/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, saveGlobalBlock, saveLanguages } from '../dist/api/data.js';
import {
  handleGetGlobalBlocks,
  handleGetGlobalBlock,
  handlePutGlobalBlock,
} from '../dist/api/handlers.js';

function getReq(slug, locale) {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return new Request(`http://localhost/cms/api/global-blocks${slug ? `/${slug}` : ''}${query}`);
}

function putReq(slug, body) {
  return new Request(`http://localhost/cms/api/global-blocks/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-gb-handlers-'));

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

// v2 runtime registry shape: { slug, schemaName, componentPath, label? }
const REGISTRY = [
  { slug: 'header', schemaName: 'Header', componentPath: '/fake/Header.astro', label: 'Header' },
  { slug: 'footer', schemaName: 'Footer', componentPath: '/fake/Footer.astro', label: 'Footer' },
];

// Seed a minimal schema-map.mjs in the tempRoot .astro-blocks dir for handler PUT validation
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

test('handleGetGlobalBlocks returns all registered slugs with empty props on fresh project', async () => {
  await withTempProject(async () => {
    const response = await handleGetGlobalBlocks(REGISTRY, getReq());
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(body.globalBlocks, 'response should have globalBlocks key');
    assert.deepEqual(body.globalBlocks['header'], { props: {} });
    assert.deepEqual(body.globalBlocks['footer'], { props: {} });
  });
});

test('handleGetGlobalBlocks silently ignores orphan slugs in data file', async () => {
  await withTempProject(async () => {
    await saveGlobalBlock('orphan', { old: 'data' });

    const response = await handleGetGlobalBlocks(REGISTRY, getReq());
    const body = await response.json();

    assert.equal(Object.hasOwn(body.globalBlocks, 'orphan'), false, 'orphan slug should be excluded');
    assert.ok(Object.hasOwn(body.globalBlocks, 'header'));
    assert.ok(Object.hasOwn(body.globalBlocks, 'footer'));
  });
});

test('handleGetGlobalBlock returns 200 with props for registered slug', async () => {
  await withTempProject(async () => {
    // Stored as non-locale-map shape; single-language project means keys do not match
    // localeKeys, so projection returns the raw value unchanged.
    const props = { title: { en: 'Welcome' } };
    await saveGlobalBlock('header', props);

    const response = await handleGetGlobalBlock('header', REGISTRY, getReq('header'));
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(body.globalBlocks, 'response should have globalBlocks key');
    assert.deepEqual(body.globalBlocks['header'].props, props);
  });
});

test('handleGetGlobalBlock returns 404 for unregistered slug', async () => {
  await withTempProject(async () => {
    const response = await handleGetGlobalBlock('unknown', REGISTRY, getReq('unknown'));
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
  });
});

test('handlePutGlobalBlock returns 404 for unregistered slug', async () => {
  await withTempProject(async () => {
    const response = await handlePutGlobalBlock(
      'unknown',
      putReq('unknown', { props: {} }),
      {},
      REGISTRY
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
  });
});

test('handlePutGlobalBlock returns 400 when props key is missing (SCEN-11b)', async () => {
  await withTempProject(async (tempRoot) => {
    await seedSchemaMap(tempRoot, {
      Header: { name: 'Header', items: {} },
    });

    const response = await handlePutGlobalBlock(
      'header',
      putReq('header', { blocks: [] }),
      {},
      REGISTRY
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.error.toLowerCase().includes('props'), `expected "props" in error: ${body.error}`);
  });
});

test('handlePutGlobalBlock returns 400 when props is not an object', async () => {
  await withTempProject(async (tempRoot) => {
    await seedSchemaMap(tempRoot, {
      Header: { name: 'Header', items: {} },
    });

    const response = await handlePutGlobalBlock(
      'header',
      putReq('header', { props: 'not-an-object' }),
      {},
      REGISTRY
    );
    assert.equal(response.status, 400);
  });
});

test('handlePutGlobalBlock returns 400 when props fails schema validation (SCEN-11)', async () => {
  await withTempProject(async (tempRoot) => {
    // Schema with a required field
    await seedSchemaMap(tempRoot, {
      Header: {
        name: 'Header',
        items: {
          title: { type: 'string', label: 'Title', required: true },
        },
      },
    });

    const response = await handlePutGlobalBlock(
      'header',
      putReq('header', { props: {} }), // missing required title
      {},
      REGISTRY
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.error, 'should have error message');
  });
});

test('handlePutGlobalBlock returns 200 and persists props for registered slug (SCEN-9)', async () => {
  await withTempProject(async (tempRoot) => {
    await seedSchemaMap(tempRoot, {
      Header: { name: 'Header', items: { title: { type: 'string', label: 'Title' } } },
    });

    const props = { title: 'My Site' };
    const response = await handlePutGlobalBlock(
      'header',
      putReq('header', { props }),
      {},
      REGISTRY
    );
    assert.equal(response.status, 200);

    const getResponse = await handleGetGlobalBlock('header', REGISTRY, getReq('header'));
    const body = await getResponse.json();
    assert.deepEqual(body.globalBlocks['header'].props, props);
  });
});

test('handlePutGlobalBlock merges per-locale scalars into LocalizedValueMap preserving other locales', async () => {
  await withTempProject(async (tempRoot) => {
    await seedMultiLanguage();
    await seedSchemaMap(tempRoot, {
      Header: {
        name: 'Header',
        items: {
          title: { type: 'string', label: 'Title', localizable: true },
        },
      },
    });

    // Save the 'es' scalar.
    let res = await handlePutGlobalBlock(
      'header',
      putReq('header', { props: { title: 'Hola' }, locale: 'es' }),
      {},
      REGISTRY
    );
    assert.equal(res.status, 200);

    // Save the 'en' scalar — must merge, not overwrite.
    res = await handlePutGlobalBlock(
      'header',
      putReq('header', { props: { title: 'Hello' }, locale: 'en' }),
      {},
      REGISTRY
    );
    assert.equal(res.status, 200);

    // GET ?locale=es → projected scalar 'Hola'
    const esRes = await handleGetGlobalBlock('header', REGISTRY, getReq('header', 'es'));
    const esBody = await esRes.json();
    assert.equal(esBody.locale, 'es');
    assert.equal(esBody.globalBlocks['header'].props.title, 'Hola');

    // GET ?locale=en → projected scalar 'Hello'
    const enRes = await handleGetGlobalBlock('header', REGISTRY, getReq('header', 'en'));
    const enBody = await enRes.json();
    assert.equal(enBody.locale, 'en');
    assert.equal(enBody.globalBlocks['header'].props.title, 'Hello');
  });
});

test('handleGetGlobalBlock projects LocalizedValueMap to scalar for requested locale', async () => {
  await withTempProject(async (tempRoot) => {
    await seedMultiLanguage();
    await seedSchemaMap(tempRoot, {
      Header: {
        name: 'Header',
        items: {
          title: { type: 'string', label: 'Title', localizable: true },
        },
      },
    });
    // Seed stored value directly in LocalizedValueMap shape.
    await saveGlobalBlock('header', { title: { es: 'Hola', en: 'Hello' } });

    const esRes = await handleGetGlobalBlock('header', REGISTRY, getReq('header', 'es'));
    const esBody = await esRes.json();
    assert.equal(esBody.globalBlocks['header'].props.title, 'Hola');

    const enRes = await handleGetGlobalBlock('header', REGISTRY, getReq('header', 'en'));
    const enBody = await enRes.json();
    assert.equal(enBody.globalBlocks['header'].props.title, 'Hello');
  });
});
