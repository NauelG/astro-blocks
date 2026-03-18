/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Page, SeoData, Site } from '../types/index.js';

export function slugToPath(slug?: string | string[]): string {
  if (slug === '/' || slug === '' || slug === undefined) return '/';
  if (Array.isArray(slug)) return slug.length === 0 ? '/' : `/${slug.join('/')}`;
  return `/${String(slug).replace(/^\//, '')}`;
}

export function pageToSlugParam(page?: Pick<Page, 'slug'> | null): string {
  if (!page) return '';
  const path = slugToPath(page.slug);
  return path === '/' ? '' : path.slice(1);
}

export function resolveSeoImage(baseUrl: string, image?: string): string | undefined {
  if (!image) return image;
  if (String(image).startsWith('http')) return image;
  return `${baseUrl}${image.startsWith('/') ? '' : '/'}${image}`;
}

export function resolveCanonical(baseUrl: string, slug: string | string[], seo?: SeoData): string {
  if (seo?.canonical) return seo.canonical;
  const pagePath = slugToPath(slug);
  return `${baseUrl}${pagePath === '/' ? '' : pagePath}`;
}

export function resolvePageSeo(site: Site, page: Page): {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  seo: SeoData;
} {
  const seo = page.seo || {};
  const baseUrl = (site.baseUrl || '').replace(/\/$/, '');

  return {
    title: seo.title ?? site.seo?.defaultTitle ?? page.title ?? site.siteName,
    description: seo.description ?? site.seo?.defaultDescription ?? '',
    canonical: resolveCanonical(site.baseUrl, page.slug, seo),
    noindex: page.indexable === false,
    seo: {
      ...seo,
      image: resolveSeoImage(baseUrl, seo.image),
    },
  };
}
