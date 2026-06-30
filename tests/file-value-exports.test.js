/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * file-value-exports.test.js
 *
 * Tests for Slice C5 — package.json exports for the file helper.
 * Spec: fileDownloadUrl (and file-value helpers) importable from an export entry.
 * Design: mirror the BlockImage/getMediaVariants export pattern.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ─── C5: fileDownloadUrl importable via the package exports path ──────────────

test('C5: fileDownloadUrl importable from dist/utils/file-value.js', async () => {
  const mod = await import('../dist/utils/file-value.js');
  assert.ok(typeof mod.fileDownloadUrl === 'function', 'fileDownloadUrl must be a function');
  assert.ok(typeof mod.toFileValue === 'function', 'toFileValue must be a function');
  assert.ok(typeof mod.parseFileValue === 'function', 'parseFileValue must be a function');
  assert.ok(typeof mod.isEmptyFileValue === 'function', 'isEmptyFileValue must be a function');
  assert.ok(typeof mod.mediaEntryToFileValue === 'function', 'mediaEntryToFileValue must be a function');
});

test('C5: package root re-exports DEFAULT_ALLOWED_FILE_TYPES', async () => {
  // Import from the compiled package root entry point
  const mod = await import('../dist/plugin/index.js');
  assert.ok('DEFAULT_ALLOWED_FILE_TYPES' in mod, 'DEFAULT_ALLOWED_FILE_TYPES must be re-exported from package root');
  assert.ok(Array.isArray(mod.DEFAULT_ALLOWED_FILE_TYPES), 'must be an array');
  assert.ok(mod.DEFAULT_ALLOWED_FILE_TYPES.includes('application/pdf'), 'must include application/pdf');
});
