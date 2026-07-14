/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * HTTP Range support on the uploads route (ADR-0024).
 *
 * Without this, "AstroBlocks supports video" is a false claim. Safari requests the first two
 * bytes of a media source and, absent a 206 with a Content-Range, DISCARDS the source and
 * plays nothing — it does not fall back to a broken seek bar. Chrome and Firefox tolerate a
 * 200 but cannot seek.
 *
 * The streaming half matters for every category, not just video: the route used to read the
 * whole file into memory on every GET, on a path that has no authentication.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GET } from '../dist/routes/uploads-get.js';

/** 1 KB of recognisable bytes: byte i has value i % 256, so a range's content is checkable. */
const BODY = new Uint8Array(1024).map((_, i) => i % 256);

async function withFile(subpath, content, fn) {
  const prevRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-range-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

  const filePath = path.join(tempRoot, 'public', 'uploads', subpath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);

  try {
    await fn(`/uploads/${subpath}`);
  } finally {
    if (prevRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = prevRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function get(url, range) {
  const headers = range ? { Range: range } : {};
  return GET({ request: new Request(`http://localhost${url}`, { headers }) });
}

// ─── S13: a plain GET advertises Range support ───────────────────────────────

test('S13: a GET with no Range returns 200 and advertises Accept-Ranges', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(res.headers.get('Content-Type'), 'video/mp4');

    const body = new Uint8Array(await res.arrayBuffer());
    assert.equal(body.length, BODY.length, 'the full body');
  });
});

test('S13: Accept-Ranges is advertised for images too, not just video', async () => {
  await withFile('2026/07/photo.jpg', BODY, async (url) => {
    const res = await get(url);
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  });
});

// ─── S12: Safari's probe ─────────────────────────────────────────────────────

test("S12: Range: bytes=0-1 returns 206 with Content-Range — this is Safari's probe", async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url, 'bytes=0-1');

    assert.equal(res.status, 206, 'a 200 here means Safari discards the source and plays nothing');
    assert.equal(res.headers.get('Content-Range'), `bytes 0-1/${BODY.length}`);
    assert.equal(res.headers.get('Content-Length'), '2');

    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...body], [0, 1], 'exactly the two bytes asked for');
  });
});

test('S12: a mid-file range returns exactly those bytes — this is what seeking is', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url, 'bytes=100-109');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), `bytes 100-109/${BODY.length}`);

    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...body], [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });
});

test('S12: an open-ended range (bytes=N-) runs to the end of the file', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url, 'bytes=1000-');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), `bytes 1000-1023/${BODY.length}`);
    assert.equal((await res.arrayBuffer()).byteLength, 24);
  });
});

test('S12: a suffix range (bytes=-N) returns the last N bytes', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url, 'bytes=-10');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), `bytes 1014-1023/${BODY.length}`);
    assert.equal((await res.arrayBuffer()).byteLength, 10);
  });
});

// ─── Unsatisfiable and unparseable ───────────────────────────────────────────

test('an unsatisfiable range returns 416 with the resource size', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    const res = await get(url, 'bytes=99999-');
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('Content-Range'), `bytes */${BODY.length}`);
  });
});

test('a range we do not understand degrades to a full 200, never to a wrong 206', async () => {
  await withFile('2026/07/clip.mp4', BODY, async (url) => {
    for (const bad of ['bytes=0-99,200-299', 'items=0-1', 'bytes=abc', 'bytes=']) {
      const res = await get(url, bad);
      assert.equal(res.status, 200, `"${bad}" must fall back to a full body`);
      assert.equal((await res.arrayBuffer()).byteLength, BODY.length);
    }
  });
});

// ─── The catalog still governs Content-Type and disposition ──────────────────

test('a ranged SVG is still an attachment — the XSS guard survives the Range path', async () => {
  await withFile('2026/07/icon.svg', BODY, async (url) => {
    const res = await get(url, 'bytes=0-1');
    assert.equal(res.status, 206);
    assert.match(res.headers.get('Content-Disposition') ?? '', /attachment/);
  });
});

test('a missing file is still a 404, Range or not', async () => {
  await withFile('2026/07/clip.mp4', BODY, async () => {
    const res = await get('/uploads/2026/07/nope.mp4', 'bytes=0-1');
    assert.equal(res.status, 404);
  });
});
