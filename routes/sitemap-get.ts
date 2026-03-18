/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getPublishedPages, loadPages, loadSite } from '../api/data.js';
import { getCacheConfig, getSitemapCacheTags } from '../utils/cache.js';
import { slugToPath } from '../utils/slug.js';
import type { Page } from '../types/index.js';

export const prerender = false;

function pageUrl(baseUrl: string, page: Page): string {
  const pagePath = slugToPath(page.slug);
  return pagePath === '/' ? `${baseUrl}/` : `${baseUrl}${pagePath}`;
}

export async function GET(Astro: import('astro').APIContext): Promise<Response> {
  const cacheConfig = getCacheConfig();
  if (cacheConfig.enabled && Astro.cache.enabled) {
    Astro.cache.set({
      maxAge: cacheConfig.maxAge,
      swr: cacheConfig.swr,
      tags: getSitemapCacheTags(),
    });
  }

  const [pagesData, site] = await Promise.all([loadPages(), loadSite()]);
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';
  const published = getPublishedPages(pagesData).filter((page) => page.indexable !== false);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${published
  .map(
    (page) => `  <url>
    <loc>${pageUrl(baseUrl, page)}</loc>
    <lastmod>${page.updatedAt || page.publishedAt || new Date().toISOString()}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
