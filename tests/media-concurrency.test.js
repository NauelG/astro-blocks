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
  appendMediaEntry,
  removeMediaEntryByUrl,
  reconcileMedia,
  generateId,
} from '../dist/api/data.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-media-conc-'));

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

function makeEntry(index) {
  return {
    id: generateId(),
    url: `/uploads/2026/06/file-${index}.jpg`,
    filename: `file-${index}.jpg`,
    size: 100 + index,
    mimeType: 'image/jpeg',
    createdAt: new Date().toISOString(),
  };
}

// Create the on-disk public file so reconcileMedia keeps the entry.
async function touchPublicFile(tempRoot, url) {
  const urlPath = url.startsWith('/') ? url.slice(1) : url;
  const filePath = path.join(tempRoot, 'public', urlPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'x');
}

// CONC-01: N concurrent appends must not corrupt the file and must not lose entries.
test('CONC-01: 10 concurrent appendMediaEntry keep file valid and lose no entries', async () => {
  await withTempProject(async (tempRoot) => {
    const N = 10;
    const entries = Array.from({ length: N }, (_, i) => makeEntry(i));

    await Promise.all(entries.map((entry) => appendMediaEntry(entry)));

    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const raw = await fs.readFile(mediaPath, 'utf-8');

    // Must parse without throwing (no byte-level corruption / trailing garbage).
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw);
    }, 'media.json must remain valid JSON after concurrent appends');

    // No lost updates: all N entries must be present.
    assert.equal(parsed.uploads.length, N, `expected ${N} entries, got ${parsed.uploads.length}`);

    const ids = new Set(parsed.uploads.map((e) => e.id));
    for (const entry of entries) {
      assert.ok(ids.has(entry.id), `entry ${entry.id} must be present`);
    }
  });
});

// CONC-02: concurrent appends + a delete + a reconcile interleaved must keep the
// file valid JSON with no orphaned/duplicate ids.
test('CONC-02: concurrent appends + delete + reconcile keep file valid, no dup/orphan ids', async () => {
  await withTempProject(async (tempRoot) => {
    const N = 10;
    const entries = Array.from({ length: N }, (_, i) => makeEntry(i));

    // Back the entries with real public files so reconcile keeps them.
    await Promise.all(entries.map((e) => touchPublicFile(tempRoot, e.url)));

    // Seed one entry whose file we will NOT create, plus delete one of the new ones.
    const deletedEntry = entries[0];

    const ops = [
      ...entries.map((entry) => appendMediaEntry(entry)),
      reconcileMedia(),
      removeMediaEntryByUrl(deletedEntry.url),
    ];

    await Promise.all(ops);

    const mediaPath = path.join(tempRoot, 'data', 'media.json');
    const raw = await fs.readFile(mediaPath, 'utf-8');

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw);
    }, 'media.json must remain valid JSON after interleaved mutations');

    // No duplicate ids.
    const ids = parsed.uploads.map((e) => e.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'no duplicate ids allowed');

    // No orphaned entry: every remaining entry must have a known id from our set.
    const knownIds = new Set(entries.map((e) => e.id));
    for (const id of ids) {
      assert.ok(knownIds.has(id), `unexpected/orphaned id ${id}`);
    }
  });
});
