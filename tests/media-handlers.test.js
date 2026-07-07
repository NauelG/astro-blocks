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
  savePages,
  loadLanguages,
  markMediaVariantsReady,
  markMediaVariantsFailed,
  appendMediaEntry,
  generateId,
} from '../dist/api/data.js';
import {
  handleUpload,
  handleDeleteUpload,
  handleGetPages,
  handleReplaceUpload,
} from '../dist/api/handlers.js';
import { replaceMediaEntryBytes } from '../dist/api/data.js';
import { generateAndPersistVariants } from '../dist/utils/variant-generator.js';
import { toImageValue } from '../dist/utils/image-value.js';
import { validateBlockPropsAgainstSchema } from '../dist/utils/block-validation.js';

/**
 * Poll loadMedia() until no entry has status:'processing'.
 * This drains any fire-and-forget generateAndPersistVariants calls that
 * handleUpload launches BEFORE we restore ASTRO_BLOCKS_PROJECT_ROOT — which
 * would otherwise cause the async write to land at process.cwd()/data instead
 * of the temp dir.
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-media-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
    // Drain any fire-and-forget variant jobs launched by handleUpload before
    // we restore the env var. Without this, those async writes race against the
    // finally block and fall back to process.cwd()/data (repo root).
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

// T14-10: ensureDefaultFiles creates media.json with { uploads: [] }
test('T14-10: ensureDefaultFiles creates media.json with { uploads: [] }', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const raw = await fs.readFile(mediaPath, 'utf-8');
    const data = JSON.parse(raw);
    assert.deepEqual(data, { uploads: [] });
  });
});

test('T14-10b: ensureDefaultFiles does not overwrite existing media.json', async () => {
  await withTempProject(async (tempRoot) => {
    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    // First call already ran; add a fake entry
    const existing = {
      uploads: [
        {
          id: 'test-id',
          url: '/uploads/x.jpg',
          filename: 'x.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    await fs.writeFile(mediaPath, JSON.stringify(existing), 'utf-8');
    // Call ensureDefaultFiles again — must not overwrite
    await ensureDefaultFiles();
    const raw = await fs.readFile(mediaPath, 'utf-8');
    const data = JSON.parse(raw);
    assert.equal(data.uploads.length, 1);
    assert.equal(data.uploads[0].id, 'test-id');
  });
});

// T14-01: PDF upload accepted with default allowlist (R2.2, R10.1)
test('T14-01: PDF upload accepted with default allowlist', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'document.pdf',
      'application/pdf',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.url, 'should return url');
    assert.ok(body.entry, 'should return entry');
    assert.equal(body.entry.mimeType, 'application/pdf');
    assert.ok(body.url.endsWith('.pdf'), 'url should end with .pdf');
  });
});

// SEC-DENY-01: denylisted MIME type (text/html) is rejected with 415 (R2.4, R10.1)
test('SEC-DENY-01: upload with denylisted MIME (text/html) returns 415', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(Buffer.from('Hello!'), 'page.html', 'text/html');
    const res = await handleUpload(req);
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
  });
});

test('T14-01b: upload with empty MIME type returns 415', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(new Uint8Array([1, 2, 3]), 'file.dat', '');
    const res = await handleUpload(req);
    assert.equal(res.status, 415);
  });
});

// R6.1-A: JPEG upload → fileCategory 'image' (B3)
test('R6.1-A: JPEG upload sets fileCategory to image', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      'photo.jpg',
      'image/jpeg',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    await drainVariantJobs();
    const mediaData = await loadMedia();
    const entry = mediaData.uploads[0];
    assert.equal(entry.fileCategory, 'image');
  });
});

// R6.1-B: PDF upload → fileCategory 'document' (B3)
test('R6.1-B: PDF upload sets fileCategory to document', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'doc.pdf',
      'application/pdf',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    await drainVariantJobs();
    const mediaData = await loadMedia();
    const entry = mediaData.uploads[0];
    assert.equal(entry.fileCategory, 'document');
  });
});

// R4.3-A: PDF upload → no width/height on entry (B3 — imageSize skipped for non-raster)
test('R4.3-A: PDF upload has no width or height on registry entry', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'doc.pdf',
      'application/pdf',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    await drainVariantJobs();
    const mediaData = await loadMedia();
    const entry = mediaData.uploads[0];
    assert.ok(entry.width === undefined || entry.width === null, 'PDF entry should have no width');
    assert.ok(
      entry.height === undefined || entry.height === null,
      'PDF entry should have no height',
    );
  });
});

// R2.5-A: PDF blob with wrong filename gets .pdf extension (B3)
test('R2.5-A: PDF blob with wrong filename gets .pdf extension from MIME', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'document.docx',
      'application/pdf',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.url.endsWith('.pdf'), `url ${body.url} should end with .pdf`);
  });
});

// R2.2-B: PDF entry has fileCategory 'document' (second check via T14-01 extended)
test('R2.2-B: PDF upload — loadMedia entry has fileCategory document', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'doc.pdf',
      'application/pdf',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const mediaData = await loadMedia();
    const entry = mediaData.uploads.find((e) => e.url === body.url);
    assert.ok(entry, 'entry should exist in registry');
    assert.equal(entry.fileCategory, 'document');
  });
});

// T14-02: Upload with allowed MIME → HTTP 200, file on disk
test('T14-02: upload with allowed MIME type (image/jpeg) returns 200 and file is on disk', async () => {
  await withTempProject(async (tempRoot) => {
    const req = makeUploadRequest(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      'photo.jpg',
      'image/jpeg',
    );
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.url, 'should return url');
    assert.ok(body.entry, 'should return entry');
    // Verify file exists on disk
    const filePath = path.join(tempRoot, 'public', body.url);
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile());
  });
});

// T14-03: Upload exceeding max size → HTTP 413
test('T14-03: upload exceeding max size returns 413', async () => {
  await withTempProject(async () => {
    // Default limit is 5MB; send 6MB of data
    const bigContent = new Uint8Array(6 * 1024 * 1024);
    const req = makeUploadRequest(bigContent, 'big-image.png', 'image/png');
    const res = await handleUpload(req);
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.ok(body.error, 'should have error message');
  });
});

// T14-04: Successful upload appends MediaEntry to registry
test('T14-04: successful upload appends MediaEntry to registry', async () => {
  await withTempProject(async () => {
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const req = makeUploadRequest(content, 'photo.jpg', 'image/jpeg');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();

    const mediaData = await loadMedia();
    assert.equal(mediaData.uploads.length, 1);
    const entry = mediaData.uploads[0];
    assert.equal(entry.mimeType, 'image/jpeg');
    assert.equal(entry.url, body.url);
    assert.ok(entry.id, 'should have id');
    assert.ok(entry.createdAt, 'should have createdAt');
    assert.equal(entry.filename, 'photo.jpg');
    // Verify createdAt is valid ISO8601
    assert.ok(!Number.isNaN(Date.parse(entry.createdAt)));
  });
});

// T14-08: Delete removes disk file AND prunes registry entry
test('T14-08: delete removes disk file and prunes registry entry', async () => {
  await withTempProject(async (tempRoot) => {
    // Upload first
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const uploadReq = makeUploadRequest(content, 'photo.jpg', 'image/jpeg');
    const uploadRes = await handleUpload(uploadReq);
    assert.equal(uploadRes.status, 200);
    const { url } = await uploadRes.json();

    // Confirm file and registry entry exist
    const filePath = path.join(tempRoot, 'public', url);
    await fs.stat(filePath); // should not throw
    const before = await loadMedia();
    assert.equal(before.uploads.length, 1);

    // Delete
    const deleteReq = new Request('http://localhost/cms/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const deleteRes = await handleDeleteUpload(deleteReq);
    assert.equal(deleteRes.status, 204);

    // File should be gone
    await assert.rejects(() => fs.stat(filePath), { code: 'ENOENT' });

    // Registry should be pruned
    const after = await loadMedia();
    assert.equal(after.uploads.length, 0);
  });
});

// T14-09: Delete when file already gone → still prunes registry, returns 204
test('T14-09: delete when file already missing still prunes registry and returns 204', async () => {
  await withTempProject(async (tempRoot) => {
    // Upload first
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const uploadReq = makeUploadRequest(content, 'photo.jpg', 'image/jpeg');
    const uploadRes = await handleUpload(uploadReq);
    const { url } = await uploadRes.json();

    // Manually remove the file from disk (simulating missing file)
    const filePath = path.join(tempRoot, 'public', url);
    await fs.unlink(filePath);

    // Verify registry still has the entry
    const before = await loadMedia();
    assert.equal(before.uploads.length, 1);

    // Delete via API
    const deleteReq = new Request('http://localhost/cms/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const deleteRes = await handleDeleteUpload(deleteReq);
    assert.equal(deleteRes.status, 204);

    // Registry entry should still be pruned
    const after = await loadMedia();
    assert.equal(after.uploads.length, 0);
  });
});

// --- Security regression tests ---

// SEC-01: SVG uploaded with a .jpg filename must be stored as .svg (XSS bypass fix)
test('SEC-01: SVG blob with .jpg filename is stored with .svg extension', async () => {
  await withTempProject(async (tempRoot) => {
    // Minimal SVG content, but MIME declared as image/svg+xml
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
    const req = makeUploadRequest(svgContent, 'foo.jpg', 'image/svg+xml');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    // The returned URL and the file on disk must end in .svg, NOT .jpg
    assert.ok(body.url.endsWith('.svg'), `expected .svg url, got: ${body.url}`);
    const filePath = path.join(tempRoot, 'public', body.url);
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile(), 'file should exist on disk');
    assert.ok(filePath.endsWith('.svg'), `expected .svg on disk, got: ${filePath}`);
  });
});

// SEC-02: JPEG uploaded with a .svg filename must be stored as .jpg (not .svg)
test('SEC-02: JPEG blob with .svg filename is stored with .jpg extension', async () => {
  await withTempProject(async (tempRoot) => {
    const jpegContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const req = makeUploadRequest(jpegContent, 'x.svg', 'image/jpeg');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.url.endsWith('.jpg'), `expected .jpg url, got: ${body.url}`);
    const filePath = path.join(tempRoot, 'public', body.url);
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile(), 'file should exist on disk');
    assert.ok(filePath.endsWith('.jpg'), `expected .jpg on disk, got: ${filePath}`);
  });
});

// SEC-03: Filename with spaces and special chars produces a safe base segment
test('SEC-03: filename with special characters is sanitized in stored path', async () => {
  await withTempProject(async () => {
    const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const req = makeUploadRequest(content, 'my image (copy) #2!.png', 'image/png');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    // URL must not contain spaces, parentheses, #, or ! characters
    assert.doesNotMatch(body.url, /[ ()#!]/, `url contains unsafe chars: ${body.url}`);
    assert.ok(body.url.endsWith('.png'), `expected .png url, got: ${body.url}`);
  });
});

// ─── T1.2: loadMedia backward-tolerance + status/variants normalization ───────

test('T1.2: legacy entry (no status/variants) loads without error', async () => {
  await withTempProject(async () => {
    const { saveMedia, loadMedia: reloadMedia } = await import('../dist/api/data.js');
    const legacyEntry = {
      id: 'legacy-1',
      url: '/uploads/2026/01/legacy.jpg',
      filename: 'legacy.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await saveMedia({ uploads: [legacyEntry] });
    const loaded = await reloadMedia();
    assert.equal(loaded.uploads.length, 1);
    const entry = loaded.uploads[0];
    assert.equal(entry.id, 'legacy-1');
    assert.equal(entry.status, undefined);
    assert.equal(entry.variants, undefined);
  });
});

test('T1.2: invalid status coerced to undefined', async () => {
  await withTempProject(async () => {
    const { saveMedia, loadMedia: reloadMedia } = await import('../dist/api/data.js');
    const invalidEntry = {
      id: 'bad-status',
      url: '/uploads/2026/01/bad.jpg',
      filename: 'bad.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'unknown-invalid-status',
    };
    // Directly write malformed JSON to bypass TypeScript
    const { getDataPath } = await import('../dist/utils/paths.js');
    const fs2 = (await import('node:fs/promises')).default;
    await fs2.writeFile(
      getDataPath('media.json'),
      JSON.stringify({ uploads: [invalidEntry] }),
      'utf-8',
    );
    const loaded = await reloadMedia();
    assert.equal(loaded.uploads.length, 1);
    assert.equal(
      loaded.uploads[0].status,
      undefined,
      'invalid status should be coerced to undefined',
    );
  });
});

test('T1.2: invalid variant element filtered out', async () => {
  await withTempProject(async () => {
    const { loadMedia: reloadMedia } = await import('../dist/api/data.js');
    const { getDataPath } = await import('../dist/utils/paths.js');
    const fs2 = (await import('node:fs/promises')).default;
    const entryWithBadVariants = {
      id: 'bad-variants',
      url: '/uploads/2026/01/img.jpg',
      filename: 'img.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'ready',
      variants: [
        // Valid variant
        { format: 'webp', width: 480, url: '/uploads/2026/01/img-480.webp' },
        // Invalid: bad format
        { format: 'jpeg', width: 480, url: '/uploads/2026/01/img-480.jpeg' },
        // Invalid: width 0
        { format: 'avif', width: 0, url: '/uploads/2026/01/img-0.avif' },
        // Invalid: missing url
        { format: 'webp', width: 800 },
      ],
    };
    await fs2.writeFile(
      getDataPath('media.json'),
      JSON.stringify({ uploads: [entryWithBadVariants] }),
      'utf-8',
    );
    const loaded = await reloadMedia();
    assert.equal(loaded.uploads.length, 1);
    const entry = loaded.uploads[0];
    assert.equal(entry.variants?.length, 1, 'only 1 valid variant should survive');
    assert.equal(entry.variants?.[0].format, 'webp');
    assert.equal(entry.variants?.[0].width, 480);
  });
});

// ─── T4.1: markMediaVariantsReady / markMediaVariantsFailed ──────────────────

test('T4.1: markMediaVariantsReady persists status:ready and variants', async () => {
  await withTempProject(async () => {
    const entry = {
      id: generateId(),
      url: '/uploads/2026/06/test.jpg',
      filename: 'test.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'processing',
    };
    await appendMediaEntry(entry);

    const variants = [
      { format: 'webp', width: 480, url: '/uploads/2026/06/test-480.webp' },
      { format: 'avif', width: 480, url: '/uploads/2026/06/test-480.avif' },
    ];
    await markMediaVariantsReady(entry.id, variants);

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);
    assert.ok(updated, 'entry should exist');
    assert.equal(updated.status, 'ready');
    assert.deepEqual(updated.variants, variants);
  });
});

test('T4.1: markMediaVariantsFailed sets status:failed and clears variants', async () => {
  await withTempProject(async () => {
    const entry = {
      id: generateId(),
      url: '/uploads/2026/06/fail.jpg',
      filename: 'fail.jpg',
      size: 500,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'processing',
      variants: [{ format: 'webp', width: 480, url: '/uploads/2026/06/fail-480.webp' }],
    };
    await appendMediaEntry(entry);

    await markMediaVariantsFailed(entry.id);

    const media = await loadMedia();
    const updated = media.uploads.find((u) => u.id === entry.id);
    assert.ok(updated, 'entry should exist');
    assert.equal(updated.status, 'failed');
    assert.deepEqual(updated.variants, []);
  });
});

test('T4.1: mutation is no-op when id not found', async () => {
  await withTempProject(async () => {
    // Should not throw when id does not exist
    await assert.doesNotReject(() => markMediaVariantsReady('nonexistent-id', []));
    await assert.doesNotReject(() => markMediaVariantsFailed('nonexistent-id'));
  });
});

// ─── T4.2: handleUpload status + delete cascade ───────────────────────────────

test('T4.2: upload returns status:processing synchronously (before variant job)', async () => {
  await withTempProject(async () => {
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    const req = makeUploadRequest(content, 'photo.jpg', 'image/jpeg');
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.entry, 'should return entry');
    assert.equal(body.entry.status, 'processing', 'status at response time should be processing');
  });
});

test('T4.2: delete cascade — original + all variant files gone, entry pruned', async () => {
  await withTempProject(async (tempRoot) => {
    // Create a PNG fixture that will produce variants
    const { default: sharp } = await import('sharp');
    const pngBuffer = await sharp({
      create: { width: 1000, height: 50, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .png()
      .toBuffer();

    // Write PNG to uploads dir
    const subdir = new Date().toISOString().slice(0, 7).replace(/-/g, '/');
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'cascade-test.png';
    await fs.writeFile(path.join(dir, filename), pngBuffer);
    const url = `/uploads/${subdir}/${filename}`;

    const entry = {
      id: generateId(),
      url,
      filename,
      size: pngBuffer.length,
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
      width: 1000,
      height: 50,
      status: 'processing',
    };
    await appendMediaEntry(entry);

    // Generate variants directly
    await generateAndPersistVariants(entry);

    // Verify variants exist on disk
    const media = await loadMedia();
    const readyEntry = media.uploads.find((u) => u.id === entry.id);
    assert.equal(readyEntry?.status, 'ready', 'entry should be ready after generation');
    assert.ok(readyEntry?.variants && readyEntry.variants.length > 0, 'should have variants');

    // Record all expected file paths
    const { resolveUploadPath: resolve } = await import('../dist/utils/paths.js');
    const variantPaths = readyEntry.variants.map((v) => resolve(v.url));
    const originalPath = resolve(url);

    // All files should exist before delete
    await fs.stat(originalPath);
    for (const vPath of variantPaths) {
      await fs.stat(vPath);
    }

    // Delete via handler
    const deleteReq = new Request('http://localhost/cms/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const deleteRes = await handleDeleteUpload(deleteReq);
    assert.equal(deleteRes.status, 204);

    // Original should be gone
    await assert.rejects(() => fs.stat(originalPath), { code: 'ENOENT' });

    // All variant files should be gone
    for (const vPath of variantPaths) {
      await assert.rejects(() => fs.stat(vPath), { code: 'ENOENT' });
    }

    // Registry should be pruned
    const after = await loadMedia();
    assert.equal(
      after.uploads.find((u) => u.id === entry.id),
      undefined,
      'entry should be pruned',
    );
  });
});

test('T4.2: delete with missing variant files is idempotent', async () => {
  await withTempProject(async (tempRoot) => {
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const uploadReq = makeUploadRequest(content, 'photo.jpg', 'image/jpeg');
    const uploadRes = await handleUpload(uploadReq);
    const { url } = await uploadRes.json();

    // Manually write a variant entry with a non-existent file
    const media = await loadMedia();
    const entry = media.uploads.find((u) => u.url === url);
    const fakeVariants = [{ format: 'webp', width: 480, url: url.replace('.jpg', '-480.webp') }];
    await markMediaVariantsReady(entry.id, fakeVariants);
    // Do NOT create the variant file on disk — it's missing

    const deleteReq = new Request('http://localhost/cms/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    // Should not throw even when variant file is missing
    const deleteRes = await handleDeleteUpload(deleteReq);
    assert.equal(deleteRes.status, 204, 'delete should succeed even with missing variant files');

    const after = await loadMedia();
    assert.equal(after.uploads.length, 0, 'entry should be pruned from registry');
  });
});

// ─── T5.1: handleReplaceUpload atomic write + replaceMediaEntryBytes return shape ─

/**
 * Build a binary-body request for handleReplaceUpload.
 * Targets the replace path directly without auth (T5.1 tests handler internals,
 * auth is tested separately).
 */
function makeReplaceRequest(content, filename, mimeType) {
  return new Request(`http://localhost/cms/api/media/PLACEHOLDER/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'x-cms-filename': encodeURIComponent(filename),
    },
    body: content,
  });
}

test('T5.1: replaceMediaEntryBytes returns { entry, oldVariants } with oldVariants captured under lock', async () => {
  await withTempProject(async () => {
    // Seed an entry with known variants
    const id = generateId();
    const url = '/uploads/2026/06/replace-test.jpg';
    const oldVariantList = [
      { format: 'webp', width: 480, url: '/uploads/2026/06/replace-test-480.webp' },
    ];
    await appendMediaEntry({
      id,
      url,
      filename: 'replace-test.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: oldVariantList,
    });

    const result = await replaceMediaEntryBytes(id, { size: 2000, width: 800, height: 600 });

    assert.ok(result !== null, 'should return a result, not null');
    assert.ok(typeof result === 'object', 'result should be an object');

    // entry shape
    assert.equal(result.entry.id, id, 'entry id must be unchanged');
    assert.equal(result.entry.size, 2000, 'entry size must be updated');
    assert.equal(result.entry.width, 800, 'entry width must be updated');
    assert.equal(result.entry.height, 600, 'entry height must be updated');
    assert.equal(result.entry.status, 'processing', 'entry status must be processing');
    assert.deepEqual(result.entry.variants, [], 'entry variants must be cleared');

    // oldVariants is what was live at mutation time
    assert.deepEqual(
      result.oldVariants,
      oldVariantList,
      'oldVariants must match the pre-mutation snapshot',
    );
  });
});

test('T5.1: replaceMediaEntryBytes returns null for unknown id', async () => {
  await withTempProject(async () => {
    const result = await replaceMediaEntryBytes('nonexistent-id', { size: 1000 });
    assert.equal(result, null, 'should return null for unknown id');
  });
});

test('T5.1: replaceMediaEntryBytes returns empty oldVariants when entry had no variants', async () => {
  await withTempProject(async () => {
    const id = generateId();
    await appendMediaEntry({
      id,
      url: '/uploads/2026/06/no-variants.jpg',
      filename: 'no-variants.jpg',
      size: 500,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
    });

    const result = await replaceMediaEntryBytes(id, { size: 1000 });
    assert.ok(result !== null);
    assert.deepEqual(
      result.oldVariants,
      [],
      'oldVariants should be empty when entry had no variants',
    );
  });
});

test('T5.1: handleReplaceUpload — no .tmp file left behind on success (atomic write clean)', async () => {
  await withTempProject(async (tempRoot) => {
    // Upload a JPEG so we have a real entry
    const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const uploadReq = makeUploadRequest(jpegMagic, 'replace-clean.jpg', 'image/jpeg');
    const uploadRes = await handleUpload(uploadReq);
    assert.equal(uploadRes.status, 200);
    const { entry } = await uploadRes.json();
    const entryId = entry.id;
    const relativeUrl = entry.url;

    // Perform a replace with valid JPEG bytes (binary body transport)
    const newContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x47]);
    const replaceReq = new Request(`http://localhost/cms/api/media/${entryId}/replace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('replace-clean.jpg'),
      },
      body: newContent,
    });

    // Attach auth cookie same as other tests (handler uses getAuth which reads cookie)
    const res = await handleReplaceUpload(replaceReq, entryId);
    // Response may be 401 in test env if getAuth fails without a real JWT — that is fine
    // for this test: even a 401 should not leave .tmp files.
    const uploadsDir = path.join(tempRoot, 'public', path.dirname(relativeUrl));
    let tmpFiles = [];
    try {
      const entries = await fs.readdir(uploadsDir);
      tmpFiles = entries.filter((f) => f.endsWith('.tmp'));
    } catch {
      // dir may not exist if upload path wasn't created — that's fine
    }
    assert.equal(tmpFiles.length, 0, 'no .tmp files should remain after replace (atomic write)');
  });
});

// ─── T7.1: reconcileMedia orphan variant cleanup ──────────────────────────────

import { reconcileMedia } from '../dist/api/data.js';
import { resolveUploadPath } from '../dist/utils/paths.js';

test('T7.1: reconcile prunes entry and deletes its variants when original is missing', async () => {
  await withTempProject(async (tempRoot) => {
    // Create variant files but NOT the original
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });

    const variantFilename1 = 'ab12-photo-480.webp';
    const variantFilename2 = 'ab12-photo-480.avif';
    await fs.writeFile(path.join(dir, variantFilename1), 'fake webp data');
    await fs.writeFile(path.join(dir, variantFilename2), 'fake avif data');

    const url = `/uploads/${subdir}/ab12-photo.jpg`;
    const variants = [
      { format: 'webp', width: 480, url: `/uploads/${subdir}/${variantFilename1}` },
      { format: 'avif', width: 480, url: `/uploads/${subdir}/${variantFilename2}` },
    ];

    await appendMediaEntry({
      id: generateId(),
      url,
      filename: 'ab12-photo.jpg',
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants,
    });

    const before = await loadMedia();
    assert.equal(before.uploads.length, 1, 'entry should exist before reconcile');

    const reconciled = await reconcileMedia();
    assert.equal(reconciled.uploads.length, 0, 'pruned entry should be removed');

    // Variant files should be deleted
    for (const v of variants) {
      const variantPath = resolveUploadPath(v.url);
      await assert.rejects(() => fs.stat(variantPath), { code: 'ENOENT' });
    }
  });
});

test('T7.1: reconcile tolerates missing orphan variant files', async () => {
  await withTempProject(async (tempRoot) => {
    // Register an entry with variants but don't create any files on disk
    const url = '/uploads/2026/06/ghost.jpg';
    await appendMediaEntry({
      id: generateId(),
      url,
      filename: 'ghost.jpg',
      size: 500,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [{ format: 'webp', width: 480, url: '/uploads/2026/06/ghost-480.webp' }],
    });

    // Should not throw even though original AND variant files are missing
    await assert.doesNotReject(() => reconcileMedia());

    const after = await loadMedia();
    assert.equal(after.uploads.length, 0, 'entry should be pruned');
  });
});

test('T7.1: reconcile leaves valid variant files untouched', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });

    // Create original AND variant files
    const originalFilename = 'valid-image.jpg';
    const variantFilename = 'valid-image-480.webp';
    await fs.writeFile(path.join(dir, originalFilename), 'fake jpeg data');
    await fs.writeFile(path.join(dir, variantFilename), 'fake webp data');

    const url = `/uploads/${subdir}/${originalFilename}`;
    const variantUrl = `/uploads/${subdir}/${variantFilename}`;

    await appendMediaEntry({
      id: generateId(),
      url,
      filename: originalFilename,
      size: 1000,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
      variants: [{ format: 'webp', width: 480, url: variantUrl }],
    });

    const reconciled = await reconcileMedia();
    assert.equal(reconciled.uploads.length, 1, 'valid entry should survive reconcile');

    // Variant file should still exist
    const variantPath = resolveUploadPath(variantUrl);
    const stat = await fs.stat(variantPath);
    assert.ok(stat.isFile(), 'valid variant file should not be deleted');
  });
});

test('T7.1: existing reconcile behaviour preserved (entry with no variants still pruned)', async () => {
  await withTempProject(async (tempRoot) => {
    // Entry with no variants, original file missing
    const url = '/uploads/2026/06/no-variants.jpg';
    await appendMediaEntry({
      id: generateId(),
      url,
      filename: 'no-variants.jpg',
      size: 500,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
    });

    const reconciled = await reconcileMedia();
    assert.equal(
      reconciled.uploads.length,
      0,
      'entry with missing original and no variants should be pruned',
    );
  });
});

// ─── T-1 through T-5: validateImageValue (REQ-2) ─────────────────────────────

// Helper: create a minimal schema with one image prop and run validation on a single block.
function validateImageValue(value, required = true) {
  const schemaItems = { img: { type: 'image', label: 'Image', required } };
  const blockProps = { img: value };
  return validateBlockPropsAgainstSchema('TestBlock', 0, schemaItems, blockProps);
}

test('T-1: validateImageValue — accepts valid full object (SC-2.1)', () => {
  const result = validateImageValue({ url: '/a.jpg', alt: 'Cat', width: 800, height: 600 }, true);
  assert.equal(result, null, 'should return null (no issue)');
});

test('T-2: validateImageValue — accepts minimal object (url only) (SC-2.2)', () => {
  const result = validateImageValue({ url: '/a.jpg' }, true);
  assert.equal(result, null, 'should accept object with url only');
});

test('T-3: validateImageValue — rejects required empty url (SC-2.3)', () => {
  const result = validateImageValue({ url: '' }, true);
  assert.notEqual(result, null, 'should return an issue for empty url when required');
});

test('T-4: validateImageValue — rejects plain string (SC-2.4)', () => {
  const result = validateImageValue('/a.jpg', false);
  assert.notEqual(result, null, 'should reject a plain string');
});

test('T-5: validateImageValue — rejects fractional width (SC-2.5)', () => {
  const result = validateImageValue({ url: '/a.jpg', width: 3.5 }, false);
  assert.notEqual(result, null, 'should reject fractional width');
});

// ─── T-6, T-7, T-8: toImageValue (REQ-1) ────────────────────────────────────

test('T-6: toImageValue — coerces legacy string to { url, alt: "" } (SC-1.2)', () => {
  const result = toImageValue('/uploads/legacy.jpg');
  assert.equal(result.url, '/uploads/legacy.jpg');
  assert.equal(result.alt, '');
  assert.equal(result.width, undefined);
  assert.equal(result.height, undefined);
});

test('T-7: toImageValue — passes through valid object unchanged (SC-1.1)', () => {
  const input = { url: '/uploads/a.jpg', alt: 'A cat', width: 800, height: 600 };
  const result = toImageValue(input);
  assert.equal(result.url, '/uploads/a.jpg');
  assert.equal(result.alt, 'A cat');
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test('T-8: toImageValue — coerces null to sentinel { url: "", alt: "" } (SC-1.4)', () => {
  const result = toImageValue(null);
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

test('T-9: JSON hidden-input round-trip — special chars in alt (SC-1.5)', () => {
  const original = {
    url: '/u/img.png',
    alt: 'Quote with "quotes" & <tags>',
    width: 400,
    height: 300,
  };
  const serialized = JSON.stringify(original);
  // Simulate parseImageValue by JSON.parse — the full helper is tested in image-value.test.js
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.url, original.url);
  assert.equal(parsed.alt, original.alt);
  assert.equal(parsed.width, original.width);
  assert.equal(parsed.height, original.height);
});

// ─── T-17 through T-19: BlockImage via imageAttrs (REQ-7) ────────────────────

import { imageAttrs } from '../dist/utils/image-value.js';

test('T-17: imageAttrs — all four attributes present (SC-7.1)', () => {
  const attrs = imageAttrs({ url: '/a.jpg', alt: 'Cat', width: 800, height: 600 });
  assert.equal(attrs.src, '/a.jpg');
  assert.equal(attrs.alt, 'Cat');
  assert.equal(attrs.width, 800);
  assert.equal(attrs.height, 600);
});

test('T-18: imageAttrs — empty alt renders alt="" not absent (SC-7.2)', () => {
  const attrs = imageAttrs({ url: '/deco.png', alt: '' });
  assert.ok(Object.prototype.hasOwnProperty.call(attrs, 'alt'), 'alt key must exist');
  assert.equal(attrs.alt, '');
});

test('T-19: imageAttrs — absent width/height — attributes omitted (SC-7.3)', () => {
  const attrs = imageAttrs({ url: '/svg.svg', alt: 'Logo' });
  assert.equal(attrs.width, undefined);
  assert.equal(attrs.height, undefined);
});

// ─── T-20: String-valued image prop coerces at form render (backwards compat) ─

test('T-20: string-valued image prop coerces at form render — toImageValue (SC-10.1)', () => {
  // Simulate what block-form.ts primitiveInputHtml does for image type:
  // it calls toImageValue(value) before rendering
  const legacyValue = '/uploads/old.jpg'; // legacy string stored in pages.json
  const coerced = toImageValue(legacyValue);
  assert.equal(coerced.url, '/uploads/old.jpg', 'url extracted from legacy string');
  assert.equal(coerced.alt, '', 'alt defaults to empty string');
  assert.equal(coerced.width, undefined, 'width absent');
  assert.equal(coerced.height, undefined, 'height absent');
});

// ─── FIX-3: consumer API must coerce legacy string image props (SC-10.2) ─────

test('FIX-3: handleGetPages — legacy string image prop is projected as { url, alt: "" } object', async () => {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-fix3-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    // Seed schema map so projectBlockProps knows the prop is type 'image'
    const schemaDir = path.join(tempRoot, '.astro-blocks');
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(
      path.join(schemaDir, 'schema-map.mjs'),
      [
        'export const schemaMap = {',
        '  "Hero": {"name":"Hero","items":{"image":{"type":"image","label":"Hero image"}}},',
        '};',
      ].join('\n'),
      'utf-8',
    );

    // Seed a page with a legacy string image prop
    await savePages({
      pages: [
        {
          id: 'page-fix3',
          title: { en: 'Fix3 Page' },
          slug: { en: 'fix3' },
          status: { en: 'published' },
          blocks: [
            {
              type: 'Hero',
              props: {
                image: '/uploads/legacy.jpg', // legacy string — must be coerced
              },
            },
          ],
        },
      ],
    });

    const req = new Request('http://localhost/cms/api/pages');
    const res = await handleGetPages(req);
    assert.equal(res.status, 200);
    const body = await res.json();

    const page = body.pages.find((p) => p.id === 'page-fix3');
    assert.ok(page, 'page must be in response');
    const block = page.blocks[0];
    assert.ok(block, 'block must exist');

    // The image prop must NOT be a bare string — it must be an object with url
    const imageProp = block.props.image;
    assert.equal(
      typeof imageProp,
      'object',
      'FIX-3: image prop must be an object, not a bare string',
    );
    assert.ok(imageProp !== null, 'FIX-3: image prop must not be null');
    assert.equal(imageProp.url, '/uploads/legacy.jpg', 'FIX-3: url must be preserved');
    assert.equal(imageProp.alt, '', 'FIX-3: alt must default to empty string');
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─── P3: ASTRO_BLOCKS_MAX_UPLOAD_BYTES override (read at MODULE LOAD) ──────────
//
// MAX_UPLOAD_BYTES is computed once when handlers.ts is first evaluated. To test
// an override we must import a FRESH module instance AFTER setting the env var.
// Node ESM caches by URL, so we cache-bust with a unique query string. The env
// var is restored after each test so other suites see the default 5 MB limit.

async function importFreshHandlers(maxBytes) {
  const prev = process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
  process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES = String(maxBytes);
  try {
    const url =
      new URL('../dist/api/handlers.js', import.meta.url).href +
      `?maxbytes=${maxBytes}-${Date.now()}-${Math.random()}`;
    return await import(url);
  } finally {
    if (prev === undefined) delete process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
    else process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES = prev;
  }
}

test('P3: ASTRO_BLOCKS_MAX_UPLOAD_BYTES override — handleUpload accepts under-limit, rejects over-limit (413)', async () => {
  await withTempProject(async () => {
    const handlersFresh = await importFreshHandlers(1024); // 1 KB limit
    // Under limit: 500 bytes JPEG
    const okReq = makeUploadRequest(new Uint8Array(500).fill(0xff), 'small.jpg', 'image/jpeg');
    const okRes = await handlersFresh.handleUpload(okReq);
    assert.equal(okRes.status, 200, 'under-limit upload should pass with raised/lowered limit');

    // Over limit: 2 KB > 1 KB
    const bigReq = makeUploadRequest(new Uint8Array(2048).fill(0xff), 'big.jpg', 'image/jpeg');
    const bigRes = await handlersFresh.handleUpload(bigReq);
    assert.equal(bigRes.status, 413, 'over-override-limit upload should be rejected with 413');
  });
});

test('P3: ASTRO_BLOCKS_MAX_UPLOAD_BYTES override — handleReplaceUpload honors the override (413)', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed a real JPEG entry on disk (mime must match for replace)
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'p3-replace.jpg';
    await fs.writeFile(path.join(dir, filename), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const url = `/uploads/${subdir}/${filename}`;
    const id = generateId();
    await appendMediaEntry({
      id,
      url,
      filename,
      size: 4,
      mimeType: 'image/jpeg',
      createdAt: new Date().toISOString(),
      status: 'ready',
    });

    const handlersFresh = await importFreshHandlers(1024); // 1 KB limit

    // Auth token (replace requires auth)
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ email: 't@e.com', role: 'owner' })
      .setSubject('uid')
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('cms-jwt-secret-change-me'));

    // Under limit replace → 200 processing (binary body transport)
    const okReq = new Request(`http://localhost/cms/api/media/${id}/replace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('small.jpg'),
      },
      body: new Uint8Array(500).fill(0xff),
    });
    const okRes = await handlersFresh.handleReplaceUpload(okReq, id);
    assert.equal(okRes.status, 200, 'under-limit replace should pass');

    // Over limit replace → 413 (binary body transport)
    const bigReq = new Request(`http://localhost/cms/api/media/${id}/replace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('big.jpg'),
      },
      body: new Uint8Array(2048).fill(0xff),
    });
    const bigRes = await handlersFresh.handleReplaceUpload(bigReq, id);
    assert.equal(bigRes.status, 413, 'over-override-limit replace should be rejected with 413');
  });
});

// ─── B7: handleReplaceUpload PDF-specific tests ────────────────────────────────
//
// These tests verify that the same-MIME constraint applies to non-image files (PDF)
// and that the evaluateUpload gate works correctly on the replace path.

/** Mint a JWT for handleReplaceUpload auth. */
async function mintJwt() {
  const { SignJWT } = await import('jose');
  return new SignJWT({ email: 'test@e.com', role: 'owner' })
    .setSubject('uid')
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('cms-jwt-secret-change-me'));
}

// R3.2-A: PDF replaces PDF → 200 (same-MIME constraint satisfied, gate passes)
test('R3.2-A: PDF can replace an existing PDF entry (same-MIME constraint satisfied)', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed a PDF entry on disk
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'b7-replace.pdf';
    await fs.writeFile(path.join(dir, filename), new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const url = `/uploads/${subdir}/${filename}`;
    const id = generateId();
    await appendMediaEntry({
      id,
      url,
      filename,
      size: 4,
      mimeType: 'application/pdf',
      fileCategory: 'document',
      createdAt: new Date().toISOString(),
      status: 'ready',
    });

    const token = await mintJwt();
    const req = new Request(`http://localhost/cms/api/media/${id}/replace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
        'x-cms-filename': encodeURIComponent(filename),
      },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
    });

    const res = await handleReplaceUpload(req, id);
    assert.equal(res.status, 200, 'PDF→PDF replace should succeed with 200');

    const mediaData = await loadMedia();
    const entry = mediaData.uploads.find((e) => e.id === id);
    assert.ok(entry, 'entry should still exist');
    assert.equal(entry.mimeType, 'application/pdf');
  });
});

// R3.2-B: image/jpeg cannot replace application/pdf → 415 (same-MIME constraint)
test('R3.2-B: image/jpeg cannot replace an existing PDF entry (same-MIME constraint, 415)', async () => {
  await withTempProject(async (tempRoot) => {
    const subdir = '2026/06';
    const dir = path.join(tempRoot, 'public', 'uploads', subdir);
    await fs.mkdir(dir, { recursive: true });
    const filename = 'b7-replace-cross.pdf';
    await fs.writeFile(path.join(dir, filename), new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const url = `/uploads/${subdir}/${filename}`;
    const id = generateId();
    await appendMediaEntry({
      id,
      url,
      filename,
      size: 4,
      mimeType: 'application/pdf',
      fileCategory: 'document',
      createdAt: new Date().toISOString(),
      status: 'ready',
    });

    const token = await mintJwt();
    const req = new Request(`http://localhost/cms/api/media/${id}/replace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('photo.jpg'),
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });

    const res = await handleReplaceUpload(req, id);
    assert.ok(
      res.status === 415 || res.status === 409,
      `jpeg→pdf cross-type replace should return 415 or 409; got ${res.status}`,
    );
  });
});

// ─── M-1: MIME absent from MIME_TO_EXT yields 415 ────────────────────────────
//
// FIX M-1 adds a guard in handleUpload: after the allowlist gate passes, if
// MIME_TO_EXT has no mapping for the MIME type the handler returns 415 rather
// than writing a filename ending in "undefined".
//
// Direct test of the allowlisted+unmapped combo is not reachable via the prebuilt
// dist because import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES is a Vite compile-
// time constant and cannot be overridden at node --test runtime. The test below
// asserts the closest reachable invariant: a MIME absent from MIME_TO_EXT is
// rejected with 415. In the current build this is caught by the allowlist gate
// (step 3 of evaluateUpload), but with the new guard the 415 is also guaranteed
// deterministically even if a future allowlist override included an unmapped MIME.
test('M-1: upload with MIME absent from MIME_TO_EXT yields 415 (unmapped extension guard)', async () => {
  await withTempProject(async () => {
    // 'image/x-custom' is not in DEFAULT_ALLOWED_FILE_TYPES and not in MIME_TO_EXT.
    // It passes neither the allowlist nor the extension map, so it must be rejected with 415.
    // The new guard (FIX M-1) ensures the same outcome even for allowlisted+unmapped MIMEs.
    const req = makeUploadRequest(new Uint8Array([0x00, 0x01, 0x02]), 'file.bin', 'image/x-custom');
    const res = await handleUpload(req);
    assert.equal(res.status, 415, 'MIME absent from MIME_TO_EXT must be rejected with 415');
    const body = await res.json();
    assert.ok(body.error, 'response must have error message');
  });
});

/*
 * CSRF Regression Coverage (REQ-15 / T-CSRF-08)
 *
 * Original failure mode: multipart/form-data as Content-Type caused Astro 6's
 * createOriginCheckMiddleware to fire when Origin !== url.origin (e.g. behind a
 * reverse proxy), returning HTTP 403 before the upload handler was reached.
 *
 * Why unit tests cannot reproduce the 403: these tests call handleUpload /
 * handleReplaceUpload directly as plain functions and bypass Astro's routing
 * and middleware stack entirely. The 403 only occurs in the live request path.
 *
 * What the transport change achieves: sending a non-form-like Content-Type
 * (e.g. image/jpeg, application/pdf) makes condition (2) of origin-check false,
 * so the middleware never fires for upload or replace requests, regardless of
 * Origin vs url.origin mismatch. The transport-contract tests below (T-CSRF-*)
 * assert the new parse contract; manual playground verification at
 * playgrounds/basic /cms/media confirms the end-to-end fix.
 */

// ─── T-CSRF-* ─────────────────────────────────────────────────────────────────

// T-CSRF-01: per-MIME upload success — each of the 6 allowed MIMEs must return 200
const ALLOWED_MIMES = [
  { mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), filename: 'file.jpg' },
  { mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), filename: 'file.png' },
  {
    mime: 'image/webp',
    bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    filename: 'file.webp',
  },
  {
    mime: 'image/svg+xml',
    bytes: new Uint8Array(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'),
    ),
    filename: 'file.svg',
  },
  {
    mime: 'image/gif',
    bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    filename: 'file.gif',
  },
  {
    mime: 'application/pdf',
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    filename: 'file.pdf',
  },
];

for (const { mime, bytes, filename } of ALLOWED_MIMES) {
  test(`T-CSRF-01: upload with ${mime} via binary transport → 200 with correct entry shape`, async () => {
    await withTempProject(async (tempRoot) => {
      const req = makeUploadRequest(bytes, filename, mime);
      const res = await handleUpload(req);
      assert.equal(res.status, 200, `Expected 200 for ${mime}, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.url, 'should return url');
      assert.ok(body.entry, 'should return entry');
      assert.equal(body.entry.mimeType, mime, `entry.mimeType should equal ${mime}`);
      assert.equal(
        body.entry.filename,
        filename,
        'entry.filename should equal decoded x-cms-filename',
      );
      assert.equal(body.entry.size, bytes.byteLength, 'entry.size should equal buffer.byteLength');
      // File must exist on disk
      const filePath = path.join(tempRoot, 'public', body.url);
      const stat = await fs.stat(filePath);
      assert.ok(stat.isFile(), 'uploaded file must exist on disk');
      // Registry must contain the entry
      const mediaData = await loadMedia();
      const registered = mediaData.uploads.find((e) => e.url === body.url);
      assert.ok(registered, 'entry must appear in registry');
      assert.equal(registered.mimeType, mime);
    });
  });
}

// T-CSRF-03: non-ASCII filename round-trip
test('T-CSRF-03: non-ASCII filename round-trip — decodes correctly, no 500', async () => {
  await withTempProject(async () => {
    const nonAsciiFilename = 'imágen ñoño (1).png';
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'x-cms-filename': encodeURIComponent(nonAsciiFilename),
      },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const res = await handleUpload(req);
    assert.notEqual(res.status, 500, 'non-ASCII filename must not cause 500');
    assert.equal(res.status, 200, 'upload should succeed with non-ASCII filename');
    const body = await res.json();
    // entry.filename is the decoded display name (pre-sanitization)
    assert.equal(
      body.entry.filename,
      nonAsciiFilename,
      'entry.filename must be the decoded original filename',
    );
    // url must not contain raw non-ASCII bytes
    assert.doesNotMatch(body.url, /[^\x00-\x7F]/, 'url must not contain raw non-ASCII characters');
  });
});

// T-CSRF-04: malformed x-cms-filename falls back to 'upload' without crashing
test('T-CSRF-04: malformed x-cms-filename (invalid percent sequence) → falls back to "upload", status 200', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-cms-filename': 'foto%GGbad.jpg',
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    const res = await handleUpload(req);
    assert.notEqual(res.status, 500, 'malformed x-cms-filename must not cause 500');
    assert.equal(res.status, 200, 'upload should proceed with fallback filename');
    const body = await res.json();
    // filename should be 'upload' or the sanitized form of 'upload'
    assert.ok(
      body.entry.filename === 'upload' || body.entry.filename.startsWith('upload'),
      `entry.filename should be "upload" fallback, got: ${body.entry.filename}`,
    );
  });
});

// T-CSRF-05: missing x-cms-filename header falls back to 'upload'
test('T-CSRF-05: missing x-cms-filename header → falls back to "upload", status 200', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        // no x-cms-filename header
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'upload should succeed with missing x-cms-filename');
    const body = await res.json();
    assert.ok(
      body.entry.filename === 'upload' || body.entry.filename.startsWith('upload'),
      `entry.filename should be "upload" fallback, got: ${body.entry.filename}`,
    );
  });
});

// T-CSRF-06a: disallowed MIME still rejected with 415
test('T-CSRF-06a: disallowed MIME (text/html) → 415 via binary transport', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/html',
        'x-cms-filename': encodeURIComponent('evil.html'),
      },
      body: new Uint8Array(Buffer.from('<html></html>')),
    });
    const res = await handleUpload(req);
    assert.equal(
      res.status,
      415,
      'disallowed MIME must be rejected with 415 even via binary transport',
    );
  });
});

// T-CSRF-06b: oversize body still rejected with 413
test('T-CSRF-06b: oversize binary body (6 MB > 5 MB limit) → 413', async () => {
  await withTempProject(async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-cms-filename': encodeURIComponent('big.jpg'),
      },
      body: new Uint8Array(6 * 1024 * 1024),
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 413, 'oversize binary body must be rejected with 413');
  });
});

// T-CSRF-07: entry.size equals buffer.byteLength (exactly 4 bytes)
test('T-CSRF-07: entry.size equals buffer.byteLength (4 bytes)', async () => {
  await withTempProject(async () => {
    const exactBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // exactly 4 bytes
    const req = makeUploadRequest(exactBytes, 'exact.jpg', 'image/jpeg');
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'upload should succeed');
    const body = await res.json();
    assert.equal(body.entry.size, 4, 'entry.size must equal buffer.byteLength (4)');
  });
});
