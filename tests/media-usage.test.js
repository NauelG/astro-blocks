/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-usage.test.js — findMediaUsages aggregator + usage endpoint tests.
 * Covers FMU-01..06 and UE-01..04.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';

import { ensureDefaultFiles, findMediaUsages, appendMediaEntry, generateId } from '../dist/api/data.js';
import { handleGetMediaUsage } from '../dist/api/handlers.js';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function makeAuthToken() {
  return new SignJWT({ email: 'test@example.com', role: 'owner' })
    .setSubject('test-user-id')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

async function makeAuthRequest(url) {
  const token = await makeAuthToken();
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Project fixture helper ────────────────────────────────────────────────────

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-usage-'));

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

async function writeJson(tempRoot, filename, data) {
  const filePath = path.join(tempRoot, 'data', filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
}

// ─── FMU-01: one page block reference → count:1 ───────────────────────────────

test('FMU-01: one page block ref → count:1, source:page', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/foo.jpg';
    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'page-1',
          title: { en: 'Home' },
          slug: { en: '/' },
          status: { en: 'published' },
          blocks: [
            { type: 'Hero', props: { hero: { url: TARGET, alt: '' } } },
          ],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const result = await findMediaUsages(TARGET);
    assert.equal(result.count, 1);
    assert.equal(result.usages.length, 1);
    assert.equal(result.usages[0].source, 'page');
    assert.equal(result.usages[0].id, 'page-1');
    assert.equal(typeof result.usages[0].label, 'string');
    assert.equal(result.usages[0].blockIndex, 0);
  });
});

// ─── FMU-02: global block reference → source:globalBlock ──────────────────────

test('FMU-02: global block ref → count:1, source:globalBlock', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/foo.jpg';
    await writeJson(tempRoot, 'pages.json', { pages: [] });
    await writeJson(tempRoot, 'global-blocks.json', {
      globalBlocks: {
        'header-block': {
          props: { logo: { url: TARGET, alt: 'logo' } },
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const result = await findMediaUsages(TARGET);
    assert.equal(result.count, 1);
    assert.equal(result.usages[0].source, 'globalBlock');
    assert.equal(result.usages[0].id, 'header-block');
  });
});

// ─── FMU-03: seo.image plain string → source:seo ─────────────────────────────

test('FMU-03: seo.image plain string → count:1, source:seo', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/og.jpg';
    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'page-seo',
          title: { en: 'SEO Page' },
          slug: { en: '/seo-page' },
          status: { en: 'published' },
          seo: { image: { en: TARGET } },
          blocks: [],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const result = await findMediaUsages(TARGET);
    assert.equal(result.count, 1);
    assert.equal(result.usages[0].source, 'seo');
    assert.equal(result.usages[0].id, 'page-seo');
    assert.ok(result.usages[0].label.includes('SEO'), 'label should mention SEO');
  });
});

// ─── FMU-04: two page references → count:2 ────────────────────────────────────

test('FMU-04: two page refs (different pages) → count:2', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/foo.jpg';
    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'page-a',
          title: { en: 'Page A' },
          slug: { en: '/a' },
          status: { en: 'published' },
          blocks: [{ type: 'Hero', props: { img: { url: TARGET } } }],
        },
        {
          id: 'page-b',
          title: { en: 'Page B' },
          slug: { en: '/b' },
          status: { en: 'published' },
          blocks: [{ type: 'Card', props: { thumbnail: { url: TARGET } } }],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const result = await findMediaUsages(TARGET);
    assert.equal(result.count, 2);
    assert.equal(result.usages.length, 2);
    const ids = result.usages.map((u) => u.id);
    assert.ok(ids.includes('page-a'));
    assert.ok(ids.includes('page-b'));
  });
});

// ─── FMU-05: url not found → {count:0, usages:[]} ────────────────────────────

test('FMU-05: url not in any content → count:0, usages:[]', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/foo.jpg';
    const OTHER = '/uploads/2026/06/bar.jpg';
    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'page-1',
          title: { en: 'Home' },
          slug: { en: '/' },
          status: { en: 'published' },
          blocks: [{ type: 'Hero', props: { img: { url: OTHER } } }],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const result = await findMediaUsages(TARGET);
    assert.equal(result.count, 0);
    assert.deepEqual(result.usages, []);
  });
});

// ─── FMU-06: empty json files → count:0, no error ────────────────────────────

test('FMU-06: empty pages + global-blocks → count:0, no error', async () => {
  await withTempProject(async (tempRoot) => {
    await writeJson(tempRoot, 'pages.json', { pages: [] });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const result = await findMediaUsages('/uploads/2026/06/any.jpg');
    assert.equal(result.count, 0);
    assert.deepEqual(result.usages, []);
  });
});

// ─── UE-01: authenticated request for known media id → 200 + usage shape ─────

test('UE-01: valid auth + known media id → 200 with {count, usages}', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/hero.jpg';

    // Insert a media entry
    const entry = {
      id: generateId(),
      url: TARGET,
      filename: 'hero.jpg',
      size: 5000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
    };
    await appendMediaEntry(entry);

    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'page-1',
          title: { en: 'Home' },
          slug: { en: '/' },
          status: { en: 'published' },
          blocks: [{ type: 'Hero', props: { hero: { url: TARGET } } }],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const req = await makeAuthRequest(`http://localhost/cms/api/media/${entry.id}/usage`);
    const res = await handleGetMediaUsage(entry.id, req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.count === 'number', 'count should be a number');
    assert.ok(Array.isArray(body.usages), 'usages should be an array');
    assert.equal(body.count, 1);
    assert.equal(body.usages.length, 1);
  });
});

// ─── UE-02: unknown id → 404 ─────────────────────────────────────────────────

test('UE-02: valid auth + unknown media id → 404', async () => {
  await withTempProject(async () => {
    const req = await makeAuthRequest('http://localhost/cms/api/media/nonexistent-id/usage');
    const res = await handleGetMediaUsage('nonexistent-id', req);
    assert.equal(res.status, 404);
  });
});

// ─── UE-03: unauthenticated → 401 ────────────────────────────────────────────

test('UE-03: no auth → 401', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/media/some-id/usage');
    const res = await handleGetMediaUsage('some-id', req);
    assert.equal(res.status, 401);
  });
});

// ─── UE-04: count invariant: count === usages.length always ──────────────────

test('UE-04: count === usages.length invariant', async () => {
  await withTempProject(async (tempRoot) => {
    const TARGET = '/uploads/2026/06/test.jpg';

    const entry = {
      id: generateId(),
      url: TARGET,
      filename: 'test.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
    };
    await appendMediaEntry(entry);

    // Two pages referencing the same URL
    await writeJson(tempRoot, 'pages.json', {
      pages: [
        {
          id: 'p1',
          title: { en: 'P1' },
          slug: { en: '/p1' },
          status: { en: 'published' },
          blocks: [{ type: 'Hero', props: { img: { url: TARGET } } }],
        },
        {
          id: 'p2',
          title: { en: 'P2' },
          slug: { en: '/p2' },
          status: { en: 'published' },
          blocks: [{ type: 'Card', props: { bg: { url: TARGET } } }],
        },
      ],
    });
    await writeJson(tempRoot, 'global-blocks.json', { globalBlocks: {} });

    const req = await makeAuthRequest(`http://localhost/cms/api/media/${entry.id}/usage`);
    const res = await handleGetMediaUsage(entry.id, req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, body.usages.length, 'count MUST equal usages.length');
    assert.equal(body.count, 2);
  });
});
