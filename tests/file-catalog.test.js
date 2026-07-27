/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The catalog's invariants (ADR-0023).
 *
 * These are the rules that used to live nowhere — which is why five hardcoded maps drifted
 * apart and two of them ended up disagreeing about AVIF.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_FILE_TYPES,
  DEFAULT_ALLOWED_FILE_TYPES,
  decodeAllowlist,
  lookupByMime,
  lookupByExt,
  isRaster,
  toCatalogRow,
  intersectAccept,
  mimesForCategory,
} from '../dist/utils/file-catalog.js';

const CATALOG = BUILTIN_FILE_TYPES;

// ─── The rows are a well-formed table ────────────────────────────────────────

test('every row has a lowercase mime and a dotted lowercase ext', () => {
  for (const row of CATALOG) {
    assert.equal(row.mime, row.mime.toLowerCase(), `${row.mime} must be lowercase`);
    assert.match(row.ext, /^\.[a-z0-9+]+$/, `${row.mime}: ext "${row.ext}" is malformed`);
  }
});

test('mime is a primary key — no two rows share one', () => {
  const mimes = CATALOG.map((r) => r.mime);
  assert.equal(new Set(mimes).size, mimes.length, 'duplicate mime in the catalog');
});

test('ext is unique — two MIMEs storing under the same extension would make lookupByExt ambiguous', () => {
  const exts = CATALOG.map((r) => r.ext);
  assert.equal(new Set(exts).size, exts.length, 'duplicate ext in the catalog');
});

test('every row has a valid category', () => {
  const valid = new Set(['image', 'video', 'audio', 'document']);
  for (const row of CATALOG) {
    assert.ok(valid.has(row.category), `${row.mime} has category "${row.category}"`);
  }
});

// ─── The catalog is NOT the allowlist ────────────────────────────────────────

test('DEFAULT_ALLOWED_FILE_TYPES is a subset of the catalog', () => {
  const mimes = new Set(CATALOG.map((r) => r.mime));
  for (const mime of DEFAULT_ALLOWED_FILE_TYPES) {
    assert.ok(mimes.has(mime), `${mime} is enabled by default but has no catalog row`);
  }
});

test('DEFAULT_ALLOWED_FILE_TYPES still has exactly the 6 shipped types', () => {
  assert.deepEqual([...DEFAULT_ALLOWED_FILE_TYPES].sort(), [
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ]);
});

test('video and audio are in the catalog and NOT enabled by default', () => {
  for (const mime of ['video/mp4', 'video/webm', 'audio/mpeg']) {
    assert.ok(lookupByMime(mime, CATALOG), `${mime} must have a catalog row`);
    assert.ok(
      !DEFAULT_ALLOWED_FILE_TYPES.includes(mime),
      `${mime} must be opt-in — enabling it by default would hand every existing install a new upload and serving surface nobody asked for`,
    );
  }
});

// ─── Lookups round-trip ──────────────────────────────────────────────────────

test('lookupByMime and lookupByExt round-trip every row', () => {
  for (const row of CATALOG) {
    assert.equal(lookupByMime(row.mime, CATALOG)?.ext, row.ext);
    assert.equal(lookupByExt(row.ext, CATALOG)?.mime, row.mime);
  }
});

test('lookups are case-insensitive', () => {
  assert.equal(lookupByMime('IMAGE/JPEG', CATALOG)?.ext, '.jpg');
  assert.equal(lookupByExt('.MP4', CATALOG)?.mime, 'video/mp4');
});

test('an uncatalogued mime or ext resolves to null, not undefined-shaped garbage', () => {
  assert.equal(lookupByMime('application/zip', CATALOG), null);
  assert.equal(lookupByExt('.zip', CATALOG), null);
});

// ─── The raster set is unchanged ─────────────────────────────────────────────

test('raster rows are exactly jpeg, png and webp — this change does not alter what sharp touches', () => {
  const raster = CATALOG.filter((r) => r.raster)
    .map((r) => r.mime)
    .sort();
  assert.deepEqual(raster, ['image/jpeg', 'image/png', 'image/webp']);
});

test('isRaster answers for catalogued and uncatalogued MIMEs alike', () => {
  assert.equal(isRaster('image/png', CATALOG), true);
  assert.equal(isRaster('image/avif', CATALOG), false);
  assert.equal(isRaster('video/mp4', CATALOG), false);
  assert.equal(isRaster('application/zip', CATALOG), false);
});

// ─── Serving policy is data, not an if-statement ─────────────────────────────

test('SVG is attachment — the XSS guard is a column, not a special case in the route', () => {
  assert.equal(lookupByExt('.svg', CATALOG)?.disposition, 'attachment');
});

test('AVIF has a serving Content-Type — the bug that motivated the catalog', () => {
  assert.equal(lookupByExt('.avif', CATALOG)?.contentType, 'image/avif');
});

test('video and audio are served inline, so a browser can play them', () => {
  for (const ext of ['.mp4', '.webm', '.mp3']) {
    assert.equal(lookupByExt(ext, CATALOG)?.disposition, 'inline');
  }
});

// ─── The escape hatch cannot render in our origin ────────────────────────────

test('a registered row is forced to attachment + octet-stream, whatever the consumer passed', () => {
  const row = toCatalogRow({ mime: 'application/zip', ext: '.zip', category: 'document' });
  assert.equal(row.disposition, 'attachment');
  assert.equal(row.contentType, 'application/octet-stream');
  assert.equal(row.raster, false);
});

test('a registered row cannot smuggle in a disposition or contentType', () => {
  const row = toCatalogRow({
    mime: 'application/zip',
    ext: '.zip',
    category: 'document',
    // Not part of the type; a JS consumer could still pass it. It must be ignored.
    disposition: 'inline',
    contentType: 'text/html',
  });
  assert.equal(
    row.disposition,
    'attachment',
    'the escape hatch must not be able to render in our origin',
  );
  assert.equal(row.contentType, 'application/octet-stream');
});

// ─── intersectAccept: behaviour carried over unchanged ───────────────────────

test('intersectAccept returns the full allowlist when accept is omitted or empty', () => {
  const allow = ['image/png', 'application/pdf'];
  assert.deepEqual(intersectAccept(undefined, allow), allow);
  assert.deepEqual(intersectAccept([], allow), allow);
});

test('intersectAccept narrows case-insensitively and never widens', () => {
  const allow = ['image/png', 'application/pdf'];
  assert.deepEqual(intersectAccept(['Application/PDF'], allow), ['application/pdf']);
  assert.deepEqual(intersectAccept(['video/mp4'], allow), []);
});

// ─── decodeAllowlist — the shared validator all three ALLOWED_FILE_TYPES readers use (#116) ───

test('decodeAllowlist normalizes a valid list: lowercase, trim, dedupe', () => {
  assert.deepEqual(decodeAllowlist(['image/png']), ['image/png']);
  assert.deepEqual(decodeAllowlist([' Image/PNG ', 'image/png']), ['image/png']);
  assert.deepEqual(decodeAllowlist(['application/pdf', 'image/jpeg']), [
    'application/pdf',
    'image/jpeg',
  ]);
});

test('decodeAllowlist: an empty array is a valid empty allowlist, NOT a fallback signal', () => {
  // This is the behaviour change (#116): the two admin readers used to require length > 0 and fall
  // back to the full catalog, disagreeing with the server which honours []. Returning [] here (not
  // null) is what makes all three agree.
  assert.deepEqual(decodeAllowlist([]), []);
});

test('decodeAllowlist rejects non-string elements instead of casting them through', () => {
  // file-accept.ts / media.astro used `as string[]`, so [123] would have reached the accept
  // attribute uncoerced. The shared decoder rejects it → caller falls back.
  assert.equal(decodeAllowlist([123]), null);
  assert.equal(decodeAllowlist(['image/png', 42]), null);
  assert.equal(decodeAllowlist(['image/png', '']), null);
});

test('decodeAllowlist rejects a non-array shape', () => {
  assert.equal(decodeAllowlist('image/png'), null);
  assert.equal(decodeAllowlist({ 0: 'image/png' }), null);
  assert.equal(decodeAllowlist(null), null);
});

// ─── mimesForCategory (ADR-0036, #104) ───────────────────────────────────────
//
// The image picker's browseAccept is derived from the catalog rather than kept as a second list,
// so registering a custom image type makes it pickable without touching the picker.

test('mimesForCategory("image") returns every image row and nothing else', () => {
  const images = mimesForCategory('image');
  assert.deepEqual([...images].sort(), [
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ]);
  assert.ok(!images.includes('application/pdf'), 'a document is not an image');
  assert.ok(!images.includes('video/mp4'), 'a video is not an image');
  assert.ok(!images.includes('audio/mpeg'), 'audio is not an image');
});

test('mimesForCategory("video") returns the video rows', () => {
  assert.deepEqual([...mimesForCategory('video')].sort(), ['video/mp4', 'video/webm']);
});

test('mimesForCategory is derived from the catalog, not a hardcoded list', () => {
  // Every returned MIME must resolve to a row whose category is the one asked for.
  for (const category of ['image', 'video', 'audio', 'document']) {
    for (const mime of mimesForCategory(category)) {
      assert.equal(lookupByMime(mime)?.category, category, `${mime} should be ${category}`);
    }
  }
});
