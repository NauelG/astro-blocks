/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * B-1: buildExportStream tests.
 * Verifies the streaming zip export for selected units.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { buildExportStream } from '../dist/api/backup.js';
import { readableStreamToFflateUnzip } from '../dist/api/backup-stream.js';
import { sha256Hex } from '../dist/api/manifest.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-export-'));

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
 * Collect all bytes from a ReadableStream<Uint8Array> into a Buffer.
 */
async function collectStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf;
}

/**
 * Extract all entries from a zip Buffer.
 * Returns a Record<name, Buffer>.
 */
async function extractZip(zipBuf) {
  const entries = {};
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(zipBuf));
      controller.close();
    },
  });
  await readableStreamToFflateUnzip(stream, async (name, data) => {
    entries[name] = data;
  });
  return entries;
}

// B-1: zip starts with PK magic bytes

test('B-1: buildExportStream produces a ReadableStream whose bytes start with PK\\x03\\x04', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['pages'], tempRoot);
    const buf = await collectStream(stream);

    assert.ok(buf.length >= 4, 'zip must have at least 4 bytes');
    assert.equal(buf[0], 0x50, 'byte 0 must be P');
    assert.equal(buf[1], 0x4b, 'byte 1 must be K');
    assert.equal(buf[2], 0x03, 'byte 2 must be 0x03');
    assert.equal(buf[3], 0x04, 'byte 3 must be 0x04');
  });
});

// B-1: manifest.json is present as last entry and parseable

test('B-1: zip contains manifest.json and it is parseable JSON', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['pages'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    assert.ok('manifest.json' in entries, 'zip must contain manifest.json');
    const manifest = JSON.parse(entries['manifest.json'].toString('utf-8'));
    assert.ok(typeof manifest.schemaVersion === 'number', 'manifest.schemaVersion must be a number');
    assert.ok(typeof manifest.astroBlocksVersion === 'string', 'manifest.astroBlocksVersion must be a string');
    assert.ok(typeof manifest.exportedAt === 'string', 'manifest.exportedAt must be a string');
    assert.deepEqual(manifest.units, ['pages']);
    assert.ok(typeof manifest.checksums === 'object' && manifest.checksums !== null, 'manifest.checksums must be object');
  });
});

// B-1: selected files present, unselected absent

test('B-1: pages unit — data/pages.json present, data/users.json absent', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['pages'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    assert.ok('data/pages.json' in entries, 'data/pages.json must be in zip');
    assert.ok(!('data/users.json' in entries), 'data/users.json must NOT be in zip');
    assert.ok(!('data/site.json' in entries), 'data/site.json must NOT be in zip');
    assert.ok(!('data/global-blocks.json' in entries), 'data/global-blocks.json must NOT be in zip');
  });
});

test('B-1: configuration unit — all 5 config files present, pages absent', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['configuration'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    assert.ok('data/site.json' in entries, 'data/site.json must be in zip');
    assert.ok('data/configs.json' in entries, 'data/configs.json must be in zip');
    assert.ok('data/menus.json' in entries, 'data/menus.json must be in zip');
    assert.ok('data/redirects.json' in entries, 'data/redirects.json must be in zip');
    assert.ok('data/languages.json' in entries, 'data/languages.json must be in zip');
    assert.ok(!('data/pages.json' in entries), 'data/pages.json must NOT be in zip for configuration only');
  });
});

test('B-1: users unit — data/users.json present, other files absent', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['users'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    assert.ok('data/users.json' in entries, 'data/users.json must be in zip');
    assert.ok(!('data/pages.json' in entries), 'data/pages.json must NOT be in zip');
    assert.ok(!('data/site.json' in entries), 'data/site.json must NOT be in zip');
  });
});

// B-1: checksum matches entry bytes

test('B-1: manifest.checksums contains sha256 for each data entry that matches the actual bytes', async () => {
  await withTempProject(async (tempRoot) => {
    const stream = await buildExportStream(['pages', 'users'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);
    const manifest = JSON.parse(entries['manifest.json'].toString('utf-8'));

    // Every data/* entry in the zip should have a matching checksum in manifest
    for (const [entryName, entryBuf] of Object.entries(entries)) {
      if (entryName === 'manifest.json') continue;
      const expectedChecksum = manifest.checksums[entryName];
      assert.ok(expectedChecksum, `manifest.checksums must contain entry for ${entryName}`);
      const actualChecksum = sha256Hex(entryBuf);
      assert.equal(actualChecksum, expectedChecksum, `checksum mismatch for ${entryName}`);
    }
  });
});

// B-1: data/_backups/ is never included

test('B-1: zip never includes entries under data/_backups/', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a fake backup dir to make sure it is not included
    const backupsDir = path.join(tempRoot, 'data', '_backups', '2026-01-01T00:00:00.000Z');
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(path.join(backupsDir, 'pages.json'), '{"pages":[]}');

    const stream = await buildExportStream(['pages'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    for (const name of Object.keys(entries)) {
      assert.ok(!name.startsWith('data/_backups'), `entry "${name}" must not be under data/_backups/`);
    }
  });
});

// B-1: media unit includes uploads/ entries

test('B-1: media unit includes uploads/ entries when uploads directory has files', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a sample upload file
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    const sampleFile = path.join(uploadsDir, 'ab12-photo.jpg');
    await fs.writeFile(sampleFile, Buffer.from([0xff, 0xd8, 0xff])); // minimal JPEG magic

    const stream = await buildExportStream(['media'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);

    // media.json must be present
    assert.ok('data/media.json' in entries, 'data/media.json must be in zip for media unit');

    // uploads/ entries should be present
    const uploadEntries = Object.keys(entries).filter((n) => n.startsWith('uploads/'));
    assert.ok(uploadEntries.length > 0, 'zip must include uploads/ entries when files exist');
    assert.ok(
      uploadEntries.some((n) => n.includes('ab12-photo.jpg')),
      'uploads/2026/06/ab12-photo.jpg must be included',
    );
  });
});

test('B-1: media unit — uploads entries checksums match actual bytes', async () => {
  await withTempProject(async (tempRoot) => {
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    const sampleBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await fs.writeFile(path.join(uploadsDir, 'cd34-img.jpg'), sampleBytes);

    const stream = await buildExportStream(['media'], tempRoot);
    const buf = await collectStream(stream);
    const entries = await extractZip(buf);
    const manifest = JSON.parse(entries['manifest.json'].toString('utf-8'));

    const uploadEntries = Object.keys(entries).filter((n) => n.startsWith('uploads/'));
    for (const entryName of uploadEntries) {
      const expectedHash = manifest.checksums[entryName];
      assert.ok(expectedHash, `manifest.checksums must contain entry for ${entryName}`);
      const actualHash = sha256Hex(entries[entryName]);
      assert.equal(actualHash, expectedHash, `checksum mismatch for upload entry ${entryName}`);
    }
  });
});

// B-1: empty units array rejects

test('B-1: buildExportStream rejects when units array is empty', async () => {
  await withTempProject(async (tempRoot) => {
    await assert.rejects(
      async () => buildExportStream([], tempRoot),
      /units/i,
    );
  });
});
