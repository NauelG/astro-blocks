/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The reported incident, encoded.
 *
 * A consumer sets `allowedFileTypes: ['video/mp4']` and uploads an MP4. The security gate
 * approves it — it honours the allowlist — and the very next statement rejects it with the
 * same 415, because the extension map has no `video/mp4` row. Two allowlists, one declared.
 *
 * This state was previously unreachable from the test suite (the allowlist is a Vite
 * compile-time constant), which is why the bug shipped: it was approximated by a
 * neighbouring test and canonised as "FIX M-1". __setAllowedFileTypesForTest makes it
 * reachable. See docs/specs/media-uploads.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMedia } from '../dist/api/data.js';
import { handleUpload, __setAllowedFileTypesForTest } from '../dist/api/handlers.js';
import { drainVariantJobs } from '../dist/utils/variant-generator.js';

/** Minimal MP4 header: a real `ftyp` box. The handler trusts Content-Type and never sniffs, but a
 *  test that ships plausible bytes is a test that keeps being honest if that ever changes. */
const MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
]);

async function withTempProject(allowed, fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-video-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  __setAllowedFileTypesForTest(allowed);
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    // Drain fire-and-forget variant jobs before restoring the env var (#96).
    await drainVariantJobs();
    __setAllowedFileTypesForTest(null);
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function makeUploadRequest(bytes, fileName, mimeType) {
  return new Request('http://localhost/cms/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': mimeType, 'x-cms-filename': encodeURIComponent(fileName) },
    body: bytes,
  });
}

// ─── S1: the incident ────────────────────────────────────────────────────────

test('S1: an MP4 uploads when video/mp4 is in allowedFileTypes', async () => {
  await withTempProject(['video/mp4'], async () => {
    const res = await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    assert.equal(res.status, 200, 'the gate approved video/mp4 — nothing downstream may 415 it');
  });
});

test('S1: the stored MP4 is named from the MIME, with a .mp4 extension', async () => {
  await withTempProject(['video/mp4'], async () => {
    const res = await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    const { url } = await res.json();
    assert.ok(url.endsWith('.mp4'), `expected a .mp4 extension, got ${url}`);
  });
});

test('S1: the stored MP4 is categorised as video, not document', async () => {
  await withTempProject(['video/mp4'], async () => {
    const res = await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    const { entry } = await res.json();
    assert.equal(entry.fileCategory, 'video');
  });
});

test('S1: video generates no variants and still reaches a ready status', async () => {
  await withTempProject(['video/mp4'], async () => {
    await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    await drainVariantJobs();
    const media = await loadMedia();
    const entry = media.uploads.find((u) => u.mimeType === 'video/mp4');
    assert.ok(entry, 'the entry must be in the registry');
    assert.notEqual(entry.status, 'processing', 'variant generation must settle, not hang');
    assert.equal(entry.variants?.length ?? 0, 0, 'video is not raster — no variants');
  });
});

test('S1: the bytes actually land on disk', async () => {
  await withTempProject(['video/mp4'], async (tempRoot) => {
    const res = await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    const { url } = await res.json();
    const onDisk = path.join(tempRoot, 'public', url);
    const stat = await fs.stat(onDisk);
    assert.equal(stat.size, MP4_BYTES.length);
  });
});

// ─── S6: video is NOT enabled by default ─────────────────────────────────────

test('S6: with the default allowlist, an MP4 is rejected with 415', async () => {
  await withTempProject(null, async () => {
    const res = await handleUpload(makeUploadRequest(MP4_BYTES, 'clip.mp4', 'video/mp4'));
    assert.equal(res.status, 415, 'video must be opt-in — the catalog is not the allowlist');
  });
});
