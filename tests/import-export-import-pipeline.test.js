/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * C-2 through C-5: Import pipeline tests.
 * C-2: validateStagedImport
 * C-3: createBackupSnapshot
 * C-4: applyImport
 * C-5: handleImport
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadPages, savePages } from '../dist/api/data.js';
import {
  validateStagedImport,
  createBackupSnapshot,
  applyImport,
  buildExportStream,
  extractToStaging,
} from '../dist/api/backup.js';
import { handleImport } from '../dist/api/handlers.js';
import { DATA_SCHEMA_VERSION } from '../dist/api/schema-version.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-pipeline-'));
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

async function buildZipBody(units, projectRoot) {
  const stream = await buildExportStream(units, projectRoot);
  return collectStream(stream);
}

async function buildMinimalZip(entries) {
  const { Zip, ZipDeflate } = await import('fflate');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const zip = new Zip();
    zip.ondata = (err, chunk, final) => {
      if (err) { reject(err); return; }
      chunks.push(chunk);
      if (final) {
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const buf = Buffer.allocUnsafe(totalLen);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        resolve(buf);
      }
    };
    for (const { name, bytes } of entries) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(new Uint8Array(bytes), true);
    }
    zip.end();
  });
}

/** Extract a real zip into a staging dir. Returns stagingDir (caller must rm). */
async function prepareStaging(zipBody, projectRoot) {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-'));
  const ceilings = { perFile: 50 * 1024 * 1024, total: 500 * 1024 * 1024 };
  await extractToStaging(zipBody, stagingDir, ceilings, projectRoot);
  return stagingDir;
}

/** Build a real export zip and extract into a fresh staging dir. */
async function buildAndStage(units, projectRoot) {
  const zipBody = await buildZipBody(units, projectRoot);
  return prepareStaging(zipBody, projectRoot);
}

// ---------------------------------------------------------------------------
// C-2: validateStagedImport
// ---------------------------------------------------------------------------

test('C-2: validateStagedImport returns ok:true for a valid staged pages export', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(result.ok, true, `expected ok:true, got: ${result.reason}`);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-2: validateStagedImport fails with /checksum/ message on tampered data file', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      // Tamper with the staged pages.json
      const pagesPath = path.join(stagingDir, 'data', 'pages.json');
      await fs.writeFile(pagesPath, JSON.stringify({ pages: [{ id: 'injected' }] }));

      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(result.ok, false, 'expected ok:false after tampering');
      assert.match(result.reason ?? '', /checksum/i);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-2: validateStagedImport fails with /manifest/ message when manifest.json is missing', async () => {
  await withTempProject(async (tempRoot) => {
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-nomanifest-'));
    try {
      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(result.ok, false, 'expected ok:false when manifest is missing');
      assert.match(result.reason ?? '', /manifest/i);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-2: validateStagedImport fails with /version mismatch/ on wrong schemaVersion', async () => {
  await withTempProject(async (tempRoot) => {
    // Build a manifest with wrong schemaVersion
    const wrongManifest = {
      schemaVersion: DATA_SCHEMA_VERSION + 99,
      astroBlocksVersion: '0.0.0',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      checksums: {},
    };
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-badver-'));
    await fs.writeFile(
      path.join(stagingDir, 'manifest.json'),
      JSON.stringify(wrongManifest),
    );
    try {
      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(result.ok, false, 'expected ok:false for version mismatch');
      assert.match(result.reason ?? '', /version mismatch/i);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-2: validateStagedImport fails with /structural/ message on invalid user role', async () => {
  await withTempProject(async (tempRoot) => {
    // Export pages first to get a valid base, then build a users staging with bad role
    // We need a valid manifest + valid checksum but invalid user role.
    // Simplest: build a real export that includes users, extract, tamper user role
    // BUT this breaks checksum. So instead: export without users, then manually build
    // a staging with a bad-role users.json that HAS a matching checksum.

    // The validator step is: first checksum, then structural.
    // To test structural, we need: valid manifest + valid checksums + invalid structure.
    // We can do this by creating a manifest whose checksums match our "bad role" file.
    const { sha256Hex } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');
    const { buildManifest } = await import('../dist/api/manifest.js');

    const badUsersData = JSON.stringify({ users: [{ id: '1', email: 'a@b.com', passwordHash: 'x', role: 'superadmin' }] });
    const badUsersBytes = Buffer.from(badUsersData, 'utf-8');
    const usersChecksum = sha256Hex(badUsersBytes);

    const manifest = buildManifest(['users'], { users: 1 }, { 'data/users.json': usersChecksum });
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-badrole-'));
    await fs.mkdir(path.join(stagingDir, 'data'), { recursive: true });
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(stagingDir, 'data', 'users.json'), badUsersData);
    try {
      const result = await validateStagedImport(stagingDir, ['users'], tempRoot);
      assert.equal(result.ok, false, 'expected ok:false for invalid user role');
      assert.match(result.reason ?? '', /structural/i);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C-3: createBackupSnapshot
// ---------------------------------------------------------------------------

test('C-3: createBackupSnapshot creates a timestamped dir with data copies', async () => {
  await withTempProject(async (tempRoot) => {
    await createBackupSnapshot(tempRoot, ['pages']);

    const backupsDir = path.join(tempRoot, 'data', '_backups');
    const entries = await fs.readdir(backupsDir);
    assert.ok(entries.length >= 1, 'at least one backup dir should exist');

    // Should be ISO timestamp named
    const snapshotDir = path.join(backupsDir, entries[0]);
    const dataDir = path.join(snapshotDir, 'data');
    const dataStat = await fs.stat(dataDir);
    assert.ok(dataStat.isDirectory(), 'snapshot data/ subdir must exist');

    // pages.json must be in the snapshot data dir
    const pagesPath = path.join(dataDir, 'pages.json');
    const pagesStat = await fs.stat(pagesPath);
    assert.ok(pagesStat.isFile(), 'snapshot must contain data/pages.json copy');
  });
});

test('C-3: createBackupSnapshot with 6 existing snapshots prunes oldest (retains 5)', async () => {
  await withTempProject(async (tempRoot) => {
    const backupsDir = path.join(tempRoot, 'data', '_backups');
    await fs.mkdir(backupsDir, { recursive: true });

    // Create 5 existing fake snapshots with ISO names
    const oldNames = [];
    for (let i = 0; i < 5; i++) {
      const name = new Date(Date.now() - (6 - i) * 10000).toISOString();
      oldNames.push(name);
      const d = path.join(backupsDir, name, 'data');
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(path.join(d, 'pages.json'), '{"pages":[]}');
    }

    // Now create a 6th via createBackupSnapshot — should prune the oldest
    await createBackupSnapshot(tempRoot, ['pages']);

    const entries = await fs.readdir(backupsDir);
    assert.equal(entries.length, 5, `should retain 5 snapshots, got ${entries.length}: ${entries.join(', ')}`);

    // Oldest should have been pruned
    assert.ok(
      !entries.includes(oldNames[0]),
      `oldest snapshot "${oldNames[0]}" should have been pruned`,
    );
  });
});

test('C-3: createBackupSnapshot with media unit copies uploads/ dir', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a fake upload file
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'test-photo.jpg'), Buffer.from([0xff, 0xd8]));

    await createBackupSnapshot(tempRoot, ['media']);

    const backupsDir = path.join(tempRoot, 'data', '_backups');
    const entries = await fs.readdir(backupsDir);
    const snapshotDir = path.join(backupsDir, entries[0]);
    const uploadsSnapshot = path.join(snapshotDir, 'uploads');
    const uploadsStat = await fs.stat(uploadsSnapshot);
    assert.ok(uploadsStat.isDirectory(), 'snapshot must contain uploads/ dir when media unit selected');
  });
});

test('C-3: createBackupSnapshot without media unit does NOT copy uploads/', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a fake upload file to ensure it would be copied if media was selected
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'test-photo.jpg'), Buffer.from([0xff, 0xd8]));

    await createBackupSnapshot(tempRoot, ['pages']); // no 'media' unit

    const backupsDir = path.join(tempRoot, 'data', '_backups');
    const entries = await fs.readdir(backupsDir);
    const snapshotDir = path.join(backupsDir, entries[0]);
    const uploadsSnapshot = path.join(snapshotDir, 'uploads');
    const exists = await fs.stat(uploadsSnapshot).then(() => true).catch(() => false);
    assert.equal(exists, false, 'uploads/ snapshot dir must NOT exist when media unit not selected');
  });
});

// ---------------------------------------------------------------------------
// C-4: applyImport
// ---------------------------------------------------------------------------

test('C-4: applyImport replaces live data files from staging', async () => {
  await withTempProject(async (tempRoot) => {
    // Export the current (default) data
    const zipBody = await buildZipBody(['pages'], tempRoot);

    // Modify live pages.json to something different
    await savePages({ pages: [{ id: 'original', slug: { en: 'original' }, title: { en: 'Original' }, blocks: [], status: { en: 'published' } }] });

    // Stage the export (which had empty pages)
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      await applyImport(stagingDir, tempRoot, ['pages'], {});

      // Live data should now match what was in the zip (empty pages)
      const live = await loadPages();
      assert.equal(live.pages.length, 0, 'live pages should be replaced by imported data (empty)');
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-4: applyImport usersReplaced is true when users unit was in selectedUnits', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['users'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      const result = await applyImport(stagingDir, tempRoot, ['users'], {});
      assert.equal(result.usersReplaced, true, 'usersReplaced must be true when users unit imported');
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-4: applyImport usersReplaced is false when users unit not in selectedUnits', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      const result = await applyImport(stagingDir, tempRoot, ['pages'], {});
      assert.equal(result.usersReplaced, false, 'usersReplaced must be false when users unit not imported');
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-4: applyImport with media unit replaces uploads/ tree', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a source upload file
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'original.jpg'), Buffer.from([0xff, 0xd8]));

    const zipBody = await buildZipBody(['media'], tempRoot);

    // Remove the original upload and create a different file (to simulate state change)
    await fs.rm(path.join(uploadsDir, 'original.jpg'));

    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      await applyImport(stagingDir, tempRoot, ['media'], {});

      // The file from the exported state should now be back
      const restoredStat = await fs.stat(path.join(uploadsDir, 'original.jpg')).catch(() => null);
      assert.ok(restoredStat !== null, 'exported upload file should be restored after import');
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C-5: handleImport
// ---------------------------------------------------------------------------

const OWNER_USER = { id: 'owner-1', email: 'owner@example.com', role: 'owner' };
const REGULAR_USER = { id: 'user-1', email: 'user@example.com', role: 'user' };

/** Build a Request with a zip body streaming from the given buffer. */
function buildImportRequest(zipBody, url = 'http://localhost/cms/api/import') {
  return new Request(url, {
    method: 'POST',
    body: zipBody,
    headers: { 'content-type': 'application/zip' },
  });
}

test('C-5: handleImport returns 401 when not authenticated', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, null);
    assert.equal(res.status, 401, `expected 401 for no auth, got ${res.status}`);
  });
});

test('C-5: handleImport returns 403 when not owner', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, REGULAR_USER);
    assert.equal(res.status, 403, `expected 403 for non-owner, got ${res.status}`);
  });
});

test('C-5: handleImport returns 400 for empty body', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/import', {
      method: 'POST',
      body: new Uint8Array(0),
      headers: { 'content-type': 'application/zip' },
    });
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 400, `expected 400 for empty body, got ${res.status}`);
  });
});

test('C-5: handleImport returns 400 for corrupt zip data', async () => {
  await withTempProject(async () => {
    const req = buildImportRequest(Buffer.from('this is not a zip file at all'));
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 400, `expected 400 for corrupt zip, got ${res.status}`);
  });
});

test('C-5: handleImport returns 422 for schemaVersion mismatch', async () => {
  await withTempProject(async (tempRoot) => {
    // Build a zip with wrong schemaVersion
    const { sha256Hex, buildManifest } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    const pagesJson = JSON.stringify({ pages: [] });
    const pagesBytes = Buffer.from(pagesJson, 'utf-8');

    const manifest = {
      schemaVersion: SV + 99,
      astroBlocksVersion: '0.0.0',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      checksums: { 'data/pages.json': sha256Hex(pagesBytes) },
    };
    const zipBody = await buildMinimalZip([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'data/pages.json', bytes: pagesBytes },
    ]);

    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 422, `expected 422 for schemaVersion mismatch, got ${res.status}`);
  });
});

test('C-5: handleImport returns 422 for checksum mismatch', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);

    // Extract, tamper, repack — but we can simulate this differently:
    // Build a zip with a manifest pointing to a wrong checksum
    const { sha256Hex } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    const pagesJson = JSON.stringify({ pages: [] });
    const pagesBytes = Buffer.from(pagesJson, 'utf-8');
    const manifest = {
      schemaVersion: SV,
      astroBlocksVersion: '3.2.1',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      // Deliberately wrong checksum
      checksums: { 'data/pages.json': 'deadbeef0000000000000000000000000000000000000000000000000000cafe' },
    };
    const zipBody2 = await buildMinimalZip([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'data/pages.json', bytes: pagesBytes },
    ]);

    const req = buildImportRequest(zipBody2);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 422, `expected 422 for checksum mismatch, got ${res.status}`);
  });
});

test('C-5: handleImport returns 413 for zip exceeding ceiling', async () => {
  await withTempProject(async (tempRoot) => {
    const prevPerFile = process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES;
    const prevTotal = process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES;
    try {
      // Set ceiling to 100 bytes
      process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES = '100';
      process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES = '100';

      // Build a valid zip with pages (will exceed 100 bytes when decompressed)
      const zipBody = await buildZipBody(['pages'], tempRoot);
      const req = buildImportRequest(zipBody);
      const res = await handleImport(req, OWNER_USER);
      assert.equal(res.status, 413, `expected 413 for ceiling exceeded, got ${res.status}`);
    } finally {
      if (prevPerFile === undefined) delete process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES;
      else process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES = prevPerFile;
      if (prevTotal === undefined) delete process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES;
      else process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES = prevTotal;
    }
  });
});

test('C-5: handleImport returns 200 with success:true and usersReplaced for valid pages import', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200 for valid import, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.success, true, 'response.success must be true');
    assert.equal(typeof body.usersReplaced, 'boolean', 'response.usersReplaced must be a boolean');
    assert.equal(body.usersReplaced, false, 'usersReplaced must be false when only pages imported');
  });
});

test('C-5: handleImport sets usersReplaced:true when users unit is in the archive', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['users'], tempRoot);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.usersReplaced, true, 'usersReplaced must be true when users unit imported');
  });
});
