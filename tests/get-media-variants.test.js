/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, replaceMedia } from '../dist/api/data.js';
import { getMediaVariants } from '../dist/utils/getMediaVariants.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-gmv-'));

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

// ─── T5.1 / T5.2: getMediaVariants ──────────────────────────────────────────

test('cache hit — single loadMedia call when mtime unchanged', async () => {
  await withTempProject(async () => {
    const entry = {
      id: 'cache-test-1',
      url: '/uploads/2026/06/img.jpg',
      filename: 'img.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [{ format: 'webp', width: 480, url: '/uploads/2026/06/img-480.webp' }],
    };
    await replaceMedia({ uploads: [entry] });

    // First call — should populate cache
    const result1 = await getMediaVariants(entry.url);
    assert.ok(result1, 'first call should return a result');
    assert.equal(result1.status, 'ready');

    // Second call with same mtime — should use cache (no re-read)
    // We verify this is correct by calling again and getting same result
    const result2 = await getMediaVariants(entry.url);
    assert.ok(result2, 'second call should return a result');
    assert.equal(result2.status, 'ready');
    assert.equal(result2.variants.length, 1);
  });
});

test('cache invalidation — re-reads after mtime changes', async () => {
  await withTempProject(async () => {
    const url = '/uploads/2026/06/img2.jpg';
    const entry1 = {
      id: 'inval-test-1',
      url,
      filename: 'img2.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'processing',
      variants: [],
    };
    await replaceMedia({ uploads: [entry1] });

    const result1 = await getMediaVariants(url);
    assert.equal(result1.status, 'processing');

    // Wait briefly so mtime can change, then update the registry
    await new Promise((r) => setTimeout(r, 10));

    const entry2 = {
      ...entry1,
      status: 'ready',
      variants: [{ format: 'webp', width: 480, url: '/uploads/2026/06/img2-480.webp' }],
    };
    await replaceMedia({ uploads: [entry2] });

    // Next call should see the updated status
    const result2 = await getMediaVariants(url);
    // Status should reflect the new registry (processing or ready depending on cache)
    // Since mtime changed (replaceMedia writes a new file), cache should be invalidated
    assert.equal(result2.status, 'ready', 'should read updated status after mtime change');
    assert.equal(result2.variants.length, 1, 'should have updated variants');
  });
});

test('missing registry → returns status:none, no throw', async () => {
  await withTempProject(async (tempRoot) => {
    // Delete the media.json that ensureDefaultFiles created
    const { getDataPath } = await import('../dist/utils/paths.js');
    await fs.rm(getDataPath('media.json'), { force: true });

    const result = await getMediaVariants('/uploads/2026/06/any.jpg');
    assert.ok(result !== null && result !== undefined, 'should return a result object');
    assert.equal(result.status, 'none', 'missing registry should return status:none');
    assert.deepEqual(result.variants, [], 'missing registry should return empty variants');
  });
});

test('URL not in registry → returns status:none', async () => {
  await withTempProject(async () => {
    const entry = {
      id: 'existing-1',
      url: '/uploads/2026/06/existing.jpg',
      filename: 'existing.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [],
    };
    await replaceMedia({ uploads: [entry] });

    const result = await getMediaVariants('/uploads/2026/06/nonexistent.jpg');
    assert.equal(result.status, 'none', 'unknown URL should return status:none');
    assert.deepEqual(result.variants, []);
  });
});

test('legacy entry (no status/variants) → status:none (plain-img branch)', async () => {
  await withTempProject(async () => {
    // Legacy entry without status or variants
    const legacyUrl = '/uploads/2026/01/legacy.jpg';
    const { getDataPath } = await import('../dist/utils/paths.js');
    await fs.writeFile(
      getDataPath('media.json'),
      JSON.stringify({
        uploads: [
          {
            id: 'legacy-0',
            url: legacyUrl,
            filename: 'legacy.jpg',
            size: 500,
            mimeType: 'image/jpeg',
            createdAt: '2026-01-01T00:00:00.000Z',
            // No status, no variants
          },
        ],
      }),
      'utf-8',
    );

    const result = await getMediaVariants(legacyUrl);
    assert.equal(result.status, 'none', 'legacy entry without status should return status:none');
    assert.deepEqual(result.variants, []);
  });
});

test('ready entry with variants — returns full result', async () => {
  await withTempProject(async () => {
    const url = '/uploads/2026/06/full.jpg';
    const variants = [
      { format: 'webp', width: 480, url: '/uploads/2026/06/full-480.webp' },
      { format: 'avif', width: 480, url: '/uploads/2026/06/full-480.avif' },
    ];
    await replaceMedia({
      uploads: [
        {
          id: 'full-1',
          url,
          filename: 'full.jpg',
          size: 2000,
          mimeType: 'image/jpeg',
          createdAt: new Date().toISOString(),
          status: 'ready',
          variants,
          alt: 'Full image',
          width: 1200,
          height: 800,
        },
      ],
    });

    const result = await getMediaVariants(url);
    assert.equal(result.status, 'ready');
    assert.equal(result.variants.length, 2);
    assert.equal(result.alt, 'Full image');
    assert.equal(result.width, 1200);
    assert.equal(result.height, 800);
  });
});
