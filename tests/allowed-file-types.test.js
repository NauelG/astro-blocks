/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * allowed-file-types.test.js
 * Unit tests for src/utils/file-types.ts constants.
 * Tests import from ../dist/ after build.
 *
 * RED phase: written before the implementation exists.
 *
 * Spec: R1.1 (D1, D2). Note: R1.3-A, R1.5-A tests are in Slice C (need plugin/handlers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ALLOWED_FILE_TYPES, intersectAccept } from '../dist/utils/file-catalog.js';
import { drainVariantJobs } from '../dist/utils/variant-generator.js';

// ─── R1.1-A: DEFAULT_ALLOWED_FILE_TYPES export is correct ────────────────────

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES has exactly 6 entries', () => {
  assert.equal(DEFAULT_ALLOWED_FILE_TYPES.length, 6);
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES sorted equals expected 6 MIMEs', () => {
  const expected = [
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ];
  assert.deepEqual([...DEFAULT_ALLOWED_FILE_TYPES].sort(), expected);
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES contains application/pdf', () => {
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('application/pdf'));
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES contains all image variants', () => {
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/jpeg'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/png'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/webp'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/gif'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/svg+xml'));
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES has no duplicates', () => {
  const unique = new Set(DEFAULT_ALLOWED_FILE_TYPES);
  assert.equal(unique.size, DEFAULT_ALLOWED_FILE_TYPES.length);
});

// ─── R1.5-A: the handler's allowlist resolution ──────────────────────────────
//
// getAllowedFileTypes() memoizes at module load time, so we must use a fresh ESM
// import (cache-bust via unique query string) after setting the env var.
//
// Dedupe + lowercasing of the configured list happens in the plugin (resolveOptions →
// dedupeLowercase) and is covered in plugin-resolve-options.test.js. It used to be
// "covered" here by a test that asserted resetAllowedFileTypesCache was a function —
// which is not a test of anything. Removed rather than kept as decoration.
//
// The catalog's own invariants (extensions, raster set, serving policy) live in
// file-catalog.test.js, which replaced the RASTER_MIME / MIME_TO_EXT assertions this
// file used to carry.

async function importFreshHandlers(allowedFileTypesJson) {
  const prev = process.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES;
  if (allowedFileTypesJson !== undefined) {
    process.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES = allowedFileTypesJson;
  } else {
    delete process.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES;
  }
  try {
    const url =
      new URL('../dist/api/handlers.js', import.meta.url).href +
      `?aft=${Date.now()}-${Math.random()}`;
    return await import(url);
  } finally {
    if (prev === undefined) delete process.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES;
    else process.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES = prev;
  }
}

test('R1.5-A: getAllowedFileTypes falls back to DEFAULT_ALLOWED_FILE_TYPES when env is absent', async () => {
  // Import fresh module with env unset
  const { handleUpload, resetAllowedFileTypesCache } = await importFreshHandlers(undefined);
  if (typeof resetAllowedFileTypesCache === 'function') resetAllowedFileTypesCache();

  // image/jpeg is in DEFAULT_ALLOWED_FILE_TYPES → should return 200
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');
  const tempRoot = await mkdtemp(pathJoin(tmpdir(), 'astro-blocks-aft-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

  const { ensureDefaultFiles } = await import('../dist/api/data.js');
  await ensureDefaultFiles();

  try {
    // Binary transport — Content-Type header carries the MIME (non-form, bypasses CSRF check)
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('photo.jpg'),
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'image/jpeg should be accepted from default fallback allowlist');
  } finally {
    // Drain fire-and-forget variant jobs before restoring the env var (#96).
    await drainVariantJobs();
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ─── intersectAccept — case-insensitive accept intersection ───────────────────

const ALLOWLIST = ['application/pdf', 'image/jpeg', 'image/png'];

test('intersectAccept: mixed-case accept entry is lowercased and matched', () => {
  const result = intersectAccept(['Application/PDF'], ALLOWLIST);
  assert.deepEqual(result, ['application/pdf']);
});

test('intersectAccept: all-lowercase accept entry is passed through unchanged', () => {
  const result = intersectAccept(['image/jpeg', 'application/pdf'], ALLOWLIST);
  assert.deepEqual(result, ['image/jpeg', 'application/pdf']);
});

test('intersectAccept: accept entry not in allowlist is excluded', () => {
  const result = intersectAccept(['application/pdf', 'video/mp4'], ALLOWLIST);
  assert.deepEqual(result, ['application/pdf']);
});

test('intersectAccept: all accept entries out of allowlist returns empty array', () => {
  const result = intersectAccept(['video/mp4', 'text/plain'], ALLOWLIST);
  assert.deepEqual(result, []);
});

test('intersectAccept: omitted accept (undefined) returns full allowlist', () => {
  const result = intersectAccept(undefined, ALLOWLIST);
  assert.deepEqual(result, ALLOWLIST);
});

test('intersectAccept: empty accept array returns full allowlist', () => {
  const result = intersectAccept([], ALLOWLIST);
  assert.deepEqual(result, ALLOWLIST);
});
