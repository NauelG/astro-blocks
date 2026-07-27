/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The two accept lists a media-bearing prop has (ADR-0036, #104).
 *
 * `uploadAccept` answers "what may this field upload" and intersects the global allowlist.
 * `browseAccept` answers "what may this field pick from what already exists" and does NOT.
 * They used to be one list, which produced two defects — both covered below.
 *
 * Both functions take the allowlist as an injectable parameter (the idiom file-catalog.ts already
 * uses for `catalog`), because `getGlobalAllowlist()` reads a build-time bake that node --test
 * cannot set (#81). Injecting is what makes the allowlist-dependent cases testable at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeUploadAccept,
  computeBrowseAccept,
} from '../dist/routes/admin/client/block-form/file-accept.js';
import { mimesForCategory } from '../dist/utils/file-catalog.js';

// ─── uploadAccept — intersects, because the server enforces the allowlist ────

test('uploadAccept intersects the declared accept with the allowlist', () => {
  const result = computeUploadAccept({ accept: ['image/png', 'application/pdf'] }, [
    'image/png',
    'image/jpeg',
  ]);
  assert.deepEqual(result, ['image/png'], 'pdf is dropped: the server would reject the upload');
});

test('uploadAccept with no declared accept is the whole allowlist', () => {
  assert.deepEqual(computeUploadAccept({}, ['image/png', 'image/jpeg']), [
    'image/png',
    'image/jpeg',
  ]);
});

test('uploadAccept is empty when nothing declared survives the allowlist', () => {
  assert.deepEqual(computeUploadAccept({ accept: ['application/pdf'] }, ['image/png']), []);
});

// ─── browseAccept — does NOT intersect ──────────────────────────────────────

test('browseAccept keeps a declared type the allowlist no longer permits', () => {
  // THE DEFECT. A prop declares accept:['application/pdf']; the owner later drops pdf from
  // allowedFileTypes. The old single list intersected to [], and the picker's `length > 0` guard
  // then disabled filtering entirely — so a STRICTER allowlist produced a MORE permissive picker,
  // and the PDFs the prop is for could not be re-selected.
  assert.deepEqual(computeBrowseAccept({ accept: ['application/pdf'] }, 'file', ['image/png']), [
    'application/pdf',
  ]);
});

test('browseAccept for an image prop is the catalog image rows', () => {
  const result = computeBrowseAccept({}, 'image', ['image/png']);
  assert.deepEqual([...result].sort(), [...mimesForCategory('image')].sort());
  assert.ok(result.length > 1, 'not narrowed to the allowlist');
  assert.ok(!result.includes('application/pdf'), 'an image picker never offers a document');
  assert.ok(!result.includes('video/mp4'), 'nor a video');
});

test('browseAccept for an unrestricted file prop is empty — no filter, whole library', () => {
  assert.deepEqual(computeBrowseAccept({}, 'file', ['image/png']), []);
});

test('browseAccept prefers the declared accept over the mode default', () => {
  assert.deepEqual(computeBrowseAccept({ accept: ['image/png'] }, 'image'), ['image/png']);
});

// ─── Both lowercase ─────────────────────────────────────────────────────────

test('a mixed-case declared accept is lowercased by both functions', () => {
  assert.deepEqual(computeUploadAccept({ accept: ['Application/PDF'] }, ['application/pdf']), [
    'application/pdf',
  ]);
  assert.deepEqual(computeBrowseAccept({ accept: ['Application/PDF'] }, 'file'), [
    'application/pdf',
  ]);
});
