/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * catchall-401-localization.test.js — issue #60.
 *
 * The central dispatch() (routes/api/catchall.ts) must return a LOCALIZED body for the
 * unauthenticated 401, consistent with its 403/404 siblings. Two call sites:
 *   - matched route requiring auth, no session      -> 401 (localized)
 *   - unmatched path, unauthenticated (info-hiding)  -> 401 (localized, never 404)
 *
 * Drives the exported verb handlers directly (same harness as catchall-authz-routing.test.js).
 * Locale resolution order is cookie > Accept-Language > 'en' (api/handlers/shared.ts).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { GET, PUT } from '../dist/routes/api/catchall.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-catchall-401-'));
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

/** Unauthenticated request, optional Accept-Language to drive locale resolution. */
function unauthReq(url, method, { acceptLanguage } = {}) {
  const headers = {};
  if (acceptLanguage) headers['Accept-Language'] = acceptLanguage;
  return new Request(url, { method, headers });
}

// ── Matched route requiring auth (routes/api/catchall.ts L67) ─────────────────

test('401 on a matched auth route is localized to Spanish (Accept-Language: es)', async () => {
  await withTempProject(async () => {
    const res = await PUT(
      ctx(unauthReq('http://localhost/cms/api/site', 'PUT', { acceptLanguage: 'es' })),
    );
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const body = await res.json();
    assert.equal(body.error, 'No autorizado.');
  });
});

test('401 on a matched auth route falls back to English when no locale is requested', async () => {
  await withTempProject(async () => {
    const res = await PUT(ctx(unauthReq('http://localhost/cms/api/site', 'PUT')));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Unauthorized.');
  });
});

// ── Unmatched path, unauthenticated — info-hiding 401 (catchall.ts L57) ────────

test('401 on an unmatched path (info-hiding) is localized, never a 404', async () => {
  await withTempProject(async () => {
    const res = await GET(
      ctx(unauthReq('http://localhost/cms/api/does-not-exist', 'GET', { acceptLanguage: 'es' })),
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'No autorizado.');
  });
});

// ── R6: both 401 bodies are byte-identical (info-hiding stays an oracle-free gate) ──

test('matched-route and unmatched-path 401 bodies are identical for the same locale', async () => {
  await withTempProject(async () => {
    const matched = await PUT(
      ctx(unauthReq('http://localhost/cms/api/site', 'PUT', { acceptLanguage: 'es' })),
    );
    const unmatched = await GET(
      ctx(unauthReq('http://localhost/cms/api/does-not-exist', 'GET', { acceptLanguage: 'es' })),
    );
    assert.equal(matched.status, 401);
    assert.equal(unmatched.status, 401);
    assert.deepEqual(await matched.json(), await unmatched.json());
  });
});
