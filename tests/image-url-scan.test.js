/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * image-url-scan.test.js — Walker shape matrix (data-loss acceptance gate)
 * All W-01..W-13 test cases must pass before any Phase 2+ work ships.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { scanPropsForUrl } from '../dist/utils/image-url-scan.js';

const TARGET = '/uploads/2026/06/foo.jpg';
const OTHER = '/uploads/2026/06/bar.jpg';

// W-01 — S-A: direct ImageFieldValue match
test('W-01: S-A direct ImageFieldValue — returns 1 match with shape=direct', () => {
  const props = { hero: { url: TARGET, alt: '' } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1, 'should find exactly 1 match');
  assert.equal(matches[0].propName, 'hero');
  assert.equal(matches[0].shape, 'direct');
});

// W-02 — S-B: localized ImageFieldValue map, match in es
test('W-02: S-B localized map — match in es locale, 1 result', () => {
  const props = { hero: { es: { url: TARGET }, en: { url: OTHER } } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1, 'should find exactly 1 match');
  assert.equal(matches[0].propName, 'hero');
  assert.equal(matches[0].shape, 'localizedMap');
});

// W-03 — S-B: localized map, no match (both locales differ)
test('W-03: S-B localized map — no locale matches, 0 results', () => {
  const props = { hero: { es: { url: OTHER }, en: { url: OTHER } } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 0, 'should find 0 matches');
});

// W-04 — S-C: array with one matching ImageFieldValue
test('W-04: S-C array — one item matches, 1 result', () => {
  const props = { gallery: [{ url: TARGET }, { url: OTHER }] };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1, 'should find exactly 1 match');
  assert.equal(matches[0].propName, 'gallery');
  assert.equal(matches[0].shape, 'arrayItem');
});

// W-05 — S-C: array with two matching items
test('W-05: S-C array — two items match, 2 results (both under same propName)', () => {
  const props = { gallery: [{ url: TARGET }, { url: TARGET }] };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 2, 'should find exactly 2 matches');
  assert.equal(matches[0].propName, 'gallery');
  assert.equal(matches[1].propName, 'gallery');
  assert.equal(matches[0].shape, 'arrayItem');
});

// W-06 — S-D: legacy bare string prop value
test('W-06: S-D legacy bare string — 1 match with shape=legacyString', () => {
  const props = { image: TARGET };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].propName, 'image');
  assert.equal(matches[0].shape, 'legacyString');
});

// W-07 — S-E: seo.image plain string (walker called on seo-like object)
// The walker is a pure function and cannot distinguish seo context from any
// other plain-string prop.  It always emits 'legacyString' for bare strings.
// The aggregator (findMediaUsages) applies source:'seo' externally — 'seoString'
// was a dead union member that has been removed.
test('W-07: S-E seo plain string — 1 match with shape=legacyString', () => {
  const props = { image: TARGET };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'legacyString');
});

// W-08 — S-F: seo.image localized map { es: TARGET, en: OTHER }
test('W-08: S-F seo localized string map — match in es locale, 1 result', () => {
  const props = { image: { es: TARGET, en: OTHER } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].propName, 'image');
  // shape should be seoLocalizedMap or localizedMap
  assert.ok(
    matches[0].shape === 'seoLocalizedMap' || matches[0].shape === 'localizedMap',
    `Expected seoLocalizedMap or localizedMap, got ${matches[0].shape}`
  );
});

// W-09 — S-G: false-positive guard — unrelated object with .url !== target
test('W-09: S-G false-positive guard — unrelated .url value, 0 matches', () => {
  const props = { link: { url: OTHER, label: 'Go' } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 0, 'must not match an object whose .url !== target');
});

// W-10 — S-H: multiple props both containing target url
test('W-10: S-H multiple props same url — 2 matches, one per prop', () => {
  const props = { a: { url: TARGET }, b: { url: TARGET } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 2, 'should find exactly 2 matches');
  const propNames = matches.map((m) => m.propName).sort();
  assert.deepEqual(propNames, ['a', 'b']);
});

// W-11 — S-I: url not present in any prop
test('W-11: S-I url absent — 0 matches', () => {
  const props = { a: { url: OTHER } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 0);
});

// W-12 — empty props
test('W-12: empty props — 0 matches, no error', () => {
  const matches = scanPropsForUrl({}, TARGET);
  assert.equal(matches.length, 0);
});

// W-13 — nested object without .url
test('W-13: nested object without .url — 0 matches, no error', () => {
  const props = { meta: { title: 'x', count: 42 } };
  const matches = scanPropsForUrl(props, TARGET);
  assert.equal(matches.length, 0);
});
