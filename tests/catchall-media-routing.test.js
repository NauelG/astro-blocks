/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * catchall-media-routing.test.js — routing/dispatch coverage for the media
 * endpoints in routes/api/catchall.ts.
 *
 * These tests exercise the catchall GET/POST/PATCH/DELETE dispatchers (NOT the
 * handlers directly). The goal is to prove:
 *   - the correct handler is selected for each media route,
 *   - the :id segment is extracted from seg[1] (replace) / seg[1] (patch),
 *   - ensureAuth fires BEFORE dispatch (every media route → 401 without a token),
 *   - unknown method/path → 404.
 *
 * We call the exported route functions with a crafted APIContext ({ request, cache })
 * and a Bearer token (same JWT approach as the other media tests). Auth is checked
 * inside ensureAuth (catchall) for GET/POST/PATCH; the per-handler getAuth check is
 * a second layer and is fine to pass through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';

import { ensureDefaultFiles, appendMediaEntry, generateId, loadMedia } from '../dist/api/data.js';
import { GET, POST, PATCH, DELETE } from '../dist/routes/api/catchall.js';

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-catchall-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();
  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/** Minimal APIContext stub. cache disabled so handlers skip invalidation. */
function ctx(request) {
  return { request, cache: { enabled: false } };
}

function authedGet(url, token) {
  return new Request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
}

/** Seed a real on-disk media entry so usage/replace can find it (and reconcile keeps it). */
async function seedEntry(tempRoot, { subdir = '2026/06', filename = 'cat.jpg', mimeType = 'image/jpeg' } = {}) {
  const dir = path.join(tempRoot, 'public', 'uploads', subdir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  const url = `/uploads/${subdir}/${filename}`;
  const entry = {
    id: generateId(),
    url,
    filename,
    size: 4,
    mimeType,
    createdAt: new Date().toISOString(),
    status: 'ready',
  };
  await appendMediaEntry(entry);
  return entry;
}

// ─── GET /cms/api/media → list handler ────────────────────────────────────────

test('ROUTE-GET-list: GET /cms/api/media dispatches to media list (envelope shape)', async () => {
  await withTempProject(async (tempRoot) => {
    await seedEntry(tempRoot);
    const token = await makeAuthToken();
    const res = await GET(ctx(authedGet('http://localhost/cms/api/media', token)));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.uploads), 'list response has uploads array');
    assert.ok(typeof body.total === 'number', 'list response has total');
    assert.ok(typeof body.page === 'number', 'list response has page');
  });
});

// ─── GET /cms/api/media/:id/usage → usage handler ────────────────────────────

test('ROUTE-GET-usage: GET /cms/api/media/:id/usage dispatches to usage handler', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedEntry(tempRoot);
    const token = await makeAuthToken();
    const res = await GET(ctx(authedGet(`http://localhost/cms/api/media/${entry.id}/usage`, token)));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.count === 'number', 'usage response has count');
    assert.ok(Array.isArray(body.usages), 'usage response has usages array');
  });
});

// ─── POST /cms/api/media/:id/replace → replace handler, id from seg[1] ────────

test('ROUTE-POST-replace: POST /cms/api/media/:id/replace dispatches with id from seg[1]', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedEntry(tempRoot);
    const token = await makeAuthToken();
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1])], 'new.jpg', { type: 'image/jpeg' }));
    const req = new Request(`http://localhost/cms/api/media/${entry.id}/replace`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const res = await POST(ctx(req));
    assert.equal(res.status, 200, 'replace dispatched and succeeded');
    const body = await res.json();
    assert.equal(body.entry.id, entry.id, 'id correctly extracted from seg[1]');
    assert.equal(body.entry.status, 'processing', 'replace set status processing');
  });
});

test('ROUTE-POST-replace-unknown: POST replace with unknown id → 404 (id passed through)', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([0xff, 0xd8])], 'x.jpg', { type: 'image/jpeg' }));
    const req = new Request('http://localhost/cms/api/media/does-not-exist/replace', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const res = await POST(ctx(req));
    assert.equal(res.status, 404, 'unknown id flows to handler and returns 404');
  });
});

// ─── PATCH /cms/api/media/:id → updateAlt handler ────────────────────────────

test('ROUTE-PATCH-alt: PATCH /cms/api/media/:id dispatches to updateMediaAlt', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedEntry(tempRoot);
    const token = await makeAuthToken();
    const req = new Request(`http://localhost/cms/api/media/${entry.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt: 'Updated alt text' }),
    });
    const res = await PATCH(ctx(req));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entry.alt, 'Updated alt text', 'alt updated via PATCH dispatch');
    // Persisted
    const m = await loadMedia();
    assert.equal(m.uploads.find((u) => u.id === entry.id).alt, 'Updated alt text');
  });
});

// ─── ensureAuth fires BEFORE dispatch — every NEW media route → 401 ──────────

test('ROUTE-AUTH-list: GET /cms/api/media without token → 401', async () => {
  await withTempProject(async () => {
    const res = await GET(ctx(new Request('http://localhost/cms/api/media')));
    assert.equal(res.status, 401);
  });
});

test('ROUTE-AUTH-usage: GET /cms/api/media/:id/usage without token → 401', async () => {
  await withTempProject(async () => {
    const res = await GET(ctx(new Request('http://localhost/cms/api/media/any-id/usage')));
    assert.equal(res.status, 401);
  });
});

test('ROUTE-AUTH-replace: POST /cms/api/media/:id/replace without token → 401', async () => {
  await withTempProject(async () => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([0xff, 0xd8])], 'x.jpg', { type: 'image/jpeg' }));
    const req = new Request('http://localhost/cms/api/media/any-id/replace', { method: 'POST', body: fd });
    const res = await POST(ctx(req));
    assert.equal(res.status, 401);
  });
});

test('ROUTE-AUTH-patch: PATCH /cms/api/media/:id without token → 401', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/media/any-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt: 'x' }),
    });
    const res = await PATCH(ctx(req));
    assert.equal(res.status, 401);
  });
});

// ─── unknown method/path → 404 (after auth) ──────────────────────────────────

test('ROUTE-404-unknown-path: GET unknown path → 404', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const res = await GET(ctx(authedGet('http://localhost/cms/api/media/123/nonsense/extra', token)));
    assert.equal(res.status, 404);
  });
});

test('ROUTE-404-patch-wrong-shape: PATCH /cms/api/media (no id) → 404', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt: 'x' }),
    });
    const res = await PATCH(ctx(req));
    assert.equal(res.status, 404, 'media PATCH requires exactly one id segment');
  });
});

test('ROUTE-404-delete-media: DELETE /cms/api/media/:id → 404 (no media DELETE route)', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedEntry(tempRoot);
    const token = await makeAuthToken();
    const req = new Request(`http://localhost/cms/api/media/${entry.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await DELETE(ctx(req));
    assert.equal(res.status, 404, 'there is no DELETE /media/:id route — pruning is via DELETE /upload');
  });
});
