/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMedia, saveMedia } from '../dist/api/data.js';
import { handleGetMedia } from '../dist/api/handlers.js';

// Minimal JWT creation for auth — tests use getAuth which reads from Authorization header
// We create a Bearer token using the same JWT_SECRET as handlers.ts (default: 'cms-jwt-secret-change-me')
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function makeAuthToken() {
  return new SignJWT({ email: 'test@example.com', role: 'owner' })
    .setSubject('test-user-id')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-media-list-'));

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

// T14-05: GET /cms/api/media unauthenticated → 401
test('T14-05: GET /cms/api/media without auth returns 401', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/media');
    const res = await handleGetMedia(req);
    assert.equal(res.status, 401);
  });
});

// T14-06: GET /cms/api/media authenticated, empty registry → { uploads: [] }
test('T14-06: GET /cms/api/media authenticated with empty registry returns empty array', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.uploads));
    assert.equal(body.uploads.length, 0);
  });
});

// T14-07: GET /cms/api/media with orphan entry (file missing) → entry pruned, not in response
test('T14-07: GET /cms/api/media prunes registry entries whose files are missing', async () => {
  await withTempProject(async (tempRoot) => {
    // Add entries to registry: A (will have file), B (orphan — no file), C (will have file)
    const uploadsDir = path.join(tempRoot, 'public', 'uploads', '2026', '06');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'a.jpg'), 'fake-image-a');
    await fs.writeFile(path.join(uploadsDir, 'c.jpg'), 'fake-image-c');
    // B file does NOT exist

    const now = new Date().toISOString();
    const existingMedia = {
      uploads: [
        { id: 'entry-a', url: '/uploads/2026/06/a.jpg', filename: 'a.jpg', size: 12, mimeType: 'image/jpeg', createdAt: now },
        { id: 'entry-b', url: '/uploads/2026/06/b.jpg', filename: 'b.jpg', size: 12, mimeType: 'image/jpeg', createdAt: now },
        { id: 'entry-c', url: '/uploads/2026/06/c.jpg', filename: 'c.jpg', size: 12, mimeType: 'image/jpeg', createdAt: now },
      ],
    };
    await saveMedia(existingMedia);

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();

    // Only A and C should be present
    assert.equal(body.uploads.length, 2);
    const ids = body.uploads.map((u) => u.id);
    assert.ok(ids.includes('entry-a'));
    assert.ok(ids.includes('entry-c'));
    assert.ok(!ids.includes('entry-b'));

    // Registry on disk should also have been pruned
    const afterMedia = await loadMedia();
    assert.equal(afterMedia.uploads.length, 2);
    const afterIds = afterMedia.uploads.map((u) => u.id);
    assert.ok(!afterIds.includes('entry-b'));
  });
});

// ─── T-15, T-16: loadMedia backwards tolerance (REQ-3) ───────────────────────

test('T-15: loadMedia — old entry without alt/width/height loads cleanly (SC-3.1)', async () => {
  await withTempProject(async () => {
    const now = new Date().toISOString();
    const oldEntry = {
      id: 'old-entry',
      url: '/uploads/2026/06/old.jpg',
      filename: 'old.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: now,
      // no alt, no width, no height
    };
    await saveMedia({ uploads: [oldEntry] });

    const media = await loadMedia();
    assert.equal(media.uploads.length, 1, 'old entry should not be dropped');
    const entry = media.uploads[0];
    assert.equal(entry.id, 'old-entry');
    assert.equal(entry.alt, undefined, 'alt should be undefined (not set)');
    assert.equal(entry.width, undefined, 'width should be undefined (not set)');
    assert.equal(entry.height, undefined, 'height should be undefined (not set)');
  });
});

test('T-16: loadMedia — new entry with alt/width/height loads cleanly (SC-3.2)', async () => {
  await withTempProject(async () => {
    const now = new Date().toISOString();
    const newEntry = {
      id: 'new-entry',
      url: '/uploads/2026/06/new.jpg',
      filename: 'new.jpg',
      size: 2000,
      mimeType: 'image/jpeg',
      createdAt: now,
      alt: 'A dog',
      width: 1024,
      height: 768,
    };
    await saveMedia({ uploads: [newEntry] });

    const media = await loadMedia();
    assert.equal(media.uploads.length, 1, 'new entry should load cleanly');
    const entry = media.uploads[0];
    assert.equal(entry.id, 'new-entry');
    assert.equal(entry.alt, 'A dog');
    assert.equal(entry.width, 1024);
    assert.equal(entry.height, 768);
  });
});
