/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectBackupsToPrune,
  assertWithinCeilings,
  readCeilingEnvVars,
  DEFAULT_MAX_IMPORT_FILE_BYTES,
  DEFAULT_MAX_IMPORT_TOTAL_BYTES,
} from '../dist/api/import-utils.js';

// A-6: selectBackupsToPrune

test('A-6: selectBackupsToPrune returns oldest entries beyond keep=5', () => {
  const dirs = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06'];
  const result = selectBackupsToPrune(dirs, 5);
  assert.deepEqual(result, ['2024-01-01']);
});

test('A-6: selectBackupsToPrune returns empty when count equals keep', () => {
  const result = selectBackupsToPrune(['2024-01-01'], 5);
  assert.deepEqual(result, []);
});

test('A-6: selectBackupsToPrune returns empty for empty array', () => {
  assert.deepEqual(selectBackupsToPrune([], 5), []);
});

test('A-6: selectBackupsToPrune returns multiple when far over retention', () => {
  const dirs = [
    '2024-01-01',
    '2024-01-02',
    '2024-01-03',
    '2024-01-04',
    '2024-01-05',
    '2024-01-06',
    '2024-01-07',
  ];
  const result = selectBackupsToPrune(dirs, 5);
  assert.deepEqual(result, ['2024-01-01', '2024-01-02']);
});

// A-6: assertWithinCeilings

test('A-6: assertWithinCeilings does not throw when within limits', () => {
  assert.doesNotThrow(() => {
    assertWithinCeilings(500, 1000, { perFile: 1024, total: 10240 });
  });
});

test('A-6: assertWithinCeilings throws with /per-file/ when perFile exceeds limit', () => {
  assert.throws(
    () => assertWithinCeilings(2000, 1000, { perFile: 1024, total: 10240 }),
    /per-file/,
  );
});

test('A-6: assertWithinCeilings throws with /total/ when total exceeds limit', () => {
  assert.throws(() => assertWithinCeilings(500, 20000, { perFile: 1024, total: 10240 }), /total/);
});

// A-6: readCeilingEnvVars

test('A-6: readCeilingEnvVars returns defaults when env vars are unset', () => {
  const prev1 = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
  const prev2 = process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'];
  try {
    delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    delete process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'];
    const result = readCeilingEnvVars();
    assert.equal(result.perFile, DEFAULT_MAX_IMPORT_FILE_BYTES);
    assert.equal(result.total, DEFAULT_MAX_IMPORT_TOTAL_BYTES);
  } finally {
    if (prev1 === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = prev1;
    if (prev2 === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'] = prev2;
  }
});

test('A-6: readCeilingEnvVars reads ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES', () => {
  const prev = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
  try {
    process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = '999';
    const result = readCeilingEnvVars();
    assert.equal(result.perFile, 999);
  } finally {
    if (prev === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = prev;
  }
});

test('A-6: readCeilingEnvVars reads ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES', () => {
  const prev = process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'];
  try {
    process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'] = '9999';
    const result = readCeilingEnvVars();
    assert.equal(result.total, 9999);
  } finally {
    if (prev === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES'] = prev;
  }
});

// H-1: readCeilingEnvVars must reject NaN/zero/negative — fall back to default

test('H-1: readCeilingEnvVars falls back to default perFile when env is non-numeric ("abc")', () => {
  const prev = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
  try {
    process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = 'abc';
    const result = readCeilingEnvVars();
    assert.equal(result.perFile, DEFAULT_MAX_IMPORT_FILE_BYTES);
  } finally {
    if (prev === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = prev;
  }
});

test('H-1: readCeilingEnvVars falls back to default perFile when env is "0"', () => {
  const prev = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
  try {
    process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = '0';
    const result = readCeilingEnvVars();
    assert.equal(result.perFile, DEFAULT_MAX_IMPORT_FILE_BYTES);
  } finally {
    if (prev === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = prev;
  }
});

test('H-1: readCeilingEnvVars falls back to default perFile when env is "-1"', () => {
  const prev = process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
  try {
    process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = '-1';
    const result = readCeilingEnvVars();
    assert.equal(result.perFile, DEFAULT_MAX_IMPORT_FILE_BYTES);
  } finally {
    if (prev === undefined) delete process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'];
    else process.env['ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES'] = prev;
  }
});

// M-2: selectBackupsToPrune must clamp keep < 1 to 1 (never wipe all backups)

test('M-2: selectBackupsToPrune with keep=0 returns only the oldest entries (clamps to keep=1)', () => {
  const dirs = ['2024-01-01', '2024-01-02', '2024-01-03'];
  const result = selectBackupsToPrune(dirs, 0);
  // clamp-to-1: keeps the newest 1, so returns the oldest 2
  assert.equal(result.length, 2);
  assert.ok(result.includes('2024-01-01'));
  assert.ok(result.includes('2024-01-02'));
  assert.ok(!result.includes('2024-01-03'));
});
