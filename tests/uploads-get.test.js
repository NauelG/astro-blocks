/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GET } from '../dist/routes/uploads-get.js';

/**
 * Creates a temporary project root with a real file at the given subpath under
 * public/uploads/, calls GET with that URL, and cleans up afterwards.
 */
async function withUploadedFile(subpath, content, fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-uploads-get-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

  const filePath = path.join(tempRoot, 'public', 'uploads', subpath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);

  try {
    await fn(filePath);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

// SEC-CDN-01: SVG under /uploads/... must return Content-Disposition: attachment
test('SEC-CDN-01: GET /uploads/*.svg returns Content-Disposition: attachment', async () => {
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';

  await withUploadedFile('2026/06/test-image.svg', svgContent, async () => {
    const req = new Request('http://localhost/uploads/2026/06/test-image.svg');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), 'attachment',
      'SVG must be served with Content-Disposition: attachment to prevent inline rendering');
    assert.equal(res.headers.get('Content-Type'), 'image/svg+xml');
  });
});

// SEC-CDN-02: JPEG under /uploads/... must NOT have Content-Disposition header
test('SEC-CDN-02: GET /uploads/*.jpg does NOT return Content-Disposition header', async () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  await withUploadedFile('2026/06/test-photo.jpg', jpegBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/test-photo.jpg');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), null,
      'JPEG must NOT have Content-Disposition header');
    assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
  });
});

// SEC-CDN-03: PNG must NOT have Content-Disposition header
test('SEC-CDN-03: GET /uploads/*.png does NOT return Content-Disposition header', async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  await withUploadedFile('2026/06/test-image.png', pngBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/test-image.png');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), null,
      'PNG must NOT have Content-Disposition header');
    assert.equal(res.headers.get('Content-Type'), 'image/png');
  });
});

// SEC-CDN-04: WebP must NOT have Content-Disposition header
test('SEC-CDN-04: GET /uploads/*.webp does NOT return Content-Disposition header', async () => {
  const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

  await withUploadedFile('2026/06/test-image.webp', webpBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/test-image.webp');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), null,
      'WebP must NOT have Content-Disposition header');
    assert.equal(res.headers.get('Content-Type'), 'image/webp');
  });
});

// SEC-CDN-05: GIF must NOT have Content-Disposition header
test('SEC-CDN-05: GET /uploads/*.gif does NOT return Content-Disposition header', async () => {
  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]);

  await withUploadedFile('2026/06/test-image.gif', gifBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/test-image.gif');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Disposition'), null,
      'GIF must NOT have Content-Disposition header');
    assert.equal(res.headers.get('Content-Type'), 'image/gif');
  });
});

// SEC-CDN-06: Non-existent file returns 404
test('SEC-CDN-06: GET /uploads/missing.svg returns 404', async () => {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-uploads-get-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

  try {
    // Create the uploads dir but no file inside
    await fs.mkdir(path.join(tempRoot, 'public', 'uploads'), { recursive: true });

    const req = new Request('http://localhost/uploads/2026/06/missing.svg');
    const res = await GET({ request: req });
    assert.equal(res.status, 404);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// SEC-CDN-07: Path traversal attempt returns 404 (resolveUploadPath rejects it)
test('SEC-CDN-07: GET /uploads/../etc/passwd returns 404 (traversal rejected)', async () => {
  const req = new Request('http://localhost/uploads/../etc/passwd');
  const res = await GET({ request: req });
  assert.equal(res.status, 404);
});
