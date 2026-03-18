import test from 'node:test';
import assert from 'node:assert/strict';

import { pageToSlugParam, resolveCanonical, resolveSeoImage, slugToPath } from '../dist/utils/slug.js';

test('slugToPath normalizes homepage and nested slugs', () => {
  assert.equal(slugToPath('/'), '/');
  assert.equal(slugToPath('about'), '/about');
  assert.equal(slugToPath(['docs', 'intro']), '/docs/intro');
});

test('pageToSlugParam returns empty string for home', () => {
  assert.equal(pageToSlugParam({ slug: '/' }), '');
  assert.equal(pageToSlugParam({ slug: ['docs', 'intro'] }), 'docs/intro');
});

test('resolveSeoImage turns relative paths into absolute URLs', () => {
  assert.equal(resolveSeoImage('https://example.com', '/cover.png'), 'https://example.com/cover.png');
  assert.equal(resolveSeoImage('https://example.com', 'https://cdn.example.com/cover.png'), 'https://cdn.example.com/cover.png');
});

test('resolveCanonical preserves explicit canonical values', () => {
  assert.equal(resolveCanonical('https://example.com', '/about', { canonical: 'https://canonical.test/about' }), 'https://canonical.test/about');
  assert.equal(resolveCanonical('https://example.com', '/about'), 'https://example.com/about');
});
