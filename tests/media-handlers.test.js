/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMedia, savePages, loadLanguages } from '../dist/api/data.js';
import { handleUpload, handleDeleteUpload, handleGetPages } from '../dist/api/handlers.js';
import { toImageValue } from '../dist/utils/image-value.js';
import { validateBlockPropsAgainstSchema } from '../dist/utils/block-validation.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-media-'));

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

function makeUploadRequest(fileContent, fileName, mimeType) {
  const fd = new FormData();
  const file = new File([fileContent], fileName, { type: mimeType });
  fd.append('file', file);
  return new Request('http://localhost/cms/api/upload', {
    method: 'POST',
    body: fd,
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
    const existing = { uploads: [{ id: 'test-id', url: '/uploads/x.jpg', filename: 'x.jpg', size: 100, mimeType: 'image/jpeg', createdAt: '2026-01-01T00:00:00.000Z' }] };
    await fs.writeFile(mediaPath, JSON.stringify(existing), 'utf-8');
    // Call ensureDefaultFiles again — must not overwrite
    await ensureDefaultFiles();
    const raw = await fs.readFile(mediaPath, 'utf-8');
    const data = JSON.parse(raw);
    assert.equal(data.uploads.length, 1);
    assert.equal(data.uploads[0].id, 'test-id');
  });
});

// T14-01: Upload with disallowed MIME → HTTP 415
test('T14-01: upload with disallowed MIME type returns 415', async () => {
  await withTempProject(async () => {
    const req = makeUploadRequest(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'document.pdf', 'application/pdf');
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

// T14-02: Upload with allowed MIME → HTTP 200, file on disk
test('T14-02: upload with allowed MIME type (image/jpeg) returns 200 and file is on disk', async () => {
  await withTempProject(async (tempRoot) => {
    const req = makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'photo.jpg', 'image/jpeg');
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
  const original = { url: '/u/img.png', alt: 'Quote with "quotes" & <tags>', width: 400, height: 300 };
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
      'utf-8'
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
    assert.equal(typeof imageProp, 'object', 'FIX-3: image prop must be an object, not a bare string');
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
