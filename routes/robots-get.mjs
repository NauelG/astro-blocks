export const prerender = false;
import { loadSite, loadPages, getPublishedPages } from '../api/data.mjs';

/** Path for Disallow (e.g. "/about" or "/a/b"). Home is "/". */
function pageToDisallowPath(page) {
  const slug = page.slug;
  if (slug === '/' || (Array.isArray(slug) && slug.length === 0)) return '/';
  const path = Array.isArray(slug) ? slug.join('/') : String(slug).replace(/^\//, '');
  return `/${path}`;
}

export async function GET() {
  const [site, pagesData] = await Promise.all([loadSite(), loadPages()]);
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';
  const published = getPublishedPages(pagesData);
  const noIndexPaths = published
    .filter((p) => p.indexable === false)
    .map(pageToDisallowPath)
    .filter((path) => path !== '/'); // do not Disallow: / (blocks entire site)
  const disallowLines = ['Disallow: /cms', ...noIndexPaths.map((p) => `Disallow: ${p}`)].join('\n');
  const txt = `User-agent: *
${disallowLines}
Sitemap: ${baseUrl}/sitemap-index.xml
`;
  return new Response(txt, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
