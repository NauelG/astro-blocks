/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLocale, getPageLocaleViewStrict, getPublishedPagesStrict, loadLanguages, loadPages, loadSite } from '../api/data.js';
import { getCacheConfig, getSitemapCacheTags } from '../utils/cache.js';
import { buildLocalizedPath, slugToPath } from '../utils/slug.js';
import { normalizeLocaleCode } from '../utils/localization.js';

export const prerender = false;

function pageUrl(baseUrl: string, localizedPath: string): string {
  return localizedPath === '/' ? `${baseUrl}/` : `${baseUrl}${localizedPath}`;
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

  const [pagesData, site, languagesData] = await Promise.all([loadPages(), loadSite(), loadLanguages()]);
  const defaultLocale = getDefaultLocale(languagesData);
  const enabledLocales = languagesData.languages.filter((language) => language.enabled !== false).map((language) => normalizeLocaleCode(language.code));
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';

  const entries: Array<{ path: string; updatedAt: string }> = [];

  for (const locale of enabledLocales) {
    const pages = getPublishedPagesStrict(pagesData, locale);
    for (const page of pages) {
      const view = getPageLocaleViewStrict(page, locale);
      if (view.indexable === false) continue;
      const localizedPath = buildLocalizedPath(view.slug, locale, defaultLocale);
      entries.push({
        path: slugToPath(localizedPath),
        updatedAt: view.updatedAt || view.publishedAt || new Date().toISOString(),
      });
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${pageUrl(baseUrl, entry.path)}</loc>
    <lastmod>${entry.updatedAt}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
