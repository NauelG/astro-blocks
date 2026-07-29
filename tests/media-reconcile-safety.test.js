/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-reconcile-safety.test.js — the orphan scan may only delete what it can prove is an orphan.
 *
 * `generateAndPersistVariants` writes variant files to disk WITHOUT holding the media lock and
 * registers them only afterwards (utils/variant-generator.ts). Between the first encode and
 * markMediaVariantsReady the filesystem holds real files the registry does not know about — and the
 * admin client re-fetches the media list immediately after an upload, which runs reconcileMedia.
 *
 * The scan used to treat "not in the registry" as proof of orphanhood and delete them. The entry
 * would then be marked `ready` recording variants whose files were gone, and the srcset 404s on the
 * public site with nothing to signal it. (ADR-0038, #164)
 *
 * Fixtures are ported from variant-generator.test.js rather than imported: node:test files do not
 * export, and reconcile tests otherwise live in media-handlers.test.js, which has neither the PNG
 * nor the seed helper.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appendMediaEntry,
  ensureDefaultFiles,
  generateId,
  loadMedia,
  reconcileMedia,
} from '../dist/api/data.js';
import { generateAndPersistVariants } from '../dist/utils/variant-generator.js';

/** A real 2000x100 PNG: wide enough that all four breakpoints apply, in both formats. */
const PNG_2000_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAB9AAAABkCAIAAABRpjzDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAL2UlEQVR4nO3aQQ2AQBRDQTStJsRWFiI4lJJJqmD+nl72yn2MAAECBAgQIECAAAECBAgQIECAAAECBAgQyLtgfhEkQIAAAQIECBAgQIAAAQIECBAgQIAAAQIE8vp7uuDuGREgQIAAAQIECBAgQIAAAQIECBAgQIAAgSO4ewQECBAgQIAAAQIECBAgQIAAAQIECBAgQOB84Ye+H+79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQIZD+WCu79GxgBAgQIECBAgAABAgQIECBAgAABAgQI/EBAcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7FUcO/fwAgQIECAAAECBAgQIECAAAECBAgQIEAg+7H0AcVfXBXFnj/RAAAAAElFTkSuQmCC';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-rcsafety-'));

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

const SUBDIR = '2026/06';

function uploadsDir(tempRoot) {
  return path.join(tempRoot, 'public', 'uploads', SUBDIR);
}

function publicPath(tempRoot, url) {
  return path.join(tempRoot, 'public', url.replace(/^\//, ''));
}

/** Write the PNG fixture to the uploads dir and register it, as an upload would. */
async function seedRasterUpload(tempRoot, pngBuffer) {
  const dir = uploadsDir(tempRoot);
  await fs.mkdir(dir, { recursive: true });
  const filename = 'ab12-photo.png';
  await fs.writeFile(path.join(dir, filename), pngBuffer);
  const entry = {
    id: generateId(),
    url: `/uploads/${SUBDIR}/${filename}`,
    filename,
    size: pngBuffer.length,
    mimeType: 'image/png',
    createdAt: new Date().toISOString(),
    width: 2000,
    height: 100,
    status: 'processing',
  };
  await appendMediaEntry(entry);
  return entry;
}

/** Age a file past any threshold, so the gate is testable without a test that sleeps. */
async function backdate(filePath, ms) {
  const when = new Date(Date.now() - ms);
  await fs.utimes(filePath, when, when);
}

// ─── RC-1: the reproduction ───────────────────────────────────────────────────

test('RC-1: a listing read during variant generation leaves every recorded variant on disk', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedRasterUpload(tempRoot, Buffer.from(PNG_2000_BASE64, 'base64'));

    // Production shape: handleUpload fires this WITHOUT awaiting, then responds.
    const job = generateAndPersistVariants(entry);

    // The admin grid re-fetches immediately after the upload response (client/media.ts uploadFile
    // → loadMedia), and that request runs reconcileMedia.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await reconcileMedia();

    await job;

    const stored = (await loadMedia()).uploads.find((u) => u.id === entry.id);
    assert.ok(stored, 'the entry must survive');
    assert.ok((stored.variants ?? []).length > 0, 'generation must have produced variants');

    const missing = [];
    for (const variant of stored.variants) {
      try {
        await fs.access(publicPath(tempRoot, variant.url));
      } catch {
        missing.push(variant.url);
      }
    }
    assert.deepEqual(missing, [], 'the registry must not record variants whose files are gone');
  });
});

// ─── RC-2 / RC-3: the age gate ────────────────────────────────────────────────

test('RC-2: an unregistered variant file that was just written survives the scan', async () => {
  await withTempProject(async (tempRoot) => {
    const dir = uploadsDir(tempRoot);
    await fs.mkdir(dir, { recursive: true });
    // An original so the registry has a surviving entry, and a stray variant beside it.
    await fs.writeFile(path.join(dir, 'keep.jpg'), 'original');
    await appendMediaEntry({
      id: generateId(),
      url: `/uploads/${SUBDIR}/keep.jpg`,
      filename: 'keep.jpg',
      size: 8,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [],
    });

    const fresh = path.join(dir, 'inflight-480.webp');
    await fs.writeFile(fresh, 'being written right now');

    await reconcileMedia();

    await assert.doesNotReject(
      () => fs.access(fresh),
      'a file written seconds ago may be mid-generation, not an orphan',
    );
  });
});

test('RC-3: an unregistered variant file older than the threshold is deleted', async () => {
  await withTempProject(async (tempRoot) => {
    const dir = uploadsDir(tempRoot);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'keep.jpg'), 'original');
    await appendMediaEntry({
      id: generateId(),
      url: `/uploads/${SUBDIR}/keep.jpg`,
      filename: 'keep.jpg',
      size: 8,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [],
    });

    const stale = path.join(dir, 'abandoned-480.webp');
    await fs.writeFile(stale, 'left behind');
    await backdate(stale, 30 * 60 * 1000);

    await reconcileMedia();

    await assert.rejects(
      () => fs.access(stale),
      'a genuine orphan past the threshold is still collected',
    );
  });
});
