/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * tests/media-file-category.test.js
 *
 * Tests for loadMedia fileCategory derivation (B4 — api/data.ts).
 *
 * Spec: R6.2, R6.3.
 * Design: ADR-2, api/data.ts loadMedia normalization.
 *
 * RED phase written before (combined with B3 which already added the impl).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMedia } from '../dist/api/data.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-filecategory-'));

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

// ─── R6.2-A: legacy image entry gets fileCategory 'image' in memory ──────────

test('R6.2-A: legacy entry with mimeType image/jpeg and no fileCategory derives image in memory', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');

    // Write a legacy entry with no fileCategory field
    const legacyEntry = {
      id: 'legacy-img-01',
      url: '/uploads/2026/01/photo.jpg',
      filename: 'photo.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [legacyEntry] }), 'utf-8');

    const result = await loadMedia();
    assert.equal(result.uploads.length, 1);
    const entry = result.uploads[0];
    assert.equal(entry.fileCategory, 'image', 'image/jpeg → fileCategory should be image');

    // Verify the file on disk was NOT mutated
    const raw = JSON.parse(await fs.readFile(mediaPath, 'utf-8'));
    assert.ok(!('fileCategory' in raw.uploads[0]), 'raw file on disk should not have fileCategory added');
  });
});

// ─── R6.2-B: legacy non-image entry gets fileCategory 'document' in memory ───

test('R6.2-B: legacy entry with mimeType application/pdf and no fileCategory derives document in memory', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');

    const legacyEntry = {
      id: 'legacy-pdf-01',
      url: '/uploads/2026/01/doc.pdf',
      filename: 'doc.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      createdAt: '2026-01-15T11:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [legacyEntry] }), 'utf-8');

    const result = await loadMedia();
    const entry = result.uploads[0];
    assert.equal(entry.fileCategory, 'document', 'application/pdf → fileCategory should be document');

    // Disk unchanged
    const raw = JSON.parse(await fs.readFile(mediaPath, 'utf-8'));
    assert.ok(!('fileCategory' in raw.uploads[0]), 'raw file on disk should not have fileCategory added');
  });
});

// ─── R6.3-A: fully legacy entry loads without error, fields preserved exactly ─

test('R6.3-A: fully legacy entry (no status, no variants, no fileCategory) loads without error', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');

    // Minimal legacy entry — only the required fields
    const legacyEntry = {
      id: 'legacy-minimal-01',
      url: '/uploads/2026/01/img.png',
      filename: 'img.png',
      size: 512,
      mimeType: 'image/png',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [legacyEntry] }), 'utf-8');

    // Must not throw
    const result = await loadMedia();
    assert.equal(result.uploads.length, 1);

    const entry = result.uploads[0];
    // Preserved fields
    assert.equal(entry.id, 'legacy-minimal-01');
    assert.equal(entry.url, '/uploads/2026/01/img.png');
    assert.equal(entry.filename, 'img.png');
    assert.equal(entry.size, 512);
    // Derived fileCategory
    assert.equal(entry.fileCategory, 'image');
  });
});

// ─── R6.2-A extension: image/png also derives 'image' ────────────────────────

test('R6.2-A ext: legacy entry with image/png derives fileCategory image', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const legacyEntry = {
      id: 'legacy-png-01',
      url: '/uploads/2026/01/photo.png',
      filename: 'photo.png',
      size: 4096,
      mimeType: 'image/png',
      createdAt: '2026-01-16T12:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [legacyEntry] }), 'utf-8');
    const result = await loadMedia();
    assert.equal(result.uploads[0].fileCategory, 'image');
  });
});

// ─── R6.2-B extension: image/svg+xml also derives 'image' (SVG is image/*) ──

test('R6.2-B ext: legacy entry with image/svg+xml derives fileCategory image', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const legacyEntry = {
      id: 'legacy-svg-01',
      url: '/uploads/2026/01/logo.svg',
      filename: 'logo.svg',
      size: 800,
      mimeType: 'image/svg+xml',
      createdAt: '2026-01-16T13:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [legacyEntry] }), 'utf-8');
    const result = await loadMedia();
    assert.equal(result.uploads[0].fileCategory, 'image');
  });
});

// ─── Pass-through: existing fileCategory is preserved, not re-derived ─────────

test('B4: entry with explicit fileCategory=image is not overridden by derivation', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const entry = {
      id: 'explicit-cat-01',
      url: '/uploads/2026/06/photo.jpg',
      filename: 'photo.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      fileCategory: 'image',
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [entry] }), 'utf-8');
    const result = await loadMedia();
    assert.equal(result.uploads[0].fileCategory, 'image');
  });
});

test('B4: entry with explicit fileCategory=document is not overridden by derivation', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const entry = {
      id: 'explicit-cat-02',
      url: '/uploads/2026/06/doc.pdf',
      filename: 'doc.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      fileCategory: 'document',
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    await fs.writeFile(mediaPath, JSON.stringify({ uploads: [entry] }), 'utf-8');
    const result = await loadMedia();
    assert.equal(result.uploads[0].fileCategory, 'document');
  });
});
