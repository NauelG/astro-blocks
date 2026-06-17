/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { handleInvalidateCache } from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-cache-'));

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

// --- handleInvalidateCache ---

// Minimal Request object sufficient for all cache handler tests.
// localizedJsonError requires a Request; the early-return paths do not use it.
const DUMMY_REQUEST = new Request('http://localhost/cms/api/cache/invalidate');

test('handleInvalidateCache returns ok and cacheEnabled:false when no context is provided', async () => {
  await withTempProject(async () => {
    // No context — defaults to {} which has no cache
    const response = await handleInvalidateCache(DUMMY_REQUEST);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cacheEnabled, false);
    assert.ok(typeof body.message === 'string', 'should include message');
  });
});

test('handleInvalidateCache returns ok and cacheEnabled:false when context has no cache property', async () => {
  await withTempProject(async () => {
    const response = await handleInvalidateCache(DUMMY_REQUEST, {});

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cacheEnabled, false);
  });
});

test('handleInvalidateCache returns ok and cacheEnabled:false when context.cache is null', async () => {
  await withTempProject(async () => {
    const response = await handleInvalidateCache(DUMMY_REQUEST, { cache: null });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cacheEnabled, false);
  });
});

test('handleInvalidateCache returns ok and cacheEnabled:false when context.cache.enabled is falsy', async () => {
  await withTempProject(async () => {
    const response = await handleInvalidateCache(DUMMY_REQUEST, { cache: { enabled: false } });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cacheEnabled, false);
  });
});

test('handleInvalidateCache calls cache.invalidate for global paths and tags when cache is enabled', async () => {
  await withTempProject(async () => {
    const invalidatedPaths = [];
    const invalidatedTags = [];

    // Build a mock AstroCache-compatible object that records calls
    const mockCache = {
      enabled: true,
      invalidate: async (arg) => {
        if (arg.path !== undefined) invalidatedPaths.push(arg.path);
        if (arg.tags !== undefined) invalidatedTags.push(...arg.tags);
      },
    };

    const response = await handleInvalidateCache(DUMMY_REQUEST, { cache: mockCache });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cacheEnabled, true);
    assert.match(body.message, /invalidated/i);

    // At least one path-based invalidation should have been made
    assert.ok(invalidatedPaths.length > 0, 'should have invalidated at least one path');

    // At least one tag-based invalidation should have been made
    assert.ok(invalidatedTags.length > 0, 'should have invalidated at least one tag');
  });
});

test('handleInvalidateCache returns 500 when cache.invalidate throws', async () => {
  await withTempProject(async () => {
    const faultyCache = {
      enabled: true,
      invalidate: async () => {
        throw new Error('Cache service unavailable');
      },
    };

    const response = await handleInvalidateCache(DUMMY_REQUEST, { cache: faultyCache });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.ok(body.error, 'should have error message');
    assert.ok(body.detail, 'should have detail field with the original error message');
    assert.match(body.detail, /Cache service unavailable/);
  });
});
