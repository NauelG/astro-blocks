/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-replace.test.js — Replace handler tests RE-01..RE-07.
 * Tests the POST /cms/api/media/:id/replace endpoint.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';

import { ensureDefaultFiles, loadMedia, appendMediaEntry, generateId, markMediaVariantsReady } from '../dist/api/data.js';
import { handleReplaceUpload } from '../dist/api/handlers.js';
import { getMediaVariants } from '../dist/utils/getMediaVariants.js';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function makeAuthToken() {
  return new SignJWT({ email: 'test@example.com', role: 'owner' })
    .setSubject('test-user-id')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

// ─── Project fixture helpers ──────────────────────────────────────────────────

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-replace-'));

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
 * Minimal JPEG bytes (enough for a valid file but not a real image).
 * image-size may fail to extract dimensions — that is fine (swallowed by handler).
 */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

/**
 * Create a media entry with a real file on disk and return its registered entry.
 */
async function seedMediaEntry(tempRoot, options = {}) {
  const {
    subdir = '2026/06',
    filename = 'test-image.jpg',
    mimeType = 'image/jpeg',
    content = JPEG_BYTES,
    withVariants = false,
  } = options;

  const uploadsDir = path.join(tempRoot, 'public', 'uploads', subdir);
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, filename), content);

  const url = `/uploads/${subdir}/${filename}`;
  const entry = {
    id: generateId(),
    url,
    filename,
    size: content.length,
    mimeType,
    createdAt: new Date().toISOString(),
    status: 'ready',
  };
  await appendMediaEntry(entry);

  if (withVariants) {
    // Create fake variant files and register them
    const variantFilename = filename.replace('.jpg', '-480.webp');
    await fs.writeFile(path.join(uploadsDir, variantFilename), 'fake webp');
    const variants = [{ format: 'webp', width: 480, url: `/uploads/${subdir}/${variantFilename}` }];
    await markMediaVariantsReady(entry.id, variants);
    // Return the entry with variants from registry
    const m = await loadMedia();
    return m.uploads.find((u) => u.id === entry.id);
  }

  return entry;
}

async function makeReplaceRequest(id, fileContent, fileName, mimeType, authToken) {
  const fd = new FormData();
  const file = new File([fileContent], fileName, { type: mimeType });
  fd.append('file', file);
  return new Request(`http://localhost/cms/api/media/${id}/replace`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: fd,
  });
}

// ─── RE-01: same-MIME replace → 200, bytes overwritten, mimeType/url unchanged ─

test('RE-01: same-MIME replace → 200, bytes overwritten, status=processing, mimeType/url unchanged', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedMediaEntry(tempRoot, { withVariants: true });
    const originalUrl = entry.url;
    const originalMime = entry.mimeType;

    // New JPEG bytes (different content)
    const newContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x99, 0x88]);
    const token = await makeAuthToken();
    const req = await makeReplaceRequest(entry.id, newContent, 'new-photo.jpg', 'image/jpeg', token);
    const res = await handleReplaceUpload(req, entry.id);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert.ok(body.entry, 'response should have entry');
    assert.equal(body.entry.mimeType, originalMime, 'mimeType must not change');
    assert.equal(body.entry.url, originalUrl, 'url must not change');
    assert.equal(body.entry.id, entry.id, 'id must not change');
    assert.equal(body.entry.status, 'processing', 'status should be processing after replace');
    assert.deepEqual(body.entry.variants, [], 'variants should be cleared');
    assert.equal(body.entry.size, newContent.length, 'size should be updated');

    // Verify bytes on disk changed
    const { resolveUploadPath } = await import('../dist/utils/paths.js');
    const filePath = resolveUploadPath(originalUrl);
    const diskBytes = await fs.readFile(filePath);
    assert.deepEqual(Array.from(diskBytes), Array.from(newContent), 'disk bytes should match new content');

    // Variant file should be gone (cascade unlink)
    const variantUrl = entry.variants[0].url;
    const variantPath = resolveUploadPath(variantUrl);
    await assert.rejects(() => fs.stat(variantPath), { code: 'ENOENT' }, 'old variant file should be deleted');
  });
});

// ─── RE-02: different-MIME → 415 ─────────────────────────────────────────────

test('RE-02: different-MIME replace → 415 with expected-type message', async () => {
  await withTempProject(async (tempRoot) => {
    // Entry is JPEG; we upload PNG
    const entry = await seedMediaEntry(tempRoot, { mimeType: 'image/jpeg' });

    const token = await makeAuthToken();
    const req = await makeReplaceRequest(entry.id, PNG_BYTES, 'new.png', 'image/png', token);
    const res = await handleReplaceUpload(req, entry.id);

    assert.equal(res.status, 415);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
    assert.ok(
      body.error.includes('image/jpeg') || body.error.toLowerCase().includes('expected'),
      `Error message should mention expected MIME type, got: ${body.error}`
    );
  });
});

// ─── RE-03: missing file → 400 ───────────────────────────────────────────────

test('RE-03: missing file → 400', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedMediaEntry(tempRoot);
    const token = await makeAuthToken();

    // FormData with no 'file' field
    const fd = new FormData();
    fd.append('other', 'value');
    const req = new Request(`http://localhost/cms/api/media/${entry.id}/replace`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
  });
});

// ─── RE-04: unknown id → 404 ─────────────────────────────────────────────────

test('RE-04: unknown id → 404', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = await makeReplaceRequest('nonexistent-id', JPEG_BYTES, 'img.jpg', 'image/jpeg', token);
    const res = await handleReplaceUpload(req, 'nonexistent-id');
    assert.equal(res.status, 404);
  });
});

// ─── RE-05: no auth → 401 ────────────────────────────────────────────────────

test('RE-05: no auth → 401', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedMediaEntry(tempRoot);
    const fd = new FormData();
    fd.append('file', new File([JPEG_BYTES], 'img.jpg', { type: 'image/jpeg' }));
    const req = new Request(`http://localhost/cms/api/media/${entry.id}/replace`, {
      method: 'POST',
      body: fd,
    });
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 401);
  });
});

// ─── RE-06: oversize → 413 ────────────────────────────────────────────────────

test('RE-06: oversize file → 413', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedMediaEntry(tempRoot);
    const token = await makeAuthToken();

    // 6 MB — over default 5 MB limit
    const bigContent = new Uint8Array(6 * 1024 * 1024);
    const req = await makeReplaceRequest(entry.id, bigContent, 'big.jpg', 'image/jpeg', token);
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
  });
});

// ─── RE-07: non-allowed MIME → 415 ───────────────────────────────────────────

test('RE-07: non-allowed MIME type → 415', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedMediaEntry(tempRoot);
    const token = await makeAuthToken();

    const req = await makeReplaceRequest(entry.id, new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'doc.pdf', 'application/pdf', token);
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
  });
});

// ─── L-2: denylist MIME on replace → 415 (gate runs before same-MIME check) ─────

test('L-2: replace with denylisted MIME (text/html) → 415 (denylist gate runs before same-MIME check)', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed a JPEG entry — the same-MIME check would normally reject text/html as mismatched,
    // but we want to prove the denylist gate fires FIRST (and still returns 415).
    const entry = await seedMediaEntry(tempRoot, { mimeType: 'image/jpeg' });
    const token = await makeAuthToken();

    const req = await makeReplaceRequest(
      entry.id,
      Buffer.from('<script>alert(1)</script>'),
      'evil.html',
      'text/html',
      token
    );
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 415, 'denylisted MIME (text/html) must be rejected with 415 on replace');
    const body = await res.json();
    assert.ok(body.error, 'response must have error message');
  });
});

// ─── P5: replace → render status chain (data layer ↔ getMediaVariants accessor) ─
//
// After a successful replace the entry is status:'processing' + variants:[], and
// the render-time accessor getMediaVariants(url) must reflect that (→ plain-img
// branch in BlockImage). Once markMediaVariantsReady runs, the accessor flips to
// 'ready'. This ties the data-layer status transition to what the component sees.

test('P5: replace → entry processing + variants:[] AND getMediaVariants returns processing → ready', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed an entry that is already ready WITH a variant, so the chain is meaningful
    const entry = await seedMediaEntry(tempRoot, { withVariants: true });
    const url = entry.url;

    // Sanity: before replace the accessor sees ready + variants (picture branch)
    const before = await getMediaVariants(url);
    assert.equal(before.status, 'ready', 'pre-replace accessor sees ready');
    assert.ok(before.variants.length > 0, 'pre-replace accessor sees variants');

    // Replace bytes
    const newContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x12, 0x34]);
    const token = await makeAuthToken();
    const req = await makeReplaceRequest(entry.id, newContent, 'replaced.jpg', 'image/jpeg', token);
    const res = await handleReplaceUpload(req, entry.id);
    assert.equal(res.status, 200);
    const body = await res.json();

    // Data layer: processing + cleared variants
    assert.equal(body.entry.status, 'processing', 'entry status processing after replace');
    assert.deepEqual(body.entry.variants, [], 'entry variants cleared after replace');

    // Render accessor reflects processing → plain-img branch (variants empty)
    const during = await getMediaVariants(url);
    assert.equal(during.status, 'processing', 'accessor sees processing → plain-img branch');
    assert.deepEqual(during.variants, [], 'accessor sees no variants while processing');

    // Now mark ready with new variants — accessor flips to ready (picture branch)
    const newVariants = [
      { format: 'webp', width: 480, url: url.replace('.jpg', '-480.webp') },
      { format: 'avif', width: 480, url: url.replace('.jpg', '-480.avif') },
    ];
    await markMediaVariantsReady(entry.id, newVariants);

    const after = await getMediaVariants(url);
    assert.equal(after.status, 'ready', 'accessor flips to ready after markMediaVariantsReady');
    assert.equal(after.variants.length, 2, 'accessor exposes the new variants');
  });
});
