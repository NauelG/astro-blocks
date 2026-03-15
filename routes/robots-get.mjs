export const prerender = false;
import { loadSite } from '../api/data.mjs';

export async function GET() {
  const site = await loadSite();
  const baseUrl = site.baseUrl?.replace(/\/$/, '') || '';
  const txt = `User-agent: *
Disallow: /cms
Sitemap: ${baseUrl}/sitemap-index.xml
`;
  return new Response(txt, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
