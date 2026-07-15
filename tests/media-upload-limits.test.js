/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Ingest limits and the streaming path (ADR-0024).
 *
 * Before this change, handleUpload read the entire request body into memory with
 * request.arrayBuffer() and only THEN checked the size. The 413 never protected memory — it
 * rejected what the server had already swallowed. Harmless while the ceiling was 5 MB of
 * images; a footgun the moment video raises it to 200 MB.
 *
 * The tests that matter here are the two that are easy to skip: that an oversized upload is
 * refused WITHOUT the body ever being read, and that a body which overruns mid-stream leaves
 * NO partial file behind. A leaked partial upload is the failure mode of a streaming ingest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { handleUpload, __setAllowedFileTypesForTest } from '../dist/api/handlers.js';
import { drainVariantJobs } from '../dist/utils/variant-generator.js';

const MB = 1024 * 1024;

async function withTempProject(allowed, env, fn) {
  const prevRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const prevCeiling = process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-limits-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  if (env?.ceiling !== undefined) process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES = String(env.ceiling);
  else delete process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;

  __setAllowedFileTypesForTest(allowed);
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    // Drain fire-and-forget variant jobs before restoring the env var (#96).
    await drainVariantJobs();
    __setAllowedFileTypesForTest(null);
    if (prevRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = prevRoot;
    if (prevCeiling === undefined) delete process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
    else process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES = prevCeiling;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/** Every file under public/uploads, recursively. The assertion that a 413 left nothing behind. */
async function uploadedFiles(tempRoot) {
  const dir = path.join(tempRoot, 'public', 'uploads');
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

// ─── S7: rejected before the body is touched ─────────────────────────────────

test('S7: an oversized Content-Length is refused with 413 and the body is NEVER read', async () => {
  await withTempProject(['video/mp4'], {}, async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });

    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'x-cms-filename': encodeURIComponent('huge.mp4'),
        'content-length': String(300 * MB), // over the 200 MB video default
      },
      body,
      duplex: 'half',
    });

    const res = await handleUpload(req);
    assert.equal(res.status, 413);

    // `bodyUsed` is the spec's own signal: it flips only when the stream is DISTURBED, i.e.
    // actually read. (Do not instrument the ReadableStream's pull() instead — it fires on its
    // own to fill the queue at construction, so it would report a read that never happened.)
    assert.equal(
      req.bodyUsed,
      false,
      'the whole point: a 413 must cost no memory. If the body was read, the limit protected nothing.',
    );
  });
});

test('S7: a Content-Length within the limit is not refused', async () => {
  await withTempProject(['video/mp4'], {}, async () => {
    const bytes = new Uint8Array(2048);
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4', 'x-cms-filename': 'ok.mp4' },
      body: bytes,
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
  });
});

// ─── S8: a lying Content-Length leaves nothing behind ────────────────────────

test('S8: a body that overruns mid-stream is refused, and leaves NO partial file on disk', async () => {
  await withTempProject(['video/mp4'], { ceiling: 4096 }, async (tempRoot) => {
    // Content-Length claims 100 bytes; the stream actually delivers ~64 KB.
    // The preflight passes, so only the running byte counter can catch this.
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 64; i++) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });

    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'x-cms-filename': encodeURIComponent('liar.mp4'),
        'content-length': '100',
      },
      body,
      duplex: 'half',
    });

    const res = await handleUpload(req);
    assert.equal(
      res.status,
      413,
      'Content-Length is client-supplied; the counter is the authority',
    );

    const left = await uploadedFiles(tempRoot);
    assert.deepEqual(
      left,
      [],
      `a rejected upload must leave nothing on disk, not even a .tmp; found: ${left.join(', ')}`,
    );
  });
});

// ─── S9: ASTRO_BLOCKS_MAX_UPLOAD_BYTES is the runtime global limit ────────────
//
// It REPLACES the per-category defaults; it does not clamp them. That is the semantics it has
// always had (docs/media.md: "Maximum accepted upload size"), and consumers raise it as readily
// as they lower it. Treating it as a hard ceiling would silently cut anyone who had raised it
// back down to the 5 MB image default — a breaking change that only shows up in production,
// when an editor fails to upload a photo.

test('S9: the env var lowers the limit for every category, video included', async () => {
  await withTempProject(['video/mp4'], { ceiling: 1024 }, async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4', 'x-cms-filename': 'clip.mp4' },
      body: new Uint8Array(4096),
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 413, 'a global limit of 1 KB applies to video too');
  });
});

test('S9: the env var RAISES the image limit above 5 MB — the documented behaviour, preserved', async () => {
  await withTempProject(null, { ceiling: 8 * MB }, async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'x-cms-filename': 'big.png' },
      body: new Uint8Array(6 * MB), // over the 5 MB default, under the 8 MB override
    });
    const res = await handleUpload(req);
    assert.equal(
      res.status,
      200,
      'consumers raise this var to allow bigger images; treating it as a ceiling would break them',
    );
  });
});

test('S9: with no env var, a video far above the old 5 MB image limit is accepted', async () => {
  await withTempProject(['video/mp4'], {}, async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4', 'x-cms-filename': 'clip.mp4' },
      body: new Uint8Array(8 * MB), // 8 MB: rejected under the old single 5 MB limit
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 200, 'video has its own default; it is not capped at the image limit');
  });
});

// ─── The image default is unchanged ──────────────────────────────────────────

test('the image limit is still 5 MB — this change must not move it', async () => {
  await withTempProject(null, {}, async () => {
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'x-cms-filename': 'big.png' },
      body: new Uint8Array(6 * MB),
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 413);
  });
});

test('an image under 5 MB still uploads through the buffered path', async () => {
  await withTempProject(null, {}, async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const req = new Request('http://localhost/cms/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'x-cms-filename': 'small.png' },
      body: png,
    });
    const res = await handleUpload(req);
    assert.equal(res.status, 200);
  });
});
