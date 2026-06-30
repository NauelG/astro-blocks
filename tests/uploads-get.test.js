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
    const disposition = res.headers.get('Content-Disposition');
    assert.ok(
      disposition !== null && disposition.includes('attachment'),
      `SVG must be served with Content-Disposition: attachment to prevent inline rendering; got: ${disposition}`
    );
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

// R5.1-A: PDF served with Content-Type: application/pdf (B6)
test('R5.1-A: GET /uploads/*.pdf returns Content-Type: application/pdf', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  await withUploadedFile('2026/06/doc.pdf', pdfBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/doc.pdf');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  });
});

// R5.2-A: PDF served inline by default (no ?download → no attachment) (B6)
test('R5.2-A: GET /uploads/*.pdf without ?download has no attachment disposition', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  await withUploadedFile('2026/06/report.pdf', pdfBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/report.pdf');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    const disposition = res.headers.get('Content-Disposition');
    assert.ok(
      disposition === null || !disposition.includes('attachment'),
      `Content-Disposition should not contain attachment; got: ${disposition}`
    );
  });
});

// R5.3-A: ?download forces Content-Disposition: attachment (B6)
test('R5.3-A: GET /uploads/*.pdf?download returns Content-Disposition: attachment', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  await withUploadedFile('2026/06/report.pdf', pdfBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/report.pdf?download');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    const disposition = res.headers.get('Content-Disposition');
    assert.ok(
      disposition !== null && disposition.includes('attachment'),
      `Content-Disposition should contain attachment; got: ${disposition}`
    );
  });
});

// R5.5-A: Unknown extension served as application/octet-stream (B6)
test('R5.5-A: GET /uploads/*.xyz returns Content-Type: application/octet-stream', async () => {
  await withUploadedFile('2026/06/data.xyz', Buffer.from('some data'), async () => {
    const req = new Request('http://localhost/uploads/2026/06/data.xyz');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/octet-stream');
  });
});

// R5.6-A: PDF response includes Cache-Control: no-cache (B6)
test('R5.6-A: GET /uploads/*.pdf response includes Cache-Control: no-cache', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  await withUploadedFile('2026/06/cached.pdf', pdfBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/cached.pdf');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  });
});

// CC-01: Any uploads-get response must include Cache-Control: no-cache header
test('CC-01: GET /uploads/*.jpg response includes Cache-Control: no-cache', async () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  await withUploadedFile('2026/06/cache-test.jpg', jpegBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/cache-test.jpg');
    const res = await GET({ request: req });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-cache',
      'all uploads-get responses must include Cache-Control: no-cache');
    assert.equal(res.headers.get('Content-Type'), 'image/jpeg',
      'Content-Type must still be set correctly');
  });
});

// L-1: ?download Content-Disposition filename must contain only safe characters (defense in depth)
test('L-1: GET /uploads/*.pdf?download Content-Disposition filename contains only safe chars', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  // Use a filename whose safe-by-construction characters are all in [A-Za-z0-9._-]
  // The sanitization regex replaces anything outside that set with '_'.
  // This test locks the boundary: the filename in the header must match the expected safe pattern.
  await withUploadedFile('2026/06/report.pdf', pdfBytes, async () => {
    const req = new Request('http://localhost/uploads/2026/06/report.pdf?download');
    const res = await GET({ request: req });

    assert.equal(res.status, 200);
    const disposition = res.headers.get('Content-Disposition');
    assert.ok(disposition !== null && disposition.includes('attachment'), `Expected attachment disposition; got: ${disposition}`);

    // Extract the filename= value from the header
    const match = disposition.match(/filename="([^"]*)"/);
    assert.ok(match, `Content-Disposition header must include filename="..."; got: ${disposition}`);
    const filename = match[1];

    // The filename must consist only of safe characters: A-Z a-z 0-9 . _ -
    assert.match(
      filename,
      /^[A-Za-z0-9._-]+$/,
      `Content-Disposition filename must contain only [A-Za-z0-9._-]; got: "${filename}"`
    );
  });
});

// CC-02: SVG still gets Content-Disposition even with Cache-Control
test('CC-02: GET /uploads/*.svg has both Cache-Control: no-cache and Content-Disposition: attachment', async () => {
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';

  await withUploadedFile('2026/06/cache-test.svg', svgContent, async () => {
    const req = new Request('http://localhost/uploads/2026/06/cache-test.svg');
    const res = await GET({ request: req });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-cache',
      'SVG must also have Cache-Control: no-cache');
    const disposition = res.headers.get('Content-Disposition');
    assert.ok(
      disposition !== null && disposition.includes('attachment'),
      `SVG must still have Content-Disposition: attachment; got: ${disposition}`
    );
  });
});
