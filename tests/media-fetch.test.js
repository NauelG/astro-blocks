/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Tests for the fetchMedia shared utility and media formatters.
 *
 * NOTE: fetchMedia is a browser-side module (uses window/sessionStorage/fetch).
 * We test it by:
 *   1. Importing from dist/ after build
 *   2. Stubbing globalThis.fetch
 *   3. Providing a fake sessionStorage environment
 *
 * The formatters (formatBytes, formatDimensions, formatMediaDate) are pure
 * functions and can be tested directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ─── Task 2.1 [RED] — fetchMedia query string: supplied params only ──────────
// We import the formatter functions directly (they are pure, no DOM deps).
// fetchMedia itself needs a browser environment — we'll test it via its
// query-string construction by intercepting globalThis.fetch.

// ─── Formatter tests (can be tested immediately after build) ─────────────────

const { formatBytes, formatDimensions, formatMediaDate } = await import('../dist/routes/admin/client/media-fetch.js');

// formatBytes
test('formatBytes: bytes < 1024 returns B suffix', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes: bytes in KB range', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('formatBytes: bytes in MB range', () => {
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(Math.round(1.5 * 1024 * 1024)), '1.5 MB');
});

// formatDimensions
test('formatDimensions: both w and h present returns w×h', () => {
  assert.equal(formatDimensions(1920, 1080), '1920×1080');
  assert.equal(formatDimensions(400, 300), '400×300');
});

test('formatDimensions: missing w returns —', () => {
  assert.equal(formatDimensions(undefined, 1080), '—');
});

test('formatDimensions: missing h returns —', () => {
  assert.equal(formatDimensions(1920, undefined), '—');
});

test('formatDimensions: both missing returns —', () => {
  assert.equal(formatDimensions(undefined, undefined), '—');
  assert.equal(formatDimensions(), '—');
});

// formatMediaDate
test('formatMediaDate: returns a non-empty string for valid ISO date', () => {
  const result = formatMediaDate('2026-05-10T12:00:00Z');
  assert.ok(typeof result === 'string' && result.length > 0, 'should return a non-empty string');
  // Should NOT just be the raw ISO string — it's formatted
  // We don't assert exact locale string since it's locale-dependent
});

test('formatMediaDate: handles date string without time', () => {
  const result = formatMediaDate('2026-01-01');
  assert.ok(typeof result === 'string' && result.length > 0);
});

// ─── fetchMedia tests: query-string construction via fetch stub ───────────────

// We need to simulate a browser-like environment for fetchMedia.
// Set up minimal sessionStorage stub and fetch stub.

// Helper: set up fake browser env
function setupFakeBrowserEnv(token = 'test-token-123') {
  // Stub sessionStorage with our token
  const storage = { 'cms-token': token };
  globalThis.sessionStorage = {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, val) => { storage[key] = val; },
    removeItem: (key) => { delete storage[key]; },
  };
  // Stub window.getCmsToken to return token
  globalThis.window = globalThis.window ?? {};
  globalThis.window.getCmsToken = () => token;
}

function teardownFakeBrowserEnv() {
  delete globalThis.sessionStorage;
  if (globalThis.window) {
    delete globalThis.window.getCmsToken;
  }
}

// Task 2.1 [RED] — fetchMedia query string has only supplied params
test('fetchMedia: q and page supplied — query contains q and page, no limit', async () => {
  setupFakeBrowserEnv();
  let capturedUrl = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = url.toString();
    return { ok: true, json: async () => ({ uploads: [], total: 0, page: 2, limit: 24 }) };
  };

  try {
    const { fetchMedia } = await import('../dist/routes/admin/client/media-fetch.js');
    await fetchMedia({ q: 'cat', page: 2 });
    assert.ok(capturedUrl !== null, 'fetch must have been called');
    assert.ok(capturedUrl.includes('q=cat'), `URL should include q=cat, got: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('page=2'), `URL should include page=2, got: ${capturedUrl}`);
    assert.ok(!capturedUrl.includes('limit='), `URL should NOT include limit=, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
    teardownFakeBrowserEnv();
  }
});

// Task 2.2 [RED] — fetchMedia always sends Authorization header
test('fetchMedia: auth header is always sent', async () => {
  setupFakeBrowserEnv('my-secret-token');
  let capturedInit = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ uploads: [], total: 0, page: 1, limit: 24 }) };
  };

  try {
    const { fetchMedia } = await import('../dist/routes/admin/client/media-fetch.js');
    await fetchMedia({});
    assert.ok(capturedInit !== null, 'fetch must have been called with init');
    const authHeader = capturedInit?.headers?.['Authorization'] ?? capturedInit?.headers?.get?.('Authorization');
    assert.ok(authHeader, 'Authorization header must be set');
    assert.ok(authHeader.startsWith('Bearer '), 'Authorization header must be Bearer token');
  } finally {
    globalThis.fetch = originalFetch;
    teardownFakeBrowserEnv();
  }
});

// Task 2.3 [RED] — fetchMedia with no params produces empty or absent query string
test('fetchMedia: no params — query string is empty or absent', async () => {
  setupFakeBrowserEnv();
  let capturedUrl = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = url.toString();
    return { ok: true, json: async () => ({ uploads: [], total: 0, page: 1, limit: 24 }) };
  };

  try {
    const { fetchMedia } = await import('../dist/routes/admin/client/media-fetch.js');
    await fetchMedia();
    assert.ok(capturedUrl !== null, 'fetch must have been called');
    // URL should not have any query params
    const hasQuery = capturedUrl.includes('?') && capturedUrl.split('?')[1].length > 0;
    assert.ok(!hasQuery, `URL should have no query params, got: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
    teardownFakeBrowserEnv();
  }
});

// Task 2.4 [RED] — fetchMedia returns safe defaults on !ok response
test('fetchMedia: !ok response returns safe default envelope', async () => {
  setupFakeBrowserEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: false, json: async () => ({}) };
  };

  try {
    const { fetchMedia } = await import('../dist/routes/admin/client/media-fetch.js');
    const result = await fetchMedia({ page: 3 });
    assert.deepEqual(result.uploads, [], 'uploads should be empty array on error');
    assert.equal(result.total, 0, 'total should be 0 on error');
    assert.equal(result.page, 1, 'page should be 1 on error');
    assert.equal(result.limit, 24, 'limit should be 24 on error');
  } finally {
    globalThis.fetch = originalFetch;
    teardownFakeBrowserEnv();
  }
});
