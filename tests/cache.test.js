/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_PATHS,
  getGlobalCachePaths,
  getGlobalCacheTags,
  getPageCachePath,
  getPageCacheTags,
  getPathCacheTag,
  getRobotsCacheTags,
  getSitemapCacheTags,
} from '../dist/utils/cache.js';

test('getPageCachePath normalizes homepage and nested slugs', () => {
  assert.equal(getPageCachePath({ slug: '/' }), '/');
  assert.equal(getPageCachePath({ slug: ['docs', 'intro'] }), '/docs/intro');
  assert.equal(getPageCachePath({ slug: { es: '/about', en: '/about' } }, 'en', 'es'), '/en/about');
});

test('getPageCacheTags includes id, path and global tags', () => {
  const tags = getPageCacheTags({ id: 'page-1', slug: ['docs', 'intro'] });

  assert.ok(tags.includes('astro-blocks'));
  assert.ok(tags.includes('astro-blocks:global'));
  assert.ok(tags.includes('astro-blocks:page:page-1'));
  assert.ok(tags.includes(getPathCacheTag('/docs/intro')));
});

test('global cache paths include sitemap and robots', () => {
  assert.deepEqual(getGlobalCachePaths(), [CACHE_PATHS.sitemap, CACHE_PATHS.robots]);
});

test('global endpoint tags include their dedicated path tags', () => {
  assert.ok(getSitemapCacheTags().includes(getPathCacheTag('/sitemap-index.xml')));
  assert.ok(getRobotsCacheTags().includes(getPathCacheTag('/robots.txt')));
  assert.ok(getGlobalCacheTags().includes('astro-blocks:site'));
  assert.ok(getGlobalCacheTags().includes('astro-blocks:configs'));
});
