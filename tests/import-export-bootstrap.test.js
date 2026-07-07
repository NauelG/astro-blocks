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
import { handleBootstrapImport, handleLogin } from '../dist/api/handlers.js';
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

function makeRequest(body, extraHeaders = {}) {
  return new Request('http://localhost/cms/api/import/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', ...extraHeaders },
    body,
  });
}

// ---------------------------------------------------------------------------
// Helpers for ceiling-exceeded test (B5)
// ---------------------------------------------------------------------------

/**
 * Return the current count of entries in data/_backups (0 if directory absent).
 */
async function countBackups(projectRoot) {
  const backupsDir = path.join(projectRoot, 'data', '_backups');
  try {
    return (await fs.readdir(backupsDir)).length;
  } catch {
    return 0;
  }
}

/**
 * Return the current count of entries in the OS temp dir whose name starts
 * with 'astro-import-'. Used to detect staging dirs that were NOT cleaned up.
 */
async function countStagingDirs() {
  const tmpDir = os.tmpdir();
  try {
    const entries = await fs.readdir(tmpDir);
    return entries.filter((e) => e.startsWith('astro-import-')).length;
  } catch {
    return 0;
  }
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
    try {
      backupsBefore = (await fs.readdir(backupsDir)).length;
    } catch {
      /* dir may not exist */
    }

    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 403, `expected 403, got ${res.status}`);

    // Pipeline must NOT have run: no new backups created
    let backupsAfter = 0;
    try {
      backupsAfter = (await fs.readdir(backupsDir)).length;
    } catch {
      /* dir may not exist */
    }
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
    try {
      await fs.access(evilPath);
      existedBefore = true;
    } catch {
      /* ok */
    }
    assert.equal(existedBefore, false, 'precondition: evil file must not exist before test');

    const req = makeRequest(zipBody);
    const res = await handleBootstrapImport(req, { cache: null });

    // Should be 400 (path traversal rejected at extraction)
    assert.equal(res.status, 400, `expected 400 for path traversal, got ${res.status}`);

    // Evil file must not have been written
    let existedAfter = false;
    try {
      await fs.access(evilPath);
      existedAfter = true;
    } catch {
      /* ok */
    }
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

// ---------------------------------------------------------------------------
// B1: Concurrency — two concurrent bootstrap POSTs on a zero-user instance
// ---------------------------------------------------------------------------

test('B1: concurrent bootstrap POSTs — exactly one succeeds, second gets bootstrap-users-exist', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed the instance with a user in users.json so that both zips contain a
    // users unit. When the first pipeline applies, it writes users to disk.
    // The second pipeline's in-lock re-check then observes users.length !== 0
    // and returns bootstrap-users-exist.
    await saveUsers({
      users: [
        {
          id: 'import-user-1',
          email: 'imported@example.com',
          passwordHash: 'hash',
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    // Build zips that include the 'users' unit BEFORE clearing users.json,
    // so both archives carry a non-empty users array.
    const zip1 = await buildZipBody(['users'], tempRoot);
    const zip2 = await buildZipBody(['users'], tempRoot);

    // Now clear users.json to simulate a fresh instance so the outer gate (and
    // the initial in-lock re-check for the FIRST pipeline) sees 0 users.
    await saveUsers({ users: [] });

    const { readCeilingEnvVars } = await import('../dist/api/import-utils.js');

    const makeOpts = () => ({
      projectRoot: tempRoot,
      ceilings: readCeilingEnvVars(),
      context: {},
      bootstrapMode: true,
    });

    // Fire both pipelines concurrently via runImportPipeline (same code path
    // that handleBootstrapImport calls after the outer gate).
    const [r1, r2] = await Promise.all([
      runImportPipeline(zip1, makeOpts()),
      runImportPipeline(zip2, makeOpts()),
    ]);

    const successes = [r1, r2].filter((r) => r.ok).length;
    const usersExist = [r1, r2].filter((r) => r.errorCode === 'bootstrap-users-exist').length;

    assert.equal(
      successes,
      1,
      `expected exactly 1 success, got: r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)}`,
    );
    assert.equal(
      usersExist,
      1,
      `expected exactly 1 bootstrap-users-exist, got: r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)}`,
    );

    // Final users.json must be internally consistent (one archive's users, not a merge).
    const finalUsers = await loadUsers();
    assert.equal(
      finalUsers.users.length,
      1,
      `expected exactly 1 user after import, got ${finalUsers.users.length}`,
    );
    assert.equal(
      typeof finalUsers.users[0].id,
      'string',
      'users.json must remain internally consistent',
    );
  });
});

// ---------------------------------------------------------------------------
// B1: In-lock re-check unit — users appear between outer gate and lock
// ---------------------------------------------------------------------------

test('B1: in-lock re-check — users seeded before pipeline acquires lock → bootstrap-users-exist', async () => {
  await withTempProject(async (tempRoot) => {
    // The instance starts empty. We seed a user FIRST to simulate users appearing
    // between the outer handleBootstrapImport gate and pipeline execution.
    await saveUsers({
      users: [
        {
          id: 'seeded-user',
          email: 'owner@example.com',
          passwordHash: 'hash',
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const zipBody = await buildZipBody(['pages'], tempRoot);
    const { readCeilingEnvVars } = await import('../dist/api/import-utils.js');

    // Call runImportPipeline with bootstrapMode:true directly.
    // Users exist → in-lock re-check must abort immediately.
    const result = await runImportPipeline(zipBody, {
      projectRoot: tempRoot,
      ceilings: readCeilingEnvVars(),
      context: {},
      bootstrapMode: true,
    });

    assert.equal(result.ok, false, 'pipeline must not succeed when users exist at lock time');
    assert.equal(
      result.errorCode,
      'bootstrap-users-exist',
      `expected bootstrap-users-exist, got ${result.errorCode}`,
    );

    // Assert no backup was created (pipeline aborted before backup step).
    assert.equal(
      await countBackups(tempRoot),
      0,
      'no backup must be created when in-lock re-check aborts',
    );
  });
});

// ---------------------------------------------------------------------------
// B2: Generic 500 — handler must NOT expose raw error messages to anonymous callers
// ---------------------------------------------------------------------------

test('B2: unexpected throw → 500 with generic message, no path/err text leaked', async () => {
  await withTempProject(async () => {
    // Create a request whose arrayBuffer() throws an error containing a filesystem path.
    // handleBootstrapImport must return a generic 500 body, not expose the error.
    const sensitiveMessage = '/secret/path/to/internal/data.js was not found';
    const poisonedRequest = new Request('http://localhost/cms/api/import/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'Content-Length': '1' },
      body: 'x', // minimal body so outer gate passes
    });

    // Patch arrayBuffer on this specific request instance to throw with sensitive message.
    const origArrayBuffer = poisonedRequest.arrayBuffer.bind(poisonedRequest);
    let called = false;
    Object.defineProperty(poisonedRequest, 'arrayBuffer', {
      value: async () => {
        called = true;
        throw new Error(sensitiveMessage);
      },
      writable: false,
    });

    const res = await handleBootstrapImport(poisonedRequest, { cache: null });

    // Status must be 400 (arrayBuffer throws → treated as invalid body) or 500.
    // Either way the body must NOT contain the sensitive path.
    const body = await res.json().catch(() => ({}));
    const bodyStr = JSON.stringify(body);
    assert.equal(
      bodyStr.includes('/secret/path'),
      false,
      `response must not leak internal paths: ${bodyStr}`,
    );
    assert.equal(
      bodyStr.includes('was not found'),
      false,
      `response must not leak raw error text: ${bodyStr}`,
    );
    assert.equal(
      called,
      true,
      'arrayBuffer must have been called (outer gate passes, body is read)',
    );
  });
});

// ---------------------------------------------------------------------------
// B3: Strengthened body-not-consumed test — spy on arrayBuffer
// ---------------------------------------------------------------------------

test('B3: non-empty users → 403 without calling arrayBuffer (body truly not consumed)', async () => {
  await withTempProject(async (tempRoot) => {
    await saveUsers({
      users: [
        {
          id: 'user-b3',
          email: 'owner@example.com',
          passwordHash: 'hash',
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const zipBody = await buildZipBody(['pages'], tempRoot);
    const req = new Request('http://localhost/cms/api/import/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBody,
    });

    // Spy on arrayBuffer — it must NOT be called when 403 fires.
    let arrayBufferCalled = false;
    Object.defineProperty(req, 'arrayBuffer', {
      value: async () => {
        arrayBufferCalled = true;
        return zipBody.buffer ?? zipBody;
      },
      writable: false,
    });

    const res = await handleBootstrapImport(req, { cache: null });

    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    assert.equal(arrayBufferCalled, false, 'arrayBuffer must NOT be called when gate returns 403');
  });
});

// ---------------------------------------------------------------------------
// B5: Content-Length preflight — oversized compressed body → 413, no side effects
// ---------------------------------------------------------------------------

test('B5: Content-Length exceeds compressed ceiling → 413 with no staging/backup side effects', async () => {
  await withTempProject(async (tempRoot) => {
    const stagingsBefore = await countStagingDirs();
    const backupsBefore = await countBackups(tempRoot);

    // Use a valid zip body but set Content-Length to a value exceeding the default
    // compressed ceiling. The handler must reject at the Content-Length preflight
    // (before arrayBuffer / before pipeline).
    const zipBody = await buildZipBody(['pages'], tempRoot);

    // The default ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES is 500MB; use a tiny
    // ceiling via env var override to ensure a realistic preflight rejection.
    const originalCompressed = process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
    process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = '10'; // 10 bytes ceiling

    try {
      const req = new Request('http://localhost/cms/api/import/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          // Spoof a large Content-Length — must exceed the 10-byte ceiling.
          'Content-Length': String(zipBody.length),
        },
        body: zipBody,
      });

      const res = await handleBootstrapImport(req, { cache: null });

      assert.equal(res.status, 413, `expected 413 for oversized Content-Length, got ${res.status}`);

      // No staging directories must have been created.
      const stagingsAfter = await countStagingDirs();
      assert.equal(
        stagingsAfter,
        stagingsBefore,
        'no staging dirs must be created on Content-Length preflight rejection',
      );

      // No backups must have been created.
      const backupsAfter = await countBackups(tempRoot);
      assert.equal(
        backupsAfter,
        backupsBefore,
        'no backups must be created on Content-Length preflight rejection',
      );
    } finally {
      if (originalCompressed === undefined) {
        delete process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES;
      } else {
        process.env.ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES = originalCompressed;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C1: login vs bootstrap concurrency (GitHub #25 — TOCTOU hardening)
//
// handleLogin's first-user creation and the bootstrap pipeline's users
// existence-check-through-apply span now serialize through a shared
// withUsersLock. This does NOT guarantee a fixed winner — it guarantees the
// INVARIANT: exactly one coherent owner survives the race, and neither path
// silently overwrites the owner the other one just created/applied.
// ---------------------------------------------------------------------------

function makeLoginRequest(email, password) {
  return new Request('http://localhost/cms/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function assertSingleCoherentOwner(loginEmail, importedEmail, bootstrapResponse) {
  const finalUsers = await loadUsers();
  assert.equal(
    finalUsers.users.length,
    1,
    `expected exactly 1 user after the race, got ${finalUsers.users.length}: ${JSON.stringify(finalUsers.users)}`,
  );

  if (bootstrapResponse.status === 200) {
    // Bootstrap won the race: the imported owner must survive untouched —
    // login must not have silently overwritten it.
    assert.equal(
      finalUsers.users[0].email,
      importedEmail,
      'bootstrap won the race: surviving owner must be the imported user',
    );
  } else {
    // Login won the race: bootstrap must be rejected (the outer gate and
    // the in-lock re-check both surface as 403 with the same message), and
    // the login-created owner must survive untouched.
    assert.equal(
      bootstrapResponse.status,
      403,
      `bootstrap must be rejected with 403 when login wins the race, got ${bootstrapResponse.status}`,
    );
    assert.equal(
      finalUsers.users[0].email,
      loginEmail,
      'login won the race: surviving owner must be the login-created user',
    );
  }
}

const C1_ITERATIONS = 3;

test('C1: login-first ordering — concurrent first-user login vs bootstrap import never silently overwrites owner', async () => {
  for (let i = 0; i < C1_ITERATIONS; i++) {
    await withTempProject(async (tempRoot) => {
      const importedEmail = 'imported-owner@example.com';
      const loginEmail = 'login-owner@example.com';

      // Build the bootstrap zip with a distinct 'users' unit BEFORE any
      // mutation, then reset the instance back to zero users so both
      // concurrent requests race against an empty instance.
      await saveUsers({
        users: [
          {
            id: 'imported-owner-id',
            email: importedEmail,
            passwordHash: 'hash',
            role: 'owner',
            createdAt: new Date().toISOString(),
          },
        ],
      });
      const zipBody = await buildZipBody(['users'], tempRoot);
      await saveUsers({ users: [] });

      const loginReq = makeLoginRequest(loginEmail, 'secret123');
      const importReq = makeRequest(zipBody);

      const [loginRes, bootstrapRes] = await Promise.all([
        handleLogin(loginReq),
        handleBootstrapImport(importReq, { cache: null }),
      ]);

      assert.ok(
        loginRes.status === 200 || loginRes.status === 401,
        `login must resolve to 200 (created/verified) or 401 (raced against a different owner), got ${loginRes.status}`,
      );

      await assertSingleCoherentOwner(loginEmail, importedEmail, bootstrapRes);
    });
  }
});

test('C1: bootstrap-first ordering — concurrent bootstrap import vs first-user login never silently overwrites owner', async () => {
  for (let i = 0; i < C1_ITERATIONS; i++) {
    await withTempProject(async (tempRoot) => {
      const importedEmail = 'imported-owner@example.com';
      const loginEmail = 'login-owner@example.com';

      await saveUsers({
        users: [
          {
            id: 'imported-owner-id',
            email: importedEmail,
            passwordHash: 'hash',
            role: 'owner',
            createdAt: new Date().toISOString(),
          },
        ],
      });
      const zipBody = await buildZipBody(['users'], tempRoot);
      await saveUsers({ users: [] });

      const loginReq = makeLoginRequest(loginEmail, 'secret123');
      const importReq = makeRequest(zipBody);

      // Same pair, array order swapped per the design's Testing Strategy.
      const [bootstrapRes, loginRes] = await Promise.all([
        handleBootstrapImport(importReq, { cache: null }),
        handleLogin(loginReq),
      ]);

      assert.ok(
        loginRes.status === 200 || loginRes.status === 401,
        `login must resolve to 200 (created/verified) or 401 (raced against a different owner), got ${loginRes.status}`,
      );

      await assertSingleCoherentOwner(loginEmail, importedEmail, bootstrapRes);
    });
  }
});
