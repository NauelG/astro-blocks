/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLocale, getPageLocaleViewStrict, getPublishedPagesStrict, loadLanguages, loadPages, loadSite } from '../api/data.js';
import { getCacheConfig, getRobotsCacheTags } from '../utils/cache.js';
import { buildLocalizedPath, slugToPath } from '../utils/slug.js';
import { normalizeLocaleCode } from '../utils/localization.js';

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

  const [site, pagesData, languagesData] = await Promise.all([loadSite(), loadPages(), loadLanguages()]);
  const defaultLocale = getDefaultLocale(languagesData);
  const enabledLocales = languagesData.languages.filter((language) => language.enabled !== false).map((language) => normalizeLocaleCode(language.code));
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';

  const noIndexPaths = new Set<string>();

  for (const locale of enabledLocales) {
    const published = getPublishedPagesStrict(pagesData, locale);
    for (const page of published) {
      const view = getPageLocaleViewStrict(page, locale);
      if (view.indexable !== false) continue;
      const localizedPath = slugToPath(buildLocalizedPath(view.slug, locale, defaultLocale));
      if (localizedPath !== '/') noIndexPaths.add(localizedPath);
    }
  }

  const disallowLines = ['Disallow: /cms', ...Array.from(noIndexPaths).map((pagePath) => `Disallow: ${pagePath}`)].join('\n');
  const txt = `User-agent: *
${disallowLines}
Sitemap: ${baseUrl}/sitemap-index.xml
`;

  return new Response(txt, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
