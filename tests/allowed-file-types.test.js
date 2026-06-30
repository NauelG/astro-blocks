/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * allowed-file-types.test.js
 * Unit tests for utils/file-types.ts constants.
 * Tests import from ../dist/ after build.
 *
 * RED phase: written before the implementation exists.
 *
 * Spec: R1.1 (D1, D2). Note: R1.3-A, R1.5-A tests are in Slice C (need plugin/handlers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ALLOWED_FILE_TYPES, RASTER_MIME, DOCUMENT_MIME_TO_EXT, MIME_TO_EXT } from '../dist/utils/file-types.js';

// ─── R1.1-A: DEFAULT_ALLOWED_FILE_TYPES export is correct ────────────────────

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES has exactly 6 entries', () => {
  assert.equal(DEFAULT_ALLOWED_FILE_TYPES.length, 6);
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES sorted equals expected 6 MIMEs', () => {
  const expected = [
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ];
  assert.deepEqual([...DEFAULT_ALLOWED_FILE_TYPES].sort(), expected);
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES contains application/pdf', () => {
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('application/pdf'));
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES contains all image variants', () => {
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/jpeg'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/png'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/webp'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/gif'));
  assert.ok(DEFAULT_ALLOWED_FILE_TYPES.includes('image/svg+xml'));
});

test('R1.1-A: DEFAULT_ALLOWED_FILE_TYPES has no duplicates', () => {
  const unique = new Set(DEFAULT_ALLOWED_FILE_TYPES);
  assert.equal(unique.size, DEFAULT_ALLOWED_FILE_TYPES.length);
});

// ─── RASTER_MIME set ──────────────────────────────────────────────────────────

test('RASTER_MIME contains image/jpeg, image/png, image/webp', () => {
  assert.ok(RASTER_MIME.has('image/jpeg'));
  assert.ok(RASTER_MIME.has('image/png'));
  assert.ok(RASTER_MIME.has('image/webp'));
});

test('RASTER_MIME does NOT contain image/gif', () => {
  assert.ok(!RASTER_MIME.has('image/gif'));
});

test('RASTER_MIME does NOT contain image/svg+xml', () => {
  assert.ok(!RASTER_MIME.has('image/svg+xml'));
});

test('RASTER_MIME does NOT contain application/pdf', () => {
  assert.ok(!RASTER_MIME.has('application/pdf'));
});

test('RASTER_MIME has exactly 3 entries', () => {
  assert.equal(RASTER_MIME.size, 3);
});

// ─── DOCUMENT_MIME_TO_EXT ────────────────────────────────────────────────────

test('DOCUMENT_MIME_TO_EXT maps application/pdf to .pdf', () => {
  assert.equal(DOCUMENT_MIME_TO_EXT['application/pdf'], '.pdf');
});

// ─── MIME_TO_EXT (merged map) ─────────────────────────────────────────────────

test('MIME_TO_EXT maps image/jpeg to .jpg', () => {
  assert.ok(MIME_TO_EXT['image/jpeg'] === '.jpg' || MIME_TO_EXT['image/jpeg'] === '.jpeg');
});

test('MIME_TO_EXT maps image/png to .png', () => {
  assert.equal(MIME_TO_EXT['image/png'], '.png');
});

test('MIME_TO_EXT maps application/pdf to .pdf (merged from DOCUMENT_MIME_TO_EXT)', () => {
  assert.equal(MIME_TO_EXT['application/pdf'], '.pdf');
});
