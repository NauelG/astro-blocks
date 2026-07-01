/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * B-2: handleExport handler tests.
 * Verifies auth gates, query parsing, and response shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { handleExport } from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-export-handler-'));

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

/** Minimal owner AuthUser for tests. */
const OWNER_USER = { id: 'user-1', email: 'owner@example.com', role: 'owner' };
/** Minimal non-owner AuthUser for tests. */
const REGULAR_USER = { id: 'user-2', email: 'user@example.com', role: 'user' };

// B-2: 200 + correct headers on valid request

test('B-2: handleExport returns 200 with Content-Type application/zip for valid owner + units', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);

    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert.ok(ct.includes('application/zip'), `Content-Type must include application/zip, got "${ct}"`);
  });
});

test('B-2: handleExport response has Content-Disposition attachment header with .zip filename', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);

    const cd = res.headers.get('content-disposition') ?? '';
    assert.ok(cd.includes('attachment'), `Content-Disposition must include "attachment", got "${cd}"`);
    assert.ok(cd.includes('.zip'), `Content-Disposition filename must end with .zip, got "${cd}"`);
  });
});

test('B-2: handleExport response body streams valid zip bytes (PK magic)', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);

    // Consume the first chunk of the body
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();

    assert.ok(value instanceof Uint8Array, 'body must stream Uint8Array chunks');
    assert.equal(value[0], 0x50, 'PK byte 0');
    assert.equal(value[1], 0x4b, 'PK byte 1');
  });
});

// B-2: multiple units in query string

test('B-2: handleExport accepts multiple units via comma-separated ?units param', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages,users', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200 for multiple units, got ${res.status}`);
  });
});

// B-2: 400 on empty units

test('B-2: handleExport returns 400 when ?units param is empty string', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);
    assert.equal(res.status, 400, `expected 400 for empty units, got ${res.status}`);
  });
});

test('B-2: handleExport returns 400 when ?units param is absent', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);
    assert.equal(res.status, 400, `expected 400 for missing units, got ${res.status}`);
  });
});

// B-2: 400 on invalid unit name

test('B-2: handleExport returns 400 when ?units contains an unknown unit name', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages,bogus-unit', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);
    assert.equal(res.status, 400, `expected 400 for invalid unit, got ${res.status}`);
  });
});

// B-2: 401 when authUser is null

test('B-2: handleExport returns 401 when authUser is null', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, null);
    assert.equal(res.status, 401, `expected 401 for no auth, got ${res.status}`);
  });
});

test('B-2: handleExport returns 401 when authUser is undefined', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, undefined);
    assert.equal(res.status, 401, `expected 401 for undefined auth, got ${res.status}`);
  });
});

// B-2: 403 when non-owner

test('B-2: handleExport returns 403 when authUser role is not owner', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages', {
      method: 'GET',
    });
    const res = await handleExport(req, REGULAR_USER);
    assert.equal(res.status, 403, `expected 403 for non-owner, got ${res.status}`);
  });
});

// H-1: deduplicate units — duplicate query param must not produce duplicate zip entries

import { readableStreamToFflateUnzip } from '../dist/api/backup-stream.js';

test('H-1: handleExport with ?units=pages,pages returns 200 and zip has exactly one data/pages.json entry', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/export?units=pages,pages', {
      method: 'GET',
    });
    const res = await handleExport(req, OWNER_USER);
    assert.equal(res.status, 200, `expected 200 for duplicate units, got ${res.status}`);

    // Consume and parse the zip
    const reader = res.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const zipBuf = Buffer.allocUnsafe(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      zipBuf.set(chunk, offset);
      offset += chunk.length;
    }

    const entryNames = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(zipBuf));
        controller.close();
      },
    });
    await readableStreamToFflateUnzip(stream, async (name) => {
      entryNames.push(name);
    });

    const pagesEntries = entryNames.filter((n) => n === 'data/pages.json');
    assert.equal(
      pagesEntries.length,
      1,
      `zip must contain exactly one data/pages.json entry, got ${pagesEntries.length}`,
    );
  });
});
