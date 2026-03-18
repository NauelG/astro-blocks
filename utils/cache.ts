/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Page } from '../types/index.js';
import { slugToPath } from './slug.js';

export const CACHE_NAMESPACE = 'astro-blocks';
export const CACHE_TAGS = {
  root: CACHE_NAMESPACE,
  pages: `${CACHE_NAMESPACE}:pages`,
  menus: `${CACHE_NAMESPACE}:menus`,
  site: `${CACHE_NAMESPACE}:site`,
  global: `${CACHE_NAMESPACE}:global`,
} as const;
export const CACHE_PATHS = {
  sitemap: '/sitemap-index.xml',
  robots: '/robots.txt',
} as const;

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getPathCacheTag(pathname: string): string {
  return `${CACHE_NAMESPACE}:path:${pathname}`;
}

export function getPageCachePath(page: Pick<Page, 'slug'> | string | string[]): string {
  if (typeof page === 'string' || Array.isArray(page)) return slugToPath(page);
  return slugToPath(page.slug);
}

export function getGlobalCacheTags(): string[] {
  return [CACHE_TAGS.root, CACHE_TAGS.global, CACHE_TAGS.pages, CACHE_TAGS.menus, CACHE_TAGS.site];
}

export function getGlobalCachePaths(): string[] {
  return [CACHE_PATHS.sitemap, CACHE_PATHS.robots];
}

export function getPageCacheTags(page: Pick<Page, 'id' | 'slug'>): string[] {
  const pagePath = getPageCachePath(page);
  return uniqueStrings([
    ...getGlobalCacheTags(),
    CACHE_TAGS.pages,
    `${CACHE_NAMESPACE}:page:${page.id}`,
    getPathCacheTag(pagePath),
  ]);
}

export function getSitemapCacheTags(): string[] {
  return uniqueStrings([...getGlobalCacheTags(), getPathCacheTag(CACHE_PATHS.sitemap)]);
}

export function getRobotsCacheTags(): string[] {
  return uniqueStrings([...getGlobalCacheTags(), getPathCacheTag(CACHE_PATHS.robots)]);
}

export function getCacheConfig() {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env || {};
  return {
    enabled: Boolean(env.ASTRO_BLOCKS_CACHE_ENABLED),
    maxAge: Number(env.ASTRO_BLOCKS_CACHE_MAX_AGE || 60),
    swr: Number(env.ASTRO_BLOCKS_CACHE_SWR || 300),
  };
}
