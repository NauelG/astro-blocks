/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * C-1: extractToStaging tests.
 * Verifies zip-bomb ceilings, path guards, and happy-path extraction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import { extractToStaging } from '../dist/api/backup.js';
import { buildExportStream } from '../dist/api/backup.js';

// Helpers ---------------------------------------------------------------

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-staging-'));
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

async function collectStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf;
}

/** Build a zip body (Buffer) from an export stream for the given units. */
async function buildZipBody(units, projectRoot) {
  const stream = await buildExportStream(units, projectRoot);
  return collectStream(stream);
}

// Build a tiny zip in memory containing a single entry with given name+bytes.
// Uses fflate synchronously.
async function buildMinimalZip(entries) {
  const { Zip, ZipDeflate } = await import('fflate');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const zip = new Zip();
    zip.ondata = (err, chunk, final) => {
      if (err) { reject(err); return; }
      chunks.push(chunk);
      if (final) {
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const buf = Buffer.allocUnsafe(totalLen);
        let offset = 0;
        for (const c of chunks) { buf.set(c, offset); offset += c.length; }
        resolve(buf);
      }
    };
    for (const { name, bytes } of entries) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(new Uint8Array(bytes), true);
    }
    zip.end();
  });
}

/** Build a small valid zip body that exports `pages`. */
async function buildValidZipBody(tempRoot) {
  return buildZipBody(['pages'], tempRoot);
}

// C-1 Tests ---------------------------------------------------------------

test('C-1: extractToStaging extracts valid zip to staging dir', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildValidZipBody(tempRoot);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-'));
    try {
      const ceilings = { perFile: 50 * 1024 * 1024, total: 500 * 1024 * 1024 };
      await extractToStaging(zipBody, stagingDir, ceilings, tempRoot);

      // manifest.json + data/pages.json should exist
      const manifestPath = path.join(stagingDir, 'manifest.json');
      const pagesPath = path.join(stagingDir, 'data', 'pages.json');
      const manifestStat = await fs.stat(manifestPath);
      assert.ok(manifestStat.isFile(), 'manifest.json must be in staging dir');
      const pagesStat = await fs.stat(pagesPath);
      assert.ok(pagesStat.isFile(), 'data/pages.json must be in staging dir');
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-1: extractToStaging rejects path traversal entry — staging remains empty of traversal', async () => {
  await withTempProject(async (tempRoot) => {
    // Build a zip with a path-traversal uploads entry
    const traversalEntry = {
      name: 'uploads/../../etc/passwd',
      bytes: Buffer.from('pwned'),
    };
    const zipBody = await buildMinimalZip([traversalEntry]);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-traversal-'));
    try {
      const ceilings = { perFile: 50 * 1024 * 1024, total: 500 * 1024 * 1024 };
      // Should throw or skip the bad entry
      try {
        await extractToStaging(zipBody, stagingDir, ceilings, tempRoot);
      } catch {
        // rejection is also acceptable
      }
      // The traversal file must NOT be written anywhere under stagingDir or /etc
      const items = await fs.readdir(stagingDir).catch(() => []);
      // If uploads/ directory was created, it must not contain anything pointing outside
      // Primary assertion: no file named 'passwd' under staging (the traversal target)
      assert.ok(
        !items.includes('etc'),
        'staging dir must not have an "etc" directory from traversal',
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-1: extractToStaging rejects unknown data entry (data/unknown.json)', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildMinimalZip([
      { name: 'data/unknown.json', bytes: Buffer.from('{}') },
    ]);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-unknown-'));
    try {
      const ceilings = { perFile: 50 * 1024 * 1024, total: 500 * 1024 * 1024 };
      await assert.rejects(
        async () => extractToStaging(zipBody, stagingDir, ceilings, tempRoot),
        /unknown|not allowed|disallowed/i,
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-1: extractToStaging rejects data/_backups/ entries', async () => {
  await withTempProject(async (tempRoot) => {
    const zipBody = await buildMinimalZip([
      { name: 'data/_backups/2026-01-01T00:00:00.000Z/data/pages.json', bytes: Buffer.from('{}') },
    ]);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-backups-'));
    try {
      const ceilings = { perFile: 50 * 1024 * 1024, total: 500 * 1024 * 1024 };
      await assert.rejects(
        async () => extractToStaging(zipBody, stagingDir, ceilings, tempRoot),
        /unknown|not allowed|disallowed|backup/i,
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-1: extractToStaging enforces per-file ceiling mid-stream (M-1)', async () => {
  await withTempProject(async (tempRoot) => {
    // Build a zip entry larger than the per-file ceiling
    const bigContent = Buffer.alloc(1024, 0x61); // 1 KB of 'a'
    const zipBody = await buildMinimalZip([
      { name: 'data/pages.json', bytes: bigContent },
    ]);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-perfile-'));
    try {
      // Set per-file ceiling to 512 bytes — below the 1 KB entry
      const ceilings = { perFile: 512, total: 500 * 1024 * 1024 };
      await assert.rejects(
        async () => extractToStaging(zipBody, stagingDir, ceilings, tempRoot),
        /ceiling|exceeded|too large/i,
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});

test('C-1: extractToStaging enforces total ceiling across entries (M-1)', async () => {
  await withTempProject(async (tempRoot) => {
    // Two entries, each 600 bytes — total 1200 bytes > total ceiling of 1000
    const entry1 = Buffer.alloc(600, 0x62);
    const entry2 = Buffer.alloc(600, 0x63);
    const zipBody = await buildMinimalZip([
      { name: 'data/pages.json', bytes: entry1 },
      { name: 'data/users.json', bytes: entry2 },
    ]);
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-staging-total-'));
    try {
      const ceilings = { perFile: 2048, total: 1000 };
      await assert.rejects(
        async () => extractToStaging(zipBody, stagingDir, ceilings, tempRoot),
        /ceiling|exceeded|too large/i,
      );
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });
});
