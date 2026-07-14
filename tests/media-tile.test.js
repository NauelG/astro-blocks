/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The shared media-tile rule.
 *
 * Three grids draw media entries — the server-rendered one in media.astro, the client one in
 * client/media.ts, and the block picker in client/block-form.ts — and each used to decide the
 * tile for itself. The picker's copy did not even consult fileCategory; it parsed the MIME
 * string. Three copies of a rule are three chances to disagree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_ICON,
  categoryIconSvg,
  categoryThumbClass,
  resolveTileCategory,
} from '../dist/utils/media-tile.js';

// ─── resolveTileCategory ─────────────────────────────────────────────────────

test('a stored fileCategory is trusted', () => {
  for (const category of ['image', 'video', 'audio', 'document']) {
    assert.equal(
      resolveTileCategory({ mimeType: 'application/pdf', fileCategory: category }),
      category,
    );
  }
});

test('a legacy entry with no fileCategory resolves through the catalog', () => {
  assert.equal(resolveTileCategory({ mimeType: 'image/png' }), 'image');
  assert.equal(resolveTileCategory({ mimeType: 'application/pdf' }), 'document');
  assert.equal(resolveTileCategory({ mimeType: 'video/mp4' }), 'video');
  assert.equal(resolveTileCategory({ mimeType: 'audio/mpeg' }), 'audio');
});

test('a MIME with no catalog row falls back to document — the conservative tile', () => {
  assert.equal(resolveTileCategory({ mimeType: 'application/x-gone' }), 'document');
});

test('a garbage fileCategory is ignored, not rendered', () => {
  assert.equal(
    resolveTileCategory({ mimeType: 'image/png', fileCategory: 'spreadsheet' }),
    'image',
  );
});

test('a video no longer renders as a document — the drift this rule exists to stop', () => {
  const entry = { mimeType: 'video/mp4', fileCategory: 'video' };
  assert.notEqual(resolveTileCategory(entry), 'document');
});

// ─── The icons ───────────────────────────────────────────────────────────────

test('every non-image category has an icon', () => {
  for (const category of ['video', 'audio', 'document']) {
    assert.ok(CATEGORY_ICON[category]?.length > 0, `${category} needs an icon`);
  }
});

test('the icons are distinguishable — a video must not look like a PDF', () => {
  const svgs = ['video', 'audio', 'document'].map((c) => categoryIconSvg(c));
  assert.equal(new Set(svgs).size, 3, 'each category renders a different glyph');
});

test('the document icon geometry is unchanged — this change must not restyle existing tiles', () => {
  const svg = categoryIconSvg('document');
  assert.match(svg, /M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z/);
  assert.match(svg, /points="14 2 14 8 20 8"/);
});

test('an icon carries aria-hidden — the tile owns the accessible name (WCAG 1.1.1)', () => {
  for (const category of ['video', 'audio', 'document']) {
    assert.match(categoryIconSvg(category), /aria-hidden="true"/);
  }
});

test('icons are stroked with currentColor — the surface owns the colour, not the glyph', () => {
  assert.match(categoryIconSvg('video'), /stroke="currentColor"/);
});

test('no <video> element is rendered in the grid', () => {
  // A <video preload="metadata"> tile would paint a real first frame without ffmpeg, and it is
  // tempting now that Range works. It also fires range requests from every tile on a 24-item
  // page. It is a UX iteration with its own GATE — not a rider on a security change. This
  // assertion is here so that a later "improvement" has to argue with a test.
  for (const category of ['video', 'audio', 'document']) {
    assert.doesNotMatch(categoryIconSvg(category), /<video|<audio|<source/);
  }
});

// ─── The thumb class ─────────────────────────────────────────────────────────

test('the thumb class keeps the existing --doc name for documents', () => {
  assert.equal(categoryThumbClass('document'), 'cms-media-card-thumb--doc');
  assert.equal(categoryThumbClass('video'), 'cms-media-card-thumb--video');
  assert.equal(categoryThumbClass('audio'), 'cms-media-card-thumb--audio');
});
