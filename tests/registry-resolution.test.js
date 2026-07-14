/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Guards ADR-0025 for the two generated registries: a resolution failure is never
 * dressed up as a plausible, empty answer.
 *
 * `loadGlobalBlocksRegistry`'s old `catch { return [] }` is the failure this file exists
 * to prevent coming back. Downstream, an empty array is indistinguishable from "this
 * project declares no global blocks" — so an unresolvable registry rendered as an admin
 * that simply showed nothing, and nobody knew why. That is the ADR-0009 symptom.
 *
 * Under `node --test` there is no `import.meta.env`, so both registries resolve from disk.
 * A temp project with no `.astro-blocks/` is therefore exactly the deployed-server case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { routes } from '../dist/api/route-table.js';
import { loadSchemaMap } from '../dist/api/handlers/schema-loading.js';

async function withTempProject(fn, { seedRuntime = false } = {}) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-registry-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  if (seedRuntime) {
    // BOTH artifacts: handleGetGlobalBlocks needs the registry AND the schema map, and each
    // is a hard dependency. Seeding only one leaves the handler 500ing on the other.
    const dir = path.join(tempRoot, '.astro-blocks');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'runtime.mjs'),
      'export const globalBlocksRegistry = [];\n',
      'utf-8',
    );
    await fs.writeFile(path.join(dir, 'schema-map.mjs'), 'export const schemaMap = {};\n', 'utf-8');
  }

  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function routeFor(method, pattern) {
  const descriptor = routes.find((r) => r.method === method && r.pattern === pattern);
  assert.ok(descriptor, `route ${method} ${pattern} must exist`);
  return descriptor;
}

const ctx = (params = {}) => ({
  request: new Request('http://localhost/cms/api/global-blocks'),
  cache: undefined,
  params,
  user: { id: 'u1', email: 'owner@example.com', role: 'owner' },
});

test('GET global-blocks returns 500 when the registry cannot be resolved — never an empty list', async () => {
  await withTempProject(async () => {
    const response = await routeFor('GET', 'global-blocks').handler(ctx());

    assert.equal(response.status, 500, 'an unresolvable registry must not render as 200 + []');
  });
});

test('GET global-blocks/:id returns 500 when the registry cannot be resolved — never a 404', async () => {
  await withTempProject(async () => {
    // A 404 here would tell the operator "this global block does not exist", which is a
    // confident lie: the truth is that the server cannot resolve the registry at all.
    const response = await routeFor('GET', 'global-blocks/:id').handler(ctx({ id: 'header-cta' }));

    assert.equal(response.status, 500);
  });
});

test('PUT global-blocks/:id returns 500 when the registry cannot be resolved', async () => {
  await withTempProject(async () => {
    const response = await routeFor('PUT', 'global-blocks/:id').handler({
      ...ctx({ id: 'header-cta' }),
      request: new Request('http://localhost/cms/api/global-blocks/header-cta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ props: {} }),
      }),
    });

    assert.equal(response.status, 500);
  });
});

test('an empty registry is a VALUE, not a failure: a project declaring no global blocks resolves', async () => {
  await withTempProject(
    async () => {
      const response = await routeFor('GET', 'global-blocks').handler(ctx());

      assert.equal(response.status, 200, 'declaring zero global blocks is legitimate');
      const body = await response.json();
      assert.deepEqual(body.globalBlocks, {});
    },
    { seedRuntime: true },
  );
});

test('loadSchemaMap reports unresolved rather than an empty map', async () => {
  await withTempProject(async () => {
    const result = await loadSchemaMap();

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unresolved');
  });
});
