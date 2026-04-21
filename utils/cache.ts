/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Page } from '../types/index.js';
import { buildLocalizedPath, slugToPath } from './slug.js';
import { normalizeLocaleCode } from './localization.js';

export const CACHE_NAMESPACE = 'astro-blocks';
export const CACHE_TAGS = {
  root: CACHE_NAMESPACE,
  pages: `${CACHE_NAMESPACE}:pages`,
  menus: `${CACHE_NAMESPACE}:menus`,
  redirects: `${CACHE_NAMESPACE}:redirects`,
  configs: `${CACHE_NAMESPACE}:configs`,
  site: `${CACHE_NAMESPACE}:site`,
  global: `${CACHE_NAMESPACE}:global`,
  globalBlocks: `${CACHE_NAMESPACE}:global-blocks`,
} as const;
export const CACHE_PATHS = {
  sitemap: '/sitemap-index.xml',
  robots: '/robots.txt',
} as const;

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function localizedSlugFromPage(page: Pick<Page, 'slug'>, locale?: string, defaultLocale?: string): string | string[] {
  const rawSlug = page.slug as unknown;

  if (typeof rawSlug === 'string' || Array.isArray(rawSlug)) return rawSlug;

  if (!rawSlug || typeof rawSlug !== 'object') return '/';

  const map = rawSlug as Record<string, string | string[]>;
  const normalizedLocale = normalizeLocaleCode(locale);
  const normalizedDefault = normalizeLocaleCode(defaultLocale);

  if (normalizedLocale && map[normalizedLocale] !== undefined) return map[normalizedLocale];
  if (normalizedDefault && map[normalizedDefault] !== undefined) return map[normalizedDefault];

  const first = Object.keys(map)[0];
  return first ? map[first] : '/';
}

export function getPathCacheTag(pathname: string): string {
  return `${CACHE_NAMESPACE}:path:${pathname}`;
}

export function getPageCachePath(
  page: Pick<Page, 'slug'> | string | string[],
  locale?: string,
  defaultLocale?: string
): string {
  const normalizedLocale = normalizeLocaleCode(locale);
  const normalizedDefault = normalizeLocaleCode(defaultLocale);

  const basePath =
    typeof page === 'string' || Array.isArray(page)
      ? slugToPath(page)
      : slugToPath(localizedSlugFromPage(page, normalizedLocale, normalizedDefault));

  if (!normalizedLocale || normalizedLocale === normalizedDefault) return basePath;
  return buildLocalizedPath(basePath, normalizedLocale, normalizedDefault);
}

export function getGlobalCacheTags(): string[] {
  return [CACHE_TAGS.root, CACHE_TAGS.global, CACHE_TAGS.pages, CACHE_TAGS.menus, CACHE_TAGS.redirects, CACHE_TAGS.configs, CACHE_TAGS.site, CACHE_TAGS.globalBlocks];
}

export function getGlobalCachePaths(): string[] {
  return [CACHE_PATHS.sitemap, CACHE_PATHS.robots];
}

export function getPageCacheTags(
  page: Pick<Page, 'id' | 'slug'>,
  locale?: string,
  defaultLocale?: string
): string[] {
  const pagePath = getPageCachePath(page, locale, defaultLocale);
  return uniqueStrings([
    ...getGlobalCacheTags(),
    CACHE_TAGS.pages,
    `${CACHE_NAMESPACE}:page:${page.id}`,
    ...(locale ? [`${CACHE_NAMESPACE}:locale:${normalizeLocaleCode(locale)}`] : []),
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
