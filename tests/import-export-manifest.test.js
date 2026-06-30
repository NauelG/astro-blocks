/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManifest,
  validateManifest,
  UNIT_TO_DATA_FILES,
} from '../dist/api/manifest.js';
import { DATA_SCHEMA_VERSION } from '../dist/api/schema-version.js';

// A-3: buildManifest

test('A-3: buildManifest returns object with schemaVersion equal to DATA_SCHEMA_VERSION', () => {
  const manifest = buildManifest(
    ['pages'],
    { pages: 3 },
    { 'data/pages.json': 'abc123' },
  );
  assert.equal(manifest.schemaVersion, DATA_SCHEMA_VERSION);
});

test('A-3: buildManifest sets astroBlocksVersion to a non-empty string', () => {
  const manifest = buildManifest(['pages'], { pages: 3 }, { 'data/pages.json': 'abc123' });
  assert.equal(typeof manifest.astroBlocksVersion, 'string');
  assert.ok(manifest.astroBlocksVersion.length > 0, 'astroBlocksVersion should be non-empty');
});

test('A-3: buildManifest sets exportedAt to an ISO 8601 string', () => {
  const manifest = buildManifest(['pages'], { pages: 3 }, { 'data/pages.json': 'abc123' });
  assert.equal(typeof manifest.exportedAt, 'string');
  assert.match(manifest.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
});

test('A-3: buildManifest propagates units, counts, and checksums', () => {
  const units = ['pages'];
  const counts = { pages: 3 };
  const checksums = { 'data/pages.json': 'abc123' };
  const manifest = buildManifest(units, counts, checksums);
  assert.deepEqual(manifest.units, units);
  assert.deepEqual(manifest.counts, counts);
  assert.deepEqual(manifest.checksums, checksums);
});

// A-3: validateManifest

function makeValidManifest() {
  return buildManifest(['pages'], { pages: 1 }, { 'data/pages.json': 'aabbcc' });
}

test('A-3: validateManifest returns { ok: true } for a valid manifest', () => {
  const result = validateManifest(makeValidManifest());
  assert.deepEqual(result, { ok: true });
});

test('A-3: validateManifest returns { ok: false } with reason containing "schemaVersion" for empty object', () => {
  const result = validateManifest({});
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /schemaVersion/);
});

test('A-3: validateManifest returns { ok: false } with reason containing "version mismatch" for wrong schemaVersion', () => {
  const valid = makeValidManifest();
  const result = validateManifest({ ...valid, schemaVersion: 99 });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /version mismatch/);
});

test('A-3: validateManifest returns { ok: false } when checksums is null', () => {
  const valid = makeValidManifest();
  const result = validateManifest({ ...valid, checksums: null });
  assert.equal(result.ok, false);
});

test('A-3: validateManifest returns { ok: false } for null input', () => {
  const result = validateManifest(null);
  assert.equal(result.ok, false);
});

// A-3: UNIT_TO_DATA_FILES mapping

test('A-3: UNIT_TO_DATA_FILES has exactly 5 units', () => {
  const keys = Object.keys(UNIT_TO_DATA_FILES);
  assert.equal(keys.length, 5);
  assert.ok(keys.includes('pages'));
  assert.ok(keys.includes('media'));
  assert.ok(keys.includes('users'));
  assert.ok(keys.includes('configuration'));
  assert.ok(keys.includes('global-blocks'));
});

test('A-3: UNIT_TO_DATA_FILES maps to exactly 9 unique files total', () => {
  const allFiles = Object.values(UNIT_TO_DATA_FILES).flat();
  const unique = new Set(allFiles);
  assert.equal(unique.size, 9);
});

test('A-3: UNIT_TO_DATA_FILES configuration maps to 5 files', () => {
  assert.equal(UNIT_TO_DATA_FILES['configuration'].length, 5);
});
