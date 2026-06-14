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

import { ensureDefaultFiles, loadMedia } from '../dist/api/data.js';
import { handleUpload, handleUpdateMediaAlt } from '../dist/api/handlers.js';

// Minimal JWT for auth tests
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function makeAuthToken() {
  return new SignJWT({ email: 'test@example.com', role: 'owner' })
    .setSubject('test-user-id')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

/**
 * Poll loadMedia() until no entry has status:'processing'.
 * Drains fire-and-forget generateAndPersistVariants calls from handleUpload
 * before ASTRO_BLOCKS_PROJECT_ROOT is restored, preventing writes to repo root.
 */
async function drainVariantJobs(maxWaitMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const media = await loadMedia();
    const pending = media.uploads.some((u) => u.status === 'processing');
    if (!pending) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-alt-dims-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();
  try {
    await fn(tempRoot);
    // Drain any fire-and-forget variant jobs before restoring the env var.
    await drainVariantJobs();
  } finally {
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
  'hex'
);

// Real minimal JPEG (with valid JPEG SOF0 dimensions 1×1)
// SOI + APP0 + SOF0 declaring 1×1 + EOI
const MINIMAL_JPEG_1x1 = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000' + // SOI + APP0
  'ffdb0043000102020201020202030303030403040505040404050a07070605' +
  '0a0b0a0b0b0a0a0b0a0b0a0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b' +
  '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b' +
  'ffc000110800010001030111000211010311010fffd9',
  'hex'
);

// SVG without viewBox — image-size should throw / return no dims
const SVG_NO_VIEWBOX = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
);

// SVG with viewBox — image-size should return dims
const SVG_WITH_VIEWBOX = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><circle r="10"/></svg>'
);

function makeUploadRequest(fileContent, fileName, mimeType) {
  const fd = new FormData();
  const file = new File([fileContent], fileName, { type: mimeType });
  fd.append('file', file);
  return new Request('http://localhost/cms/api/upload', {
    method: 'POST',
    body: fd,
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
  await withTempProject(async (tempRoot) => {
    // Upload something first to get an entry id
    const uploadReq = makeUploadRequest(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'test.jpg',
      'image/jpeg'
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
