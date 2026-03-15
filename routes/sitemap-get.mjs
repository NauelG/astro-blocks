export const prerender = false;
import { loadPages, getPublishedPages, loadSite } from '../api/data.mjs';

function pageUrl(baseUrl, page) {
  const slug = page.slug;
  if (slug === '/' || (Array.isArray(slug) && slug.length === 0)) return baseUrl + '/';
  const path = Array.isArray(slug) ? slug.join('/') : String(slug).replace(/^\//, '');
  return `${baseUrl}/${path}`;
}

export async function GET() {
  const pagesData = await loadPages();
  const site = await loadSite();
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';
  const published = getPublishedPages(pagesData).filter((p) => p.indexable !== false);
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
