/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-alt-dimensions.test.js
 * Tests for upload dimension capture (image-size integration) and
 * PATCH default-alt endpoint.
 * RED phase: written before implementation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMedia, saveUsers } from '../dist/api/data.js';
import { handleUpload, handleUpdateMediaAlt } from '../dist/api/handlers.js';
import { drainVariantJobs } from '../dist/utils/variant-generator.js';

// Minimal JWT for auth tests
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function makeAuthToken() {
  // getAuth is stateful (ADR-0027, #124): the token's user must exist in the store with a
  // matching tokenVersion. Seed a persistent owner, then sign only sub + tokenVersion.
  await saveUsers({
    users: [
      {
        id: 'test-user-id',
        email: 'test@example.com',
        passwordHash: 'c2FsdA==:aGFzaA==',
        role: 'owner',
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ],
  });
  return new SignJWT({ tokenVersion: 1 })
    .setSubject('test-user-id')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-alt-dims-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();
  try {
    await fn(tempRoot);
  } finally {
    // Drain fire-and-forget variant jobs before restoring the env var, so a job
    // that outlives fn writes to the temp root (still active here) not cwd (#96).
    await drainVariantJobs();
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

// Real minimal 1×1 PNG (67 bytes — valid PNG with IHDR declaring 1×1)
// Created from known-good minimal PNG bytes.
const MINIMAL_PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415478016360f8cfc00000000200013358a420000000049454e44ae426082',
  'hex',
);

// SVG without viewBox — image-size should throw / return no dims
const SVG_NO_VIEWBOX = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>',
);

// SVG with viewBox — image-size should return dims
const SVG_WITH_VIEWBOX = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><circle r="10"/></svg>',
);

function makeUploadRequest(fileContent, fileName, mimeType) {
  return new Request('http://localhost/cms/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'x-cms-filename': encodeURIComponent(fileName),
    },
    body: new Uint8Array(fileContent instanceof Uint8Array ? fileContent : Array.from(fileContent)),
  });
}

// ─── Upload dimension capture tests ──────────────────────────────────────────

test('T-10: handleUpload — PNG upload captures width and height (SC-4.1)', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(MINIMAL_PNG_1x1, 'photo.png', 'image/png');
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'upload should succeed');
    const body = await res.json();
    assert.ok(body.entry, 'response should include entry');
    // For a 1×1 PNG, image-size should return width:1, height:1
    assert.equal(typeof body.entry.width, 'number', 'width should be a number');
    assert.equal(typeof body.entry.height, 'number', 'height should be a number');
    assert.equal(body.entry.width, 1);
    assert.equal(body.entry.height, 1);

    // Verify persisted in registry
    const media = await loadMedia();
    const entry = media.uploads[0];
    assert.equal(entry.width, 1);
    assert.equal(entry.height, 1);
  });
});

test('T-11: handleUpload — SVG without viewBox — upload succeeds, no dimensions (SC-4.3)', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(SVG_NO_VIEWBOX, 'icon.svg', 'image/svg+xml');
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'upload should succeed even without dims');
    const body = await res.json();
    assert.ok(body.entry, 'response should include entry');
    // No width/height should be in the entry
    assert.equal(body.entry.width, undefined, 'width should be absent');
    assert.equal(body.entry.height, undefined, 'height should be absent');
  });
});

test('handleUpload — corrupt buffer — upload succeeds, no dimensions (SC-4.4)', async () => {
  await withTempProject(async () => {
    // Truncated/corrupt PNG header
    const corruptBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // PNG magic only, no IHDR
    const req = makeUploadRequest(corruptBuf, 'broken.png', 'image/png');
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'upload should still succeed on parse error');
    const body = await res.json();
    assert.ok(body.entry, 'response should include entry');
    assert.equal(body.entry.width, undefined, 'width absent on parse error');
    assert.equal(body.entry.height, undefined, 'height absent on parse error');
  });
});

test('handleUpload — SVG with viewBox — captures dimensions (SC-4.2)', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(SVG_WITH_VIEWBOX, 'icon.svg', 'image/svg+xml');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    // image-size should return width:100, height:200 from viewBox
    assert.equal(body.entry.width, 100);
    assert.equal(body.entry.height, 200);
  });
});

// ─── PATCH /cms/api/media/{id} tests ─────────────────────────────────────────

test('T-12: PATCH /cms/api/media — updates alt, returns 200 (SC-5.1)', async () => {
  await withTempProject(async (_tempRoot) => {
    // Upload something first to get an entry id
    const uploadReq = makeUploadRequest(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'test.jpg',
      'image/jpeg',
    );
    const uploadRes = await handleUpload(uploadReq);
    assert.equal(uploadRes.status, 200);
    const { entry } = await uploadRes.json();

    const token = await makeAuthToken();
    const patchReq = new Request(`http://localhost/cms/api/media/${entry.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ alt: 'A beautiful sunset' }),
    });

    const res = await handleUpdateMediaAlt(entry.id, patchReq);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entry.id, entry.id);
    assert.equal(body.entry.alt, 'A beautiful sunset');

    // Verify persisted
    const media = await loadMedia();
    const persisted = media.uploads.find((u) => u.id === entry.id);
    assert.equal(persisted.alt, 'A beautiful sunset');
  });
});

test('T-13: PATCH /cms/api/media — unknown id returns 404 (SC-5.2)', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media/unknown-id', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ alt: 'Test' }),
    });

    const res = await handleUpdateMediaAlt('unknown-id', req);
    assert.equal(res.status, 404);
  });
});

test('T-14: PATCH /cms/api/media — unauthenticated returns 401 (SC-5.3)', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/media/some-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt: 'Test' }),
    });

    const res = await handleUpdateMediaAlt('some-id', req);
    assert.equal(res.status, 401);
  });
});

test('PATCH /cms/api/media — missing alt in body returns 400 (SC-5.4)', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media/some-id', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'some-id' }), // no alt
    });

    const res = await handleUpdateMediaAlt('some-id', req);
    assert.equal(res.status, 400);
  });
});
