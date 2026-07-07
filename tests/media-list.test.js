/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureDefaultFiles,
  loadMedia,
  saveMedia,
  appendMediaEntry,
  generateId,
} from '../dist/api/data.js';
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
        {
          id: 'entry-a',
          url: '/uploads/2026/06/a.jpg',
          filename: 'a.jpg',
          size: 12,
          mimeType: 'image/jpeg',
          createdAt: now,
        },
        {
          id: 'entry-b',
          url: '/uploads/2026/06/b.jpg',
          filename: 'b.jpg',
          size: 12,
          mimeType: 'image/jpeg',
          createdAt: now,
        },
        {
          id: 'entry-c',
          url: '/uploads/2026/06/c.jpg',
          filename: 'c.jpg',
          size: 12,
          mimeType: 'image/jpeg',
          createdAt: now,
        },
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

// ─── FIX C: loadMedia drops stored width/height === 0 (align to projection > 0) ─

test('FIX-C: loadMedia drops a stored width:0 / height:0 (must match projection > 0 rule)', async () => {
  await withTempProject(async () => {
    const now = new Date().toISOString();
    // Write malformed-but-tolerated entries directly to disk
    await saveMedia({
      uploads: [
        {
          id: 'zero-w',
          url: '/uploads/2026/06/zw.jpg',
          filename: 'zw.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          createdAt: now,
          width: 0,
          height: 600,
        },
        {
          id: 'zero-h',
          url: '/uploads/2026/06/zh.jpg',
          filename: 'zh.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          createdAt: now,
          width: 800,
          height: 0,
        },
        {
          id: 'zero-both',
          url: '/uploads/2026/06/zb.jpg',
          filename: 'zb.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          createdAt: now,
          width: 0,
          height: 0,
        },
        {
          id: 'pos',
          url: '/uploads/2026/06/p.jpg',
          filename: 'p.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          createdAt: now,
          width: 800,
          height: 600,
        },
      ],
    });

    const media = await loadMedia();
    const byId = Object.fromEntries(media.uploads.map((u) => [u.id, u]));

    // A stored 0 must be DROPPED (undefined), not passed through as 0.
    assert.equal(byId['zero-w'].width, undefined, 'width:0 must be dropped');
    assert.equal(byId['zero-w'].height, 600, 'valid height kept');
    assert.equal(byId['zero-h'].height, undefined, 'height:0 must be dropped');
    assert.equal(byId['zero-h'].width, 800, 'valid width kept');
    assert.equal(byId['zero-both'].width, undefined, 'width:0 dropped');
    assert.equal(byId['zero-both'].height, undefined, 'height:0 dropped');
    assert.equal(byId['pos'].width, 800, 'positive dims kept');
    assert.equal(byId['pos'].height, 600, 'positive dims kept');
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

// ─── Helper to create real upload files for reconcile tests ──────────────────

async function createRealEntry(
  tempRoot,
  subdir,
  filename,
  mimeType = 'image/jpeg',
  createdAt = new Date().toISOString(),
) {
  const dir = path.join(tempRoot, 'public', 'uploads', subdir.replace(/\//g, path.sep));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), 'fake-image-content');
  return {
    id: generateId(),
    url: `/uploads/${subdir}/${filename}`,
    filename,
    size: 18,
    mimeType,
    createdAt,
  };
}

// ─── Phase 1 TDD Tests: R1 – Default params, limit clamping, NaN ─────────────

// Task 1.1 [RED] — default params: 30 entries → page 1, limit 24, total 30, 24 uploads
test('ML-R1-default: default params — 30 entries returns page:1, limit:24, total:30, 24 uploads', async () => {
  await withTempProject(async (tempRoot) => {
    // Create 30 real file entries
    const entries = [];
    for (let i = 0; i < 30; i++) {
      const subdir = '2026/06';
      const filename = `file-${String(i).padStart(2, '0')}.jpg`;
      const entry = await createRealEntry(tempRoot, subdir, filename);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.page, 1, 'page should be 1');
    assert.equal(body.limit, 24, 'limit should be 24');
    assert.equal(body.total, 30, 'total should be 30');
    assert.equal(body.uploads.length, 24, 'uploads should have 24 entries');
  });
});

// Task 1.2 [RED] — limit=0 clamped to 1
test('ML-R1-limit-clamp-low: limit=0 clamped to 1', async () => {
  await withTempProject(async (tempRoot) => {
    const entries = [];
    for (let i = 0; i < 10; i++) {
      const entry = await createRealEntry(tempRoot, '2026/06', `file-${i}.jpg`);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?limit=0', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.limit, 1, 'limit should be clamped to 1');
    assert.ok(body.uploads.length <= 1, 'uploads should have at most 1 entry');
    assert.ok(!body.error, 'no error should be returned');
  });
});

// Task 1.3 [RED] — limit=500 clamped to 100
test('ML-R1-limit-clamp-high: limit=500 clamped to 100', async () => {
  await withTempProject(async (tempRoot) => {
    const entries = [];
    for (let i = 0; i < 10; i++) {
      const entry = await createRealEntry(tempRoot, '2026/06', `file-${i}.jpg`);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?limit=500', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.limit, 100, 'limit should be clamped to 100');
    assert.ok(body.uploads.length <= 100, 'uploads should have at most 100 entries');
  });
});

// Task 1.4 [RED] — NaN params → defaults
test('ML-R1-nan-defaults: NaN page and limit → defaults applied', async () => {
  await withTempProject(async (tempRoot) => {
    const entries = [];
    for (let i = 0; i < 5; i++) {
      const entry = await createRealEntry(tempRoot, '2026/06', `file-${i}.jpg`);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?page=abc&limit=xyz', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.page, 1, 'page should default to 1');
    assert.equal(body.limit, 24, 'limit should default to 24');
  });
});

// Task 1.5 [RED] — q filter case-insensitive substring match
test('ML-R4-filter-ci: q=banner matches both banner entries case-insensitively', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const heroBanner = await createRealEntry(tempRoot, subdir, 'hero-Banner.jpg');
    const bannerSmall = await createRealEntry(tempRoot, subdir, 'banner-small.png', 'image/png');
    const profile = await createRealEntry(tempRoot, subdir, 'profile.jpg');
    await saveMedia({ uploads: [heroBanner, bannerSmall, profile] });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?q=banner', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2, 'total should be 2 (both banner entries)');
    assert.equal(body.uploads.length, 2, 'uploads should have 2 entries');
    const filenames = body.uploads.map((u) => u.filename);
    assert.ok(filenames.includes('hero-Banner.jpg'), 'hero-Banner.jpg should be included');
    assert.ok(filenames.includes('banner-small.png'), 'banner-small.png should be included');
    assert.ok(!filenames.includes('profile.jpg'), 'profile.jpg should not be included');
  });
});

// Task 1.6 [RED] — q='' returns all 15 entries
test('ML-R4-empty-q: q= (empty string) returns all entries', async () => {
  await withTempProject(async (tempRoot) => {
    const entries = [];
    for (let i = 0; i < 15; i++) {
      const entry = await createRealEntry(tempRoot, '2026/06', `img-${i}.jpg`);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?q=', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 15, 'total should be 15 when q is empty');
  });
});

// Task 1.7 [RED] — q with zero matches
test('ML-R4-zero-matches: q=xyz returns empty uploads and total:0', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await createRealEntry(tempRoot, '2026/06', 'photo.jpg');
    await saveMedia({ uploads: [entry] });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?q=xyz', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.uploads, [], 'uploads should be empty');
    assert.equal(body.total, 0, 'total should be 0');
    assert.equal(body.page, 1, 'page should be 1');
  });
});

// Task 1.8 [RED] — out-of-range page returns empty uploads with correct total
test('ML-R5-out-of-range-page: page beyond last returns empty uploads + correct total (HTTP 200)', async () => {
  await withTempProject(async (tempRoot) => {
    const entries = [];
    for (let i = 0; i < 10; i++) {
      const entry = await createRealEntry(tempRoot, '2026/06', `file-${i}.jpg`);
      entries.push(entry);
    }
    await saveMedia({ uploads: entries });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?page=5&limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200, 'should return 200 even for out-of-range page');
    const body = await res.json();
    assert.deepEqual(body.uploads, [], 'uploads should be empty');
    assert.equal(body.total, 10, 'total should be 10');
    assert.equal(body.page, 5, 'page should be 5');
  });
});

// Task 1.9 [RED] — empty registry
test('ML-R6-empty-registry: empty registry returns correct envelope', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.uploads, [], 'uploads should be empty');
    assert.equal(body.total, 0, 'total should be 0');
    assert.equal(body.page, 1, 'page should be 1');
    assert.equal(body.limit, 24, 'limit should be 24');
  });
});

// Task 1.10 [RED] — back-compat: uploads key must always be present
test('ML-R3-backcompat: response always has uploads key as array', async () => {
  await withTempProject(async () => {
    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'uploads'), 'body must have uploads key');
    assert.ok(Array.isArray(body.uploads), 'uploads must be an array');
  });
});

// Task 1.11 [RED] — pipeline order: reconcile prunes orphans before filter+count
test('ML-R2-pipeline-order: orphan entries excluded before filter+count', async () => {
  await withTempProject(async (tempRoot) => {
    // Create 5 real entries with 'photo' in filename
    const subdir = '2026/06';
    const realEntries = [];
    for (let i = 0; i < 5; i++) {
      const entry = await createRealEntry(tempRoot, subdir, `photo-${i}.jpg`);
      realEntries.push(entry);
    }
    // Add 3 orphan entries with 'photo' in filename (no real files on disk)
    const orphanEntries = [
      {
        id: generateId(),
        url: '/uploads/2026/06/photo-orphan-a.jpg',
        filename: 'photo-orphan-a.jpg',
        size: 100,
        mimeType: 'image/jpeg',
        createdAt: new Date().toISOString(),
      },
      {
        id: generateId(),
        url: '/uploads/2026/06/photo-orphan-b.jpg',
        filename: 'photo-orphan-b.jpg',
        size: 100,
        mimeType: 'image/jpeg',
        createdAt: new Date().toISOString(),
      },
      {
        id: generateId(),
        url: '/uploads/2026/06/photo-orphan-c.jpg',
        filename: 'photo-orphan-c.jpg',
        size: 100,
        mimeType: 'image/jpeg',
        createdAt: new Date().toISOString(),
      },
    ];
    // Add a non-matching real entry
    const nonMatchEntry = await createRealEntry(tempRoot, subdir, 'landscape.jpg');

    await saveMedia({ uploads: [...realEntries, ...orphanEntries, nonMatchEntry] });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?q=photo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    // Total should be 5 (real photo entries), not 8 (including orphans)
    assert.equal(body.total, 5, 'total must exclude orphan entries');
    const filenames = body.uploads.map((u) => u.filename);
    // No orphan entries should appear
    for (const orphan of orphanEntries) {
      assert.ok(
        !filenames.includes(orphan.filename),
        `orphan ${orphan.filename} should not appear`,
      );
    }
  });
});

// ─── P4: reconcile → count → slice order (pruned entry excluded from BOTH) ────

test('P4-reconcile-count-slice: missing-file entry excluded from total AND from the page slice', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    // 3 real entries on disk + 1 orphan (no file). All created at distinct times
    // so newest-first sort is deterministic; the orphan is the NEWEST so it would
    // land first in the page slice if reconcile did not prune before slicing.
    const base = Date.parse('2026-06-01T00:00:00.000Z');
    const real = [];
    for (let i = 0; i < 3; i++) {
      const e = await createRealEntry(
        tempRoot,
        subdir,
        `real-${i}.jpg`,
        'image/jpeg',
        new Date(base + i * 1000).toISOString(),
      );
      real.push(e);
    }
    const orphan = {
      id: generateId(),
      url: `/uploads/${subdir}/orphan-newest.jpg`,
      filename: 'orphan-newest.jpg',
      size: 100,
      mimeType: 'image/jpeg',
      createdAt: new Date(base + 99 * 1000).toISOString(), // newest
    };
    await saveMedia({ uploads: [...real, orphan] });

    const token = await makeAuthToken();
    // limit=2 so the slice is a strict subset — proves reconcile ran before slice
    const req = new Request('http://localhost/cms/api/media?page=1&limit=2', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.total, 3, 'total must count only reconciled (on-disk) entries');
    assert.equal(body.uploads.length, 2, 'page slice respects limit=2');
    const ids = body.uploads.map((u) => u.id);
    assert.ok(!ids.includes(orphan.id), 'orphan must NOT appear in slice even though it is newest');

    // Registry on disk pruned too
    const after = await loadMedia();
    assert.ok(!after.uploads.map((u) => u.id).includes(orphan.id), 'orphan pruned from registry');
  });
});

test('P4-q-filters-reconciled-set: q filters AFTER reconcile (orphan match excluded from total)', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    // 2 real "logo" entries + 1 orphan "logo" entry (no file)
    const realA = await createRealEntry(tempRoot, subdir, 'logo-a.png', 'image/png');
    const realB = await createRealEntry(tempRoot, subdir, 'logo-b.png', 'image/png');
    const orphanLogo = {
      id: generateId(),
      url: `/uploads/${subdir}/logo-orphan.png`,
      filename: 'logo-orphan.png',
      size: 50,
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
    };
    // plus a non-matching real entry
    const other = await createRealEntry(tempRoot, subdir, 'banner.jpg');
    await saveMedia({ uploads: [realA, realB, orphanLogo, other] });

    const token = await makeAuthToken();
    const req = new Request('http://localhost/cms/api/media?q=logo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleGetMedia(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2, 'q must match only the reconciled "logo" entries, not the orphan');
    const filenames = body.uploads.map((u) => u.filename);
    assert.ok(filenames.includes('logo-a.png') && filenames.includes('logo-b.png'));
    assert.ok(
      !filenames.includes('logo-orphan.png'),
      'orphan logo excluded by reconcile-before-filter',
    );
    assert.ok(!filenames.includes('banner.jpg'), 'non-matching entry excluded by q');
  });
});
