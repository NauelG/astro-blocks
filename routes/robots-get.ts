/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getPublishedPages, loadPages, loadSite } from '../api/data.js';
import { getCacheConfig, getRobotsCacheTags } from '../utils/cache.js';
import { slugToPath } from '../utils/slug.js';

export const prerender = false;

export async function GET(Astro: import('astro').APIContext): Promise<Response> {
  const cacheConfig = getCacheConfig();
  if (cacheConfig.enabled && Astro.cache.enabled) {
    Astro.cache.set({
      maxAge: cacheConfig.maxAge,
      swr: cacheConfig.swr,
      tags: getRobotsCacheTags(),
    });
  }

  const [site, pagesData] = await Promise.all([loadSite(), loadPages()]);
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';
  const published = getPublishedPages(pagesData);
  const noIndexPaths = published
    .filter((page) => page.indexable === false)
    .map((page) => slugToPath(page.slug))
    .filter((pagePath) => pagePath !== '/');

  const disallowLines = ['Disallow: /cms', ...noIndexPaths.map((pagePath) => `Disallow: ${pagePath}`)].join('\n');
  const txt = `User-agent: *
${disallowLines}
Sitemap: ${baseUrl}/sitemap-index.xml
`;

  return new Response(txt, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
