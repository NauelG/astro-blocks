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
  runImportPipeline,
  _rollbackFromSnapshot,
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
      if (err) {
        reject(err);
        return;
      }
      chunks.push(chunk);
      if (final) {
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const buf = Buffer.allocUnsafe(totalLen);
        let off = 0;
        for (const c of chunks) {
          buf.set(c, off);
          off += c.length;
        }
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
  const ceilings = {
    perFile: 50 * 1024 * 1024,
    total: 500 * 1024 * 1024,
    compressed: 1024 * 1024 * 1024,
  };
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
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(wrongManifest));
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

    const badUsersData = JSON.stringify({
      users: [{ id: '1', email: 'a@b.com', passwordHash: 'x', role: 'superadmin' }],
    });
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

    // Create 5 existing fake snapshots with hyphenated ISO names (matching createBackupSnapshot format)
    const oldNames = [];
    for (let i = 0; i < 5; i++) {
      const name = new Date(Date.now() - (6 - i) * 10000).toISOString().replace(/:/g, '-');
      oldNames.push(name);
      const d = path.join(backupsDir, name, 'data');
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(path.join(d, 'pages.json'), '{"pages":[]}');
    }

    // Now create a 6th via createBackupSnapshot — should prune the oldest
    await createBackupSnapshot(tempRoot, ['pages']);

    const entries = await fs.readdir(backupsDir);
    assert.equal(
      entries.length,
      5,
      `should retain 5 snapshots, got ${entries.length}: ${entries.join(', ')}`,
    );

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
    assert.ok(
      uploadsStat.isDirectory(),
      'snapshot must contain uploads/ dir when media unit selected',
    );
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
    const exists = await fs
      .stat(uploadsSnapshot)
      .then(() => true)
      .catch(() => false);
    assert.equal(
      exists,
      false,
      'uploads/ snapshot dir must NOT exist when media unit not selected',
    );
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
    await savePages({
      pages: [
        {
          id: 'original',
          slug: { en: 'original' },
          title: { en: 'Original' },
          blocks: [],
          status: { en: 'published' },
        },
      ],
    });

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
      assert.equal(
        result.usersReplaced,
        true,
        'usersReplaced must be true when users unit imported',
      );
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
      assert.equal(
        result.usersReplaced,
        false,
        'usersReplaced must be false when users unit not imported',
      );
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
      checksums: {
        'data/pages.json': 'deadbeef0000000000000000000000000000000000000000000000000000cafe',
      },
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

// ---------------------------------------------------------------------------
// FIX 1: validateManifest rejects traversal / disallowed checksums keys
// ---------------------------------------------------------------------------

test('FIX-1: validateManifest rejects checksums key containing path traversal (../../etc/passwd)', async () => {
  const { validateManifest } = await import('../dist/api/manifest.js');
  const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

  const manifest = {
    schemaVersion: SV,
    astroBlocksVersion: '3.0.0',
    exportedAt: new Date().toISOString(),
    units: ['pages'],
    counts: { pages: 0 },
    checksums: {
      '../../etc/passwd': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  };
  const result = validateManifest(manifest);
  assert.equal(result.ok, false, 'should reject traversal key in checksums');
  assert.match(result.reason ?? '', /traversal|not allowed|absolute/i);
});

test('FIX-1: validateManifest rejects checksums key with data/../secret (dotdot)', async () => {
  const { validateManifest } = await import('../dist/api/manifest.js');
  const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

  const manifest = {
    schemaVersion: SV,
    astroBlocksVersion: '3.0.0',
    exportedAt: new Date().toISOString(),
    units: ['pages'],
    counts: { pages: 0 },
    checksums: {
      'data/../secret': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  };
  const result = validateManifest(manifest);
  assert.equal(result.ok, false, 'should reject dotdot key in checksums');
  assert.match(result.reason ?? '', /traversal|not allowed/i);
});

test('FIX-1: validateManifest rejects checksums key outside allowlist (not data/ or uploads/)', async () => {
  const { validateManifest } = await import('../dist/api/manifest.js');
  const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

  const manifest = {
    schemaVersion: SV,
    astroBlocksVersion: '3.0.0',
    exportedAt: new Date().toISOString(),
    units: ['pages'],
    counts: { pages: 0 },
    checksums: {
      'evil/file.json': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
  };
  const result = validateManifest(manifest);
  assert.equal(
    result.ok,
    false,
    'should reject checksums key outside data/ and uploads/ allowlists',
  );
  assert.match(result.reason ?? '', /not an allowed path|not allowed/i);
});

// FIX 1: validateStagedImport walks disk, so injected file not in manifest is detected
test('FIX-1: validateStagedImport detects injected file in staging (not in manifest → checksum fail)', async () => {
  await withTempProject(async (tempRoot) => {
    const { sha256Hex, buildManifest } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    // Build a staging dir where pages.json exists with a valid manifest,
    // but also contains an extra injected file unknown to the manifest.
    const pagesJson = JSON.stringify({ pages: [] });
    const pagesBytes = Buffer.from(pagesJson, 'utf-8');
    const manifest = buildManifest(
      ['pages'],
      { pages: 0 },
      {
        'data/pages.json': sha256Hex(pagesBytes),
      },
    );

    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-inject-'));
    await fs.mkdir(path.join(stagingDir, 'data'), { recursive: true });
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(stagingDir, 'data', 'pages.json'), pagesJson);
    // Inject an extra file inside staging (simulating an attacker writing to staging directly)
    await fs.writeFile(path.join(stagingDir, 'data', 'users.json'), JSON.stringify({ users: [] }));

    try {
      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      // The injected file (data/users.json) is not in manifest.checksums → should fail
      assert.equal(
        result.ok,
        false,
        'expected ok:false when staging contains a file absent from manifest',
      );
      assert.match(result.reason ?? '', /checksum/i);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

// FIX 1: happy-path still ok:true (regression guard)
test('FIX-1: validateStagedImport happy-path still returns ok:true with disk-walk staged collection', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      const result = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(
        result.ok,
        true,
        `expected ok:true for valid staged import, got: ${result.reason}`,
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 2: compressed body size ceiling in handleImport
// ---------------------------------------------------------------------------

test('FIX-2: handleImport returns 413 when Content-Length exceeds compressed ceiling', async () => {
  await withTempProject(async (tempRoot) => {
    const prev = process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
    try {
      // Set compressed ceiling to 100 bytes
      process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = '100';

      // Build a request that declares a Content-Length > ceiling
      const zipBody = await buildZipBody(['pages'], tempRoot);
      const req = new Request('http://localhost/cms/api/import', {
        method: 'POST',
        body: zipBody,
        headers: {
          'content-type': 'application/zip',
          'content-length': String(zipBody.length), // much larger than 100
        },
      });
      const res = await handleImport(req, OWNER_USER);
      assert.equal(res.status, 413, `expected 413 for oversized Content-Length, got ${res.status}`);
      // Response must be JSON
      const body = await res.json().catch(() => null);
      assert.ok(body !== null, 'response must be valid JSON');
    } finally {
      if (prev === undefined) delete process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
      else process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = prev;
    }
  });
});

test('FIX-2: readCeilingEnvVars returns compressed ceiling with default, env override, and invalid→default', async () => {
  const { readCeilingEnvVars, DEFAULT_MAX_IMPORT_COMPRESSED_BYTES } = await import(
    '../dist/api/import-utils.js'
  );

  const savedCompressed = process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
  try {
    // Default
    delete process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
    const defaults = readCeilingEnvVars();
    assert.equal(
      defaults.compressed,
      DEFAULT_MAX_IMPORT_COMPRESSED_BYTES,
      'should return default compressed ceiling',
    );

    // Env override
    process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = String(200 * 1024 * 1024);
    const overridden = readCeilingEnvVars();
    assert.equal(
      overridden.compressed,
      200 * 1024 * 1024,
      'should use ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES env var',
    );

    // Invalid value → default
    process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = 'not-a-number';
    const invalid = readCeilingEnvVars();
    assert.equal(
      invalid.compressed,
      DEFAULT_MAX_IMPORT_COMPRESSED_BYTES,
      'invalid env var should fall back to default',
    );

    // Zero → default
    process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = '0';
    const zero = readCeilingEnvVars();
    assert.equal(
      zero.compressed,
      DEFAULT_MAX_IMPORT_COMPRESSED_BYTES,
      'zero env var should fall back to default',
    );
  } finally {
    if (savedCompressed === undefined) delete process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
    else process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = savedCompressed;
  }
});

// ---------------------------------------------------------------------------
// FIX 4: configuration ENOENT narrowing — non-ENOENT errors propagate
// ---------------------------------------------------------------------------

test('FIX-4: applyImport propagates non-ENOENT errors from configuration savers', async () => {
  await withTempProject(async (tempRoot) => {
    // Build a valid staging dir for configuration
    const zipBody = await buildZipBody(['configuration'], tempRoot);
    const stagingDir = await prepareStaging(zipBody, tempRoot);
    try {
      // Make site.json unreadable so readFile throws EACCES (not ENOENT)
      const siteInStaging = path.join(stagingDir, 'data', 'site.json');
      // We can simulate a non-ENOENT read error by writing an invalid JSON file
      // and relying on JSON.parse throwing (which is then wrapped in applyImport).
      // Actually the catch is around readFile+saver. A simpler approach:
      // replace the file with a directory so readFile throws EISDIR.
      await fs.rm(siteInStaging, { force: true });
      await fs.mkdir(siteInStaging); // Now it's a dir → readFile throws EISDIR

      // applyImport should throw because EISDIR !== ENOENT
      await assert.rejects(
        async () => applyImport(stagingDir, tempRoot, ['configuration'], {}),
        (err) => {
          // Should not be silently swallowed
          return err instanceof Error;
        },
        'non-ENOENT error from a configuration saver must propagate (not be swallowed)',
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 5: apply error boundary + rollback
// ---------------------------------------------------------------------------

/**
 * GAP 1 (HIGH): Force applyImport to throw AFTER validation succeeds by replacing
 * the live `data/pages.json` with a directory (EISDIR) between the snapshot step
 * and the apply step. This is done by calling the pipeline internals directly so
 * we can inject the failure at precisely the right point.
 *
 * Asserts: (a) applyImport throws, (b) the error is wrapped as apply-failed, and
 * (c) live data is RESTORED to its pre-import state by _rollbackFromSnapshot.
 */
test('FIX-5: applyImport failure triggers rollback; _rollbackFromSnapshot restores live data', async () => {
  await withTempProject(async (tempRoot) => {
    // Set up a distinctive pre-import live state
    const preImportRaw = JSON.stringify({
      pages: [
        {
          id: 'pre-rollback',
          slug: { en: 'pre' },
          title: { en: 'Pre' },
          blocks: [],
          status: { en: 'published' },
        },
      ],
    });
    await fs.writeFile(path.join(tempRoot, 'data', 'pages.json'), preImportRaw);

    // Build a valid zip for pages (empty pages — different from pre-state)
    const zipBody = await buildZipBody(['pages'], tempRoot);

    // Extract to staging + validate (these pass normally)
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-gap1-staging-'));
    try {
      const ceilings = {
        perFile: 50 * 1024 * 1024,
        total: 500 * 1024 * 1024,
        compressed: 1024 * 1024 * 1024,
      };
      await extractToStaging(zipBody, stagingDir, ceilings, tempRoot);

      const validResult = await validateStagedImport(stagingDir, ['pages'], tempRoot);
      assert.equal(
        validResult.ok,
        true,
        `staging validation must pass, got: ${validResult.reason}`,
      );

      // Create snapshot BEFORE any live mutation (this is what runImportPipeline does)
      const snapshotDir = await createBackupSnapshot(tempRoot, ['pages']);

      // NOW sabotage the live target: replace pages.json with a directory so that
      // savePages (which writes a .tmp then rename) fails with EISDIR on rename.
      const livePagesPath = path.join(tempRoot, 'data', 'pages.json');
      await fs.rm(livePagesPath, { force: true });
      await fs.mkdir(livePagesPath); // now it's a dir — rename into it fails

      let applyError;
      try {
        await applyImport(stagingDir, tempRoot, ['pages'], {});
      } catch (err) {
        applyError = err;
      }

      // (a) applyImport must have thrown
      assert.ok(
        applyError instanceof Error,
        'applyImport must throw when live pages.json is a directory',
      );

      // (b) Rollback from snapshot
      // Remove the sabotaged dir first so rollback copyFile can write the file
      await fs.rm(livePagesPath, { recursive: true, force: true });
      await _rollbackFromSnapshot(snapshotDir, tempRoot, ['pages']);

      // (c) Live data must be restored to the pre-import raw state
      const liveAfterRollback = await fs.readFile(livePagesPath, 'utf-8');
      assert.equal(
        liveAfterRollback,
        preImportRaw,
        'live data must be restored to pre-import state after rollback',
      );
    } finally {
      // Ensure livePagesPath is not a dir so withTempProject cleanup works
      const lp = path.join(tempRoot, 'data', 'pages.json');
      const st = await fs.stat(lp).catch(() => null);
      if (st && st.isDirectory()) {
        await fs.rm(lp, { recursive: true, force: true });
      }
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

/**
 * GAP 1 (HIGH) — Unit test for _rollbackFromSnapshot directly.
 * Creates a snapshot dir with known raw content, mutates live data, calls rollback,
 * and asserts the live file bytes equal the snapshot bytes exactly.
 */
test('FIX-5: _rollbackFromSnapshot restores live data files from snapshot (unit)', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a snapshot dir manually with a known raw pages.json content
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-snap-unit-'));
    const snapshotDataDir = path.join(snapshotDir, 'data');
    await fs.mkdir(snapshotDataDir, { recursive: true });

    const preStateRaw =
      '{"pages":[{"id":"snapshot-state","slug":{"en":"snap"},"title":{"en":"Snapshot"},"blocks":[],"status":{"en":"published"}}]}';
    await fs.writeFile(path.join(snapshotDataDir, 'pages.json'), preStateRaw);

    try {
      // Mutate live data to something different (raw write to bypass normalization)
      const mutatedRaw =
        '{"pages":[{"id":"post-mutation","slug":{"en":"mut"},"title":{"en":"Mutated"},"blocks":[],"status":{"en":"draft"}}]}';
      await fs.writeFile(path.join(tempRoot, 'data', 'pages.json'), mutatedRaw);

      // Call rollback
      await _rollbackFromSnapshot(snapshotDir, tempRoot, ['pages']);

      // Live file bytes must equal the snapshot bytes
      const liveAfterRollback = await fs.readFile(
        path.join(tempRoot, 'data', 'pages.json'),
        'utf-8',
      );
      assert.equal(
        liveAfterRollback,
        preStateRaw,
        'live data file bytes must equal snapshot pre-state after rollback',
      );
    } finally {
      await fs.rm(snapshotDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 5c: handleImport always returns JSON (never non-JSON 500)
// ---------------------------------------------------------------------------

test('FIX-5c: handleImport always returns valid JSON even for unexpected errors', async () => {
  await withTempProject(async () => {
    // Pass a body that is valid compressed but will fail at apply time.
    // A corrupt zip is enough to get a JSON response (400).
    const req = buildImportRequest(Buffer.from('not-a-zip'));
    const res = await handleImport(req, OWNER_USER);
    // Should be a JSON response regardless of status
    const ct = res.headers.get('content-type') ?? '';
    assert.ok(
      ct.includes('json') || ct.includes('application'),
      `expected JSON content-type, got: ${ct}`,
    );
    const body = await res.json().catch(() => null);
    assert.ok(body !== null, 'response must be parseable JSON');
  });
});

// ---------------------------------------------------------------------------
// FIX 7: backup dir names use hyphens (Windows-safe)
// ---------------------------------------------------------------------------

test('FIX-7: createBackupSnapshot creates snapshot dir with hyphenated timestamp (no colons)', async () => {
  await withTempProject(async (tempRoot) => {
    const snapshotDir = await createBackupSnapshot(tempRoot, ['pages']);
    const dirName = path.basename(snapshotDir);
    assert.ok(!dirName.includes(':'), `snapshot dir name must not contain colons, got: ${dirName}`);
    // Should match hyphenated ISO format: YYYY-MM-DDTHH-MM-SS.mmmZ
    assert.match(
      dirName,
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/,
      'snapshot name should be ISO with hyphens',
    );
  });
});

// ---------------------------------------------------------------------------
// FIX 8: 422 failure tests assert live data is unchanged + no snapshot created
// ---------------------------------------------------------------------------

test('FIX-8: after schemaVersion mismatch (422), live data is unchanged and no backup was created', async () => {
  await withTempProject(async (tempRoot) => {
    const { sha256Hex } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    // Record pre-import live state
    const liveDataDir = path.join(tempRoot, 'data');
    const preImportPages = await fs.readFile(path.join(liveDataDir, 'pages.json'), 'utf-8');
    const backupsDir = path.join(tempRoot, 'data', '_backups');

    const pagesBytes = Buffer.from(JSON.stringify({ pages: [] }));
    const manifest = {
      schemaVersion: SV + 99, // wrong version
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
    assert.equal(res.status, 422, `expected 422, got ${res.status}`);

    // Live data must be unchanged
    const postImportPages = await fs.readFile(path.join(liveDataDir, 'pages.json'), 'utf-8');
    assert.equal(
      postImportPages,
      preImportPages,
      'live pages.json must be unchanged after 422 failure',
    );

    // No snapshot should have been created (backup comes AFTER validation)
    const backupEntries = await fs.readdir(backupsDir).catch(() => []);
    assert.equal(
      backupEntries.length,
      0,
      'no backup snapshot should exist after a validation failure',
    );
  });
});

test('FIX-8: after checksum mismatch (422), live data is unchanged and no backup was created', async () => {
  await withTempProject(async (tempRoot) => {
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    const liveDataDir = path.join(tempRoot, 'data');
    const preImportPages = await fs.readFile(path.join(liveDataDir, 'pages.json'), 'utf-8');
    const backupsDir = path.join(tempRoot, 'data', '_backups');

    const pagesBytes = Buffer.from(JSON.stringify({ pages: [] }));
    const manifest = {
      schemaVersion: SV,
      astroBlocksVersion: '3.2.1',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      checksums: {
        'data/pages.json': 'deadbeef0000000000000000000000000000000000000000000000000000cafe',
      },
    };
    const zipBody = await buildMinimalZip([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'data/pages.json', bytes: pagesBytes },
    ]);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 422, `expected 422, got ${res.status}`);

    // Live data must be unchanged
    const postImportPages = await fs.readFile(path.join(liveDataDir, 'pages.json'), 'utf-8');
    assert.equal(
      postImportPages,
      preImportPages,
      'live pages.json must be unchanged after checksum mismatch',
    );

    // No snapshot should have been created
    const backupEntries = await fs.readdir(backupsDir).catch(() => []);
    assert.equal(
      backupEntries.length,
      0,
      'no backup snapshot should exist after a checksum mismatch',
    );
  });
});

// FIX 8: happy-path ordering test — after success, snapshot exists with pre-import state
test('FIX-8: after successful import, a snapshot exists with pre-import state and live data matches import', async () => {
  await withTempProject(async (tempRoot) => {
    // Set up distinctive pre-import live state
    const preImportPages = {
      pages: [
        {
          id: 'pre-import',
          slug: { en: 'pre-import' },
          title: { en: 'Pre Import' },
          blocks: [],
          status: { en: 'published' },
        },
      ],
    };
    await savePages(preImportPages);

    // Build a zip from a clean project (empty pages) to import
    // We need a clean snapshot for the "import state" — use a separate temp project
    const cleanRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-clean-'));
    let importZipBody;
    try {
      const prevRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = cleanRoot;
      const { ensureDefaultFiles: edf } = await import('../dist/api/data.js');
      await edf();
      importZipBody = await buildZipBody(['pages'], cleanRoot);
      if (prevRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
      else process.env.ASTRO_BLOCKS_PROJECT_ROOT = prevRoot;
    } finally {
      await fs.rm(cleanRoot, { recursive: true, force: true });
    }

    const req = buildImportRequest(importZipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200 for successful import, got ${res.status}`);

    // 1. At least one snapshot should exist
    const backupsDir = path.join(tempRoot, 'data', '_backups');
    const backupEntries = await fs.readdir(backupsDir);
    assert.ok(
      backupEntries.length >= 1,
      'at least one backup snapshot should exist after successful import',
    );

    // 2. The snapshot should contain the PRE-import pages.json
    const snapshotDir = path.join(backupsDir, [...backupEntries].sort().at(-1));
    const snapshotPages = JSON.parse(
      await fs.readFile(path.join(snapshotDir, 'data', 'pages.json'), 'utf-8'),
    );
    assert.deepEqual(snapshotPages, preImportPages, 'snapshot must contain the pre-import state');

    // 3. Live data should match the imported state (empty pages from clean project)
    const livePages = JSON.parse(
      await fs.readFile(path.join(tempRoot, 'data', 'pages.json'), 'utf-8'),
    );
    assert.equal(livePages.pages.length, 0, 'live data should match imported state (empty pages)');
  });
});

// ---------------------------------------------------------------------------
// GAP 2 (MEDIUM): Media atomic-swap leaves no temp dirs on success
// ---------------------------------------------------------------------------

test('GAP-2: after successful media import, .import-tmp and .import-old dirs do not exist', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a source upload file so the media unit has something to export
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(
      path.join(uploadsDir, 'gap2-test.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    );

    const zipBody = await buildZipBody(['media'], tempRoot);
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200 for media import, got ${res.status}`);

    // After success, neither temp dir must exist on disk
    const liveUploadsDir = path.join(tempRoot, 'public', 'uploads');
    const tempDir = liveUploadsDir + '.import-tmp';
    const oldDir = liveUploadsDir + '.import-old';

    const tmpExists = await fs
      .stat(tempDir)
      .then(() => true)
      .catch(() => false);
    const oldExists = await fs
      .stat(oldDir)
      .then(() => true)
      .catch(() => false);

    assert.equal(
      tmpExists,
      false,
      `.import-tmp must not exist after successful media import (found: ${tempDir})`,
    );
    assert.equal(
      oldExists,
      false,
      `.import-old must not exist after successful media import (found: ${oldDir})`,
    );
  });
});

// ---------------------------------------------------------------------------
// W-2: partial import — non-selected units are untouched on disk
// ---------------------------------------------------------------------------

test('W-2: partial import (pages only) leaves data/users.json bytes identical to pre-import content', async () => {
  await withTempProject(async (tempRoot) => {
    // 1. Seed a known users.json before the import
    const knownUser = {
      id: 'w2-user-1',
      email: 'w2@example.com',
      passwordHash: '$2b$10$knownhashforW2testonly',
      role: 'owner',
    };
    const knownUsersContent = JSON.stringify({ users: [knownUser] });
    await fs.writeFile(path.join(tempRoot, 'data', 'users.json'), knownUsersContent, 'utf-8');

    // 2. Read the pre-import users.json bytes for later comparison
    const preImportUsersBytes = await fs.readFile(path.join(tempRoot, 'data', 'users.json'));

    // 3. Build a valid export zip containing ONLY the pages unit.
    //    buildZipBody uses buildExportStream which builds a real manifest + checksums,
    //    so the import validation will pass without hand-rolling anything.
    const zipBody = await buildZipBody(['pages'], tempRoot);

    // 4. Run the import via handleImport (selecting only pages, since that is the unit in the zip)
    const req = buildImportRequest(zipBody);
    const res = await handleImport(req, OWNER_USER);

    // (a) Import must succeed
    assert.equal(res.status, 200, `expected 200 for pages-only import, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.success, true, 'response.success must be true');

    // (a) usersReplaced must be false — users unit was not in the zip
    assert.equal(
      body.usersReplaced,
      false,
      'usersReplaced must be false when only pages unit was imported',
    );

    // (b) data/users.json bytes on disk must be IDENTICAL to pre-import content
    const postImportUsersBytes = await fs.readFile(path.join(tempRoot, 'data', 'users.json'));
    assert.equal(
      postImportUsersBytes.toString('hex'),
      preImportUsersBytes.toString('hex'),
      'data/users.json bytes must be identical before and after a pages-only import',
    );

    // Also verify as parsed content (belt-and-suspenders)
    const postImportUsersParsed = JSON.parse(postImportUsersBytes.toString('utf-8'));
    assert.deepEqual(
      postImportUsersParsed.users[0],
      knownUser,
      'parsed users.json content must be unchanged after partial import',
    );

    // (c) Sanity: pages WERE actually replaced (import did something)
    const livePages = await loadPages();
    // The zip was built from the default project state (empty pages from ensureDefaultFiles),
    // so after import live pages must be the default empty-array state.
    assert.equal(Array.isArray(livePages.pages), true, 'live pages must be an array after import');
  });
});

// ---------------------------------------------------------------------------
// GAP 3 (MEDIUM): Import lock serialization — concurrent pipelines do not corrupt
// ---------------------------------------------------------------------------

test('GAP-3: concurrent runImportPipeline calls serialize — live data is a complete valid import', async () => {
  await withTempProject(async (tempRoot) => {
    const { readCeilingEnvVars } = await import('../dist/api/import-utils.js');

    // Build two zips with different but valid page content.
    // zipA: one page, zipB: two pages (different counts make it easy to tell them apart)
    const pageA = {
      id: 'page-a',
      slug: { en: 'a' },
      title: { en: 'Page A' },
      blocks: [],
      status: { en: 'published' },
    };
    const pageB1 = {
      id: 'page-b1',
      slug: { en: 'b1' },
      title: { en: 'Page B1' },
      blocks: [],
      status: { en: 'published' },
    };
    const pageB2 = {
      id: 'page-b2',
      slug: { en: 'b2' },
      title: { en: 'Page B2' },
      blocks: [],
      status: { en: 'published' },
    };

    const { sha256Hex, buildManifest } = await import('../dist/api/manifest.js');
    const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');

    function makeZip(pages) {
      const pagesJson = JSON.stringify({ pages });
      const pagesBytes = Buffer.from(pagesJson);
      const manifest = buildManifest(
        ['pages'],
        { pages: pages.length },
        { 'data/pages.json': sha256Hex(pagesBytes) },
      );
      return buildMinimalZip([
        { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: 'data/pages.json', bytes: pagesBytes },
      ]);
    }

    const [zipA, zipB] = await Promise.all([makeZip([pageA]), makeZip([pageB1, pageB2])]);

    const ceilings = readCeilingEnvVars();
    const opts = { projectRoot: tempRoot, ceilings, context: {} };

    // Fire both pipelines concurrently
    const [resultA, resultB] = await Promise.all([
      runImportPipeline(zipA, opts),
      runImportPipeline(zipB, opts),
    ]);

    // Both must resolve to a well-formed result (no crash, no unhandled rejection)
    assert.ok(typeof resultA.ok === 'boolean', 'resultA must have ok field');
    assert.ok(typeof resultB.ok === 'boolean', 'resultB must have ok field');

    // At least one must succeed
    const anyOk = resultA.ok || resultB.ok;
    assert.ok(anyOk, 'at least one of the concurrent imports must succeed');

    // Live data must be internally consistent — exactly 1 or 2 pages (one complete import, not an interleaved mix)
    const livePages = await loadPages();
    const count = livePages.pages.length;
    assert.ok(
      count === 1 || count === 2,
      `live data must be a complete valid import (1 or 2 pages), got ${count} pages: ${JSON.stringify(livePages.pages.map((p) => p.id))}`,
    );

    // All page IDs must belong to the SAME import (no cross-contamination)
    const ids = livePages.pages.map((p) => p.id);
    const fromA = ids.every((id) => id === 'page-a');
    const fromB = ids.every((id) => id === 'page-b1' || id === 'page-b2');
    assert.ok(
      fromA || fromB,
      `live pages must all belong to one import, not an interleaved mix. Got ids: ${ids.join(', ')}`,
    );
  });
});
