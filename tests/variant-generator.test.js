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
import { generateAndPersistVariants } from '../dist/utils/variant-generator.js';

/**
 * A real 2000x100 PNG buffer encoded as base64.
 * Generated with sharp({ create: { width: 2000, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png()
 * Width 2000px ensures all four breakpoints (480, 800, 1200, 1920) are strictly less-than,
 * and the no-upscale rule means no variant at width >= 2000.
 */
const PNG_2000_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAB9AAAABkCAIAAABRpjzDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAL2UlEQVR4nO3aQQ2AQBRDQTStJsRWFiI4lJJJqmD+nl72yn2MAAECBAgQIECAAAECBAgQIECAAAECBAgQyLtgfhEkQIAAAQIECBAgQIAAAQIECBAgQIAAAQIE8vp7uuDuGREgQIAAAQIECBAgQIAAAQIECBAgQIAAgSO4ewQECBAgQIAAAQIECBAgQIAAAQIECBAgQOB84Ye+H+79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQI/EBAcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7H0AcVfXBXFnj/RAAAAAElFTkSuQmCC';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-vgen-'));

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

/**
 * Write the PNG fixture to the uploads dir and append a MediaEntry to registry.
 * Returns the MediaEntry with id/url/etc.
 */
async function seedRasterUpload(tempRoot, pngBuffer, width, height) {
  const subdir = '2026/06';
  const dir = path.join(tempRoot, 'public', 'uploads', subdir);
  await fs.mkdir(dir, { recursive: true });
  const filename = 'ab12-photo.png';
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, pngBuffer);
  const url = `/uploads/${subdir}/${filename}`;

  const { appendMediaEntry, generateId } = await import('../dist/api/data.js');
  const entry = {
    id: generateId(),
    url,
    filename,
    size: pngBuffer.length,
    mimeType: 'image/png',
    createdAt: new Date().toISOString(),
    width,
    height,
    status: 'processing',
  };
  await appendMediaEntry(entry);
  return entry;
}

// ─── T3.1 / T3.2: generateAndPersistVariants ─────────────────────────────────

test('raster upload generates webp+avif at applicable breakpoints (2000px wide)', async () => {
  await withTempProject(async (tempRoot) => {
    const pngBuffer = Buffer.from(PNG_2000_BASE64, 'base64');
    // Width=2000 → breakpoints 480, 800, 1200, 1920 are all < 2000 → 4 widths × 2 formats = 8 variants
    const entry = await seedRasterUpload(tempRoot, pngBuffer, 2000, 100);

    await generateAndPersistVariants(entry);

    const { loadMedia } = await import('../dist/api/data.js');
    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);

    assert.ok(updated, 'entry should still exist in registry');
    assert.equal(updated.status, 'ready', 'status should be ready after successful generation');
    assert.ok(Array.isArray(updated.variants), 'variants should be an array');
    assert.equal(updated.variants.length, 8, '4 widths × 2 formats = 8 variants for 2000px image');

    // All variants should have widths strictly less than 2000
    for (const v of updated.variants) {
      assert.ok(v.width < 2000, `variant width ${v.width} should be < original 2000`);
    }

    // Verify variant files exist on disk
    for (const v of updated.variants) {
      const { resolveUploadPath } = await import('../dist/utils/paths.js');
      const variantPath = resolveUploadPath(v.url);
      assert.ok(variantPath, `variant URL ${v.url} should resolve to a path`);
      const stat = await fs.stat(variantPath);
      assert.ok(stat.isFile(), `variant file should exist on disk: ${variantPath}`);
    }

    // Verify formats are only webp and avif
    const formats = new Set(updated.variants.map((v) => v.format));
    assert.ok(formats.has('webp'), 'should have webp variants');
    assert.ok(formats.has('avif'), 'should have avif variants');
    assert.equal(formats.size, 2, 'only webp and avif formats');
  });
});

test('width equals breakpoint — only lower breakpoints generated (800px wide)', async () => {
  await withTempProject(async (tempRoot) => {
    // For an 800px image: 480 < 800 (include), 800 is NOT < 800 (skip), 1200 >= 800 (skip), 1920 >= 800 (skip)
    // So only breakpoint 480 fires → 2 variants (webp + avif)
    const { default: sharp } = await import('sharp');
    const buf = await sharp({
      create: { width: 800, height: 50, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .png()
      .toBuffer();

    const entry = await seedRasterUpload(tempRoot, buf, 800, 50);
    await generateAndPersistVariants(entry);

    const { loadMedia } = await import('../dist/api/data.js');
    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);

    assert.equal(updated.status, 'ready');
    assert.equal(
      updated.variants.length,
      2,
      '1 width (480) × 2 formats = 2 variants for 800px image',
    );
    for (const v of updated.variants) {
      assert.equal(v.width, 480, 'only the 480 breakpoint should be generated');
    }
  });
});

test('corrupt buffer → status:failed, no variant files written, no throw', async () => {
  await withTempProject(async (tempRoot) => {
    // Write a corrupt (non-image) buffer
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'ab34-corrupt.png';
    const corruptBuffer = Buffer.from('this is not an image at all');
    await fs.writeFile(path.join(dir, filename), corruptBuffer);
    const url = `/uploads/${subdir}/${filename}`;

    const { appendMediaEntry, generateId, loadMedia } = await import('../dist/api/data.js');
    const entry = {
      id: generateId(),
      url,
      filename,
      size: corruptBuffer.length,
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
      status: 'processing',
    };
    await appendMediaEntry(entry);

    // Must not throw
    await assert.doesNotReject(() => generateAndPersistVariants(entry));

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);
    assert.equal(updated.status, 'failed', 'status should be failed for corrupt buffer');

    // No variant files should exist
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', subdir);
    const files = await fs.readdir(uploadsDir);
    // Only the original corrupt file should exist
    const variantFiles = files.filter((f) => f !== filename);
    assert.equal(variantFiles.length, 0, 'no variant files should be created for corrupt buffer');
  });
});

// R4.1-A: PDF entry skips sharp → status:ready, variants:[], no extra files (B5)
test('R4.1-A: PDF entry → generateAndPersistVariants skips sharp, returns status:ready variants:[]', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'ef78-doc.pdf';
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    await fs.writeFile(path.join(dir, filename), pdfBytes);
    const url = `/uploads/${subdir}/${filename}`;

    const { appendMediaEntry, generateId, loadMedia } = await import('../dist/api/data.js');
    const entry = {
      id: generateId(),
      url,
      filename,
      size: pdfBytes.length,
      mimeType: 'application/pdf',
      createdAt: new Date().toISOString(),
      status: 'processing',
    };
    await appendMediaEntry(entry);

    await generateAndPersistVariants(entry);

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);

    assert.ok(updated, 'entry should still exist in registry');
    assert.equal(updated.status, 'ready', 'PDF should have status ready');
    assert.deepEqual(updated.variants, [], 'PDF should have empty variants array');

    // No variant files should be created
    const files = await fs.readdir(dir);
    const variantFiles = files.filter((f) => f !== filename);
    assert.equal(variantFiles.length, 0, 'no variant files should be created for PDF');
  });
});

// R4.1-B: GIF entry skips sharp → status:ready, variants:[], no extra files (B5)
test('R4.1-B: GIF entry → generateAndPersistVariants skips sharp, returns status:ready variants:[]', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'gh90-anim.gif';
    const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    await fs.writeFile(path.join(dir, filename), gifBytes);
    const url = `/uploads/${subdir}/${filename}`;

    const { appendMediaEntry, generateId, loadMedia } = await import('../dist/api/data.js');
    const entry = {
      id: generateId(),
      url,
      filename,
      size: gifBytes.length,
      mimeType: 'image/gif',
      createdAt: new Date().toISOString(),
      status: 'processing',
    };
    await appendMediaEntry(entry);

    await generateAndPersistVariants(entry);

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);

    assert.equal(updated.status, 'ready', 'GIF should have status ready');
    assert.deepEqual(updated.variants, [], 'GIF should have empty variants array');

    const files = await fs.readdir(dir);
    const variantFiles = files.filter((f) => f !== filename);
    assert.equal(variantFiles.length, 0, 'no variant files should be created for GIF');
  });
});

test('SVG entry → generateAndPersistVariants skips sharp, returns status:ready variants:[]', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'cd56-logo.svg';
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
    await fs.writeFile(path.join(dir, filename), svgContent);
    const url = `/uploads/${subdir}/${filename}`;

    const { appendMediaEntry, generateId, loadMedia } = await import('../dist/api/data.js');
    const entry = {
      id: generateId(),
      url,
      filename,
      size: svgContent.length,
      mimeType: 'image/svg+xml',
      createdAt: new Date().toISOString(),
      status: 'processing',
    };
    await appendMediaEntry(entry);

    await generateAndPersistVariants(entry);

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);

    assert.equal(updated.status, 'ready', 'SVG should have status ready');
    assert.deepEqual(updated.variants, [], 'SVG should have empty variants array');

    // No variant files should be created alongside the SVG
    const files = await fs.readdir(dir);
    const variantFiles = files.filter((f) => f !== filename);
    assert.equal(variantFiles.length, 0, 'no variant files should be created for SVG');
  });
});
