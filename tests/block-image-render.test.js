/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * block-image-render.test.js — BlockImage render-branch SELECTION matrix.
 *
 * BlockImage.astro chooses between four <img> branches based on two booleans:
 *   1. hasCaption  → wrap in <figure> + <figcaption>
 *   2. usePicture  → emit <picture> + <source> (avif/webp) vs plain <img>
 *
 * The .astro markup itself cannot be rendered in node:test (no Astro runtime),
 * so this suite exercises the PURE helpers the component composes to make those
 * two decisions — getCaption, imageAttrs, buildSrcset, toImageValue — plus a
 * synthesized media status. Asserting the helper outputs proves the decision
 * logic; the literal HTML emission still needs an E2E/markup test (see NOTE).
 *
 * NOTE: The literal four-branch <img>/<picture> HTML (and {...rest} attribute
 * precedence) is NOT covered here — that requires an Astro container/E2E render
 * harness which does not exist in this repo. This suite covers branch SELECTION.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getCaption, imageAttrs, buildSrcset, toImageValue } from '../dist/utils/image-value.js';

/**
 * Re-implements BlockImage.astro's frontmatter decision logic over the pure
 * helpers + a synthesized getMediaVariants result. This mirrors exactly what the
 * component computes before it picks a branch:
 *   const v = toImageValue(image)
 *   const attrs = imageAttrs(v)
 *   const caption = getCaption(v, captionProp)
 *   const mv = await getMediaVariants(v.url)   // synthesized here
 *   usePicture = mv.status === 'ready' && mv.variants.length > 0
 *   hasCaption = caption.length > 0  (truthy string → <figure>)
 */
function decideBranch(image, mv, captionProp) {
  const v = toImageValue(image);
  const attrs = imageAttrs(v);
  const caption = getCaption(v, captionProp);
  const usePicture = mv.status === 'ready' && mv.variants.length > 0;
  return {
    figure: Boolean(caption), // truthy caption → <figure> wrapper
    picture: usePicture,
    caption,
    attrs,
    avifSrcset: usePicture ? buildSrcset(mv.variants, 'avif') : '',
    webpSrcset: usePicture ? buildSrcset(mv.variants, 'webp') : '',
  };
}

const READY_VARIANTS = [
  { format: 'avif', width: 480, url: '/u/img-480.avif' },
  { format: 'webp', width: 480, url: '/u/img-480.webp' },
  { format: 'avif', width: 960, url: '/u/img-960.avif' },
  { format: 'webp', width: 960, url: '/u/img-960.webp' },
];

const IMAGE_WITH_DIMS = { url: '/u/img.jpg', alt: 'A cat', width: 960, height: 540 };

// ─── caption + ready/variants → figure=true, picture=true, full attrs ─────────

test('P1-A: caption + ready/variants → figure + picture, both srcsets non-empty, alt + dims present', () => {
  const r = decideBranch(
    IMAGE_WITH_DIMS,
    { status: 'ready', variants: READY_VARIANTS },
    'My caption',
  );
  assert.equal(r.figure, true, 'caption present → <figure>');
  assert.equal(r.picture, true, 'ready + variants → <picture>');
  assert.notEqual(r.avifSrcset, '', 'avif srcset must be non-empty');
  assert.notEqual(r.webpSrcset, '', 'webp srcset must be non-empty');
  assert.ok(
    r.avifSrcset.includes('480w') && r.avifSrcset.includes('960w'),
    'avif srcset has both widths',
  );
  assert.equal(r.attrs.alt, 'A cat', 'alt present on img');
  assert.equal(r.attrs.width, 960, 'width dim present');
  assert.equal(r.attrs.height, 540, 'height dim present');
});

// ─── caption + non-picture states → figure=true, picture=false ────────────────

for (const mv of [
  { name: 'processing', status: 'processing', variants: [] },
  { name: 'failed', status: 'failed', variants: [] },
  { name: 'none', status: 'none', variants: [] },
  { name: 'ready-with-0-variants', status: 'ready', variants: [] },
]) {
  test(`P1-B: caption + ${mv.name} → figure=true, picture=false (plain img inside figure)`, () => {
    const r = decideBranch(IMAGE_WITH_DIMS, { status: mv.status, variants: mv.variants }, 'Capt');
    assert.equal(r.figure, true, 'caption present → <figure>');
    assert.equal(r.picture, false, `${mv.name} → NOT <picture>`);
    assert.equal(r.avifSrcset, '', 'no avif srcset when not picture');
    assert.equal(r.webpSrcset, '', 'no webp srcset when not picture');
  });
}

// ─── no caption + ready/variants → figure=false, picture=true ─────────────────

test('P1-C: no caption + ready/variants → figure=false, picture=true', () => {
  const r = decideBranch(IMAGE_WITH_DIMS, { status: 'ready', variants: READY_VARIANTS }, undefined);
  assert.equal(r.figure, false, 'no caption → no <figure>');
  assert.equal(r.picture, true, 'ready + variants → <picture>');
  assert.notEqual(r.avifSrcset, '');
  assert.notEqual(r.webpSrcset, '');
});

// ─── no caption + none → figure=false, picture=false ──────────────────────────

test('P1-D: no caption + none → figure=false, picture=false (bare plain img)', () => {
  const r = decideBranch(IMAGE_WITH_DIMS, { status: 'none', variants: [] }, undefined);
  assert.equal(r.figure, false);
  assert.equal(r.picture, false);
});

// ─── legacy string input → coerced, caption='', picture depends on mv ─────────

test('P1-E: legacy string input → toImageValue coerces, caption="", picture=false when none', () => {
  const r = decideBranch('/uploads/legacy.jpg', { status: 'none', variants: [] }, undefined);
  assert.equal(r.attrs.src, '/uploads/legacy.jpg', 'url coerced from legacy string');
  assert.equal(r.attrs.alt, '', 'legacy string → alt defaults to ""');
  assert.equal(r.attrs.width, undefined, 'legacy string → no width');
  assert.equal(r.caption, '', 'legacy string → no caption');
  assert.equal(r.figure, false, 'empty caption → no figure');
  assert.equal(r.picture, false);
});

// ─── empty / whitespace caption → no figure ───────────────────────────────────

test('P1-F: empty caption prop → no figure', () => {
  const r = decideBranch(IMAGE_WITH_DIMS, { status: 'none', variants: [] }, '');
  assert.equal(r.caption, '', 'empty caption resolves to ""');
  assert.equal(r.figure, false, 'empty caption → no <figure>');
});

test('P1-F: whitespace-only caption prop → no figure (getCaption trims)', () => {
  const r = decideBranch(IMAGE_WITH_DIMS, { status: 'none', variants: [] }, '   ');
  assert.equal(r.caption, '', 'whitespace caption trims to ""');
  assert.equal(r.figure, false, 'whitespace caption → no <figure>');
});

// ─── stored value.caption (no override) still triggers figure ─────────────────

test('P1-G: stored value.caption (no override prop) → figure=true', () => {
  const withCaption = { url: '/u/img.jpg', alt: 'x', caption: 'Stored caption' };
  const r = decideBranch(withCaption, { status: 'none', variants: [] }, undefined);
  assert.equal(r.caption, 'Stored caption', 'falls back to value.caption');
  assert.equal(r.figure, true, 'stored caption → <figure>');
});
