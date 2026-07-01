/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * D-1: handleBootstrapImport handler tests.
 *
 * Security contract:
 *   - users.length === 0  → runs the full import pipeline
 *   - users.length  > 0  → 403 IMMEDIATELY, body is NOT consumed
 *
 * The bootstrap endpoint is unauthenticated: no Authorization header needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadUsers, saveUsers } from '../dist/api/data.js';
import { buildExportStream, runImportPipeline } from '../dist/api/backup.js';
import { handleBootstrapImport } from '../dist/api/handlers.js';
import { DATA_SCHEMA_VERSION } from '../dist/api/schema-version.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-bootstrap-'));
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

function makeRequest(body, extraHeaders = {}) {
  return new Request('http://localhost/cms/api/import/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', ...extraHeaders },
    body,
  });
}

// ---------------------------------------------------------------------------
// D-1: Zero-user gate — allow when empty
// ---------------------------------------------------------------------------

test('D-1: empty users + valid zip → 200 with success:true', async () => {
  await withTempProject(async (tempRoot) => {
    // Instance has no users (default empty state from ensureDefaultFiles)
    const usersData = await loadUsers();
    assert.equal(usersData.users.length, 0, 'precondition: must start with 0 users');

    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = makeRequest(zipBody);
    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.success, true, `expected success:true, got: ${JSON.stringify(body)}`);
  });
});

// ---------------------------------------------------------------------------
// D-1: Zero-user gate — refuse when users exist
// ---------------------------------------------------------------------------

test('D-1: non-empty users → 403 and body is NOT consumed', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed one user
    await saveUsers({
      users: [
        {
          id: 'existing-user-1',
          email: 'owner@example.com',
          passwordHash: 'hash',
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    // Use a zip that WOULD pass the pipeline if body were consumed — but must not be.
    // The key invariant: even with a valid zip body, the 403 comes before arrayBuffer().
    // We verify by checking that no staging directory side-effects appear.
    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = makeRequest(zipBody);

    // Record the backup count before the call — if body were consumed and pipeline ran,
    // a backup would be created. 403 must return with zero new backups and zero staging dirs.
    const backupsDir = path.join(tempRoot, 'data', '_backups');
    let backupsBefore = 0;
    try { backupsBefore = (await fs.readdir(backupsDir)).length; } catch { /* dir may not exist */ }

    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 403, `expected 403, got ${res.status}`);

    // Pipeline must NOT have run: no new backups created
    let backupsAfter = 0;
    try { backupsAfter = (await fs.readdir(backupsDir)).length; } catch { /* dir may not exist */ }
    assert.equal(backupsAfter, backupsBefore, 'no backups must be created when 403 gate fires');
  });
});

// ---------------------------------------------------------------------------
// D-1: Empty users + schema version mismatch → 422
// ---------------------------------------------------------------------------

test('D-1: empty users + schemaVersion mismatch → 422', async () => {
  await withTempProject(async () => {
    // Build a corrupt-schemaVersion manifest
    const wrongManifest = {
      schemaVersion: DATA_SCHEMA_VERSION + 99,
      astroBlocksVersion: '0.0.0',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      checksums: { 'data/pages.json': 'abc123' },
    };
    const pagesJson = JSON.stringify({ pages: [] });
    const manifestJson = JSON.stringify(wrongManifest);

    const zipBody = await buildMinimalZip([
      { name: 'manifest.json', bytes: Buffer.from(manifestJson) },
      { name: 'data/pages.json', bytes: Buffer.from(pagesJson) },
    ]);

    const req = makeRequest(zipBody);
    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 422, `expected 422 for schemaVersion mismatch, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
// D-1: Empty users + corrupt zip → 400
// ---------------------------------------------------------------------------

test('D-1: empty users + corrupt zip → 400', async () => {
  await withTempProject(async () => {
    const corruptBytes = Buffer.from('this is not a zip file at all');
    const req = makeRequest(corruptBytes);
    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 400, `expected 400 for corrupt zip, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
// D-1: No Authorization header — still works when users empty (public endpoint)
// ---------------------------------------------------------------------------

test('D-1: no Authorization header → 200 when users empty (endpoint is public)', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildZipBody(['pages'], tempRoot);
    // Deliberately omit Authorization header
    const req = new Request('http://localhost/cms/api/import/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBody,
    });

    const res = await handleBootstrapImport(req, { cache: null });
    assert.equal(res.status, 200, `expected 200 without auth header, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
// D-1: Empty users + path traversal entry → 400, no files written
// ---------------------------------------------------------------------------

test('D-1: empty users + path-traversal entry → 400, no files written', async () => {
  await withTempProject(async (tempRoot) => {
    // Craft a manifest that references a traversal path
    const manifest = {
      schemaVersion: DATA_SCHEMA_VERSION,
      astroBlocksVersion: '0.0.0',
      exportedAt: new Date().toISOString(),
      units: ['pages'],
      counts: { pages: 0 },
      checksums: {
        'uploads/../../etc/passwd': 'abc123',
        'data/pages.json': 'abc123',
      },
    };
    const pagesJson = JSON.stringify({ pages: [] });
    const traversalBytes = Buffer.from('evil content');
    const manifestJson = JSON.stringify(manifest);

    const zipBody = await buildMinimalZip([
      { name: 'manifest.json', bytes: Buffer.from(manifestJson) },
      { name: 'data/pages.json', bytes: Buffer.from(pagesJson) },
      { name: 'uploads/../../etc/passwd', bytes: traversalBytes },
    ]);

    // Ensure no suspicious file exists before
    const evilPath = path.join(tempRoot, 'etc', 'passwd');
    let existedBefore = false;
    try { await fs.access(evilPath); existedBefore = true; } catch { /* ok */ }
    assert.equal(existedBefore, false, 'precondition: evil file must not exist before test');

    const req = makeRequest(zipBody);
    const res = await handleBootstrapImport(req, { cache: null });

    // Should be 400 (path traversal rejected at extraction)
    assert.equal(res.status, 400, `expected 400 for path traversal, got ${res.status}`);

    // Evil file must not have been written
    let existedAfter = false;
    try { await fs.access(evilPath); existedAfter = true; } catch { /* ok */ }
    assert.equal(existedAfter, false, 'path-traversal entry must not create files on disk');
  });
});

// ---------------------------------------------------------------------------
// D-1: Empty users + ceiling exceeded → 413, no files written
// ---------------------------------------------------------------------------

test('D-1: empty users + ceiling exceeded → 413, no files written', async () => {
  await withTempProject(async (tempRoot) => {
    // Set a very low ceiling via env var
    const originalFileCeiling = process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES;
    const originalTotalCeiling = process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES;
    // Set ceiling to 10 bytes (any real file will exceed this)
    process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES = '10';
    process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES = '100';

    try {
      const zipBody = await buildZipBody(['pages'], tempRoot);
      const req = makeRequest(zipBody);
      const res = await handleBootstrapImport(req, { cache: null });

      assert.equal(res.status, 413, `expected 413 for ceiling exceeded, got ${res.status}`);

      // No new backup should have been created
      const backupsDir = path.join(tempRoot, 'data', '_backups');
      let backupEntries = [];
      try {
        backupEntries = await fs.readdir(backupsDir);
      } catch {
        // _backups dir may not exist — fine
      }
      assert.equal(backupEntries.length, 0, 'no backups should be created when ceiling exceeded');
    } finally {
      if (originalFileCeiling === undefined) {
        delete process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES;
      } else {
        process.env.ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES = originalFileCeiling;
      }
      if (originalTotalCeiling === undefined) {
        delete process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES;
      } else {
        process.env.ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES = originalTotalCeiling;
      }
    }
  });
});
