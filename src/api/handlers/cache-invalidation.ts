/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import {
  getGlobalCachePaths,
  getGlobalCacheTags,
  getPageCachePath,
  getPageCacheTags,
} from '../../utils/cache.js';
import type { Page } from '../../types/index.js';
import type { AstroCache } from './shared.js';

export async function invalidateCachePath(
  cache: AstroCache | null | undefined,
  pathname: string,
): Promise<boolean> {
  if (!cache?.enabled) return false;

  try {
    await cache.invalidate({ path: pathname });
    return true;
  } catch (error) {
    console.warn(`[astro-blocks] Failed to invalidate cache path "${pathname}":`, error);
    return false;
  }
}

export async function invalidateCacheTags(
  cache: AstroCache | null | undefined,
  tags: string[],
): Promise<boolean> {
  if (!cache?.enabled || tags.length === 0) return false;

  try {
    await cache.invalidate({ tags });
    return true;
  } catch (error) {
    console.warn('[astro-blocks] Failed to invalidate cache tags:', tags, error);
    return false;
  }
}

export async function invalidateGlobalContentCache(
  cache: AstroCache | null | undefined,
): Promise<void> {
  await invalidateCacheTags(cache, getGlobalCacheTags());
  for (const pathname of getGlobalCachePaths()) {
    await invalidateCachePath(cache, pathname);
  }
}

export async function invalidatePageContentCache(
  cache: AstroCache | null | undefined,
  locale: string,
  defaultLocale: string,
  currentPage?: Pick<Page, 'id' | 'slug'> | null,
  previousPage?: Pick<Page, 'id' | 'slug'> | null,
): Promise<void> {
  const tags = new Set<string>(getGlobalCacheTags());
  const paths = new Set<string>(getGlobalCachePaths());

  for (const page of [currentPage, previousPage]) {
    if (!page) continue;
    paths.add(getPageCachePath(page, locale, defaultLocale));
    for (const tag of getPageCacheTags(page, locale, defaultLocale)) tags.add(tag);
  }

  for (const pathname of paths) {
    await invalidateCachePath(cache, pathname);
  }

  await invalidateCacheTags(cache, Array.from(tags));
}
