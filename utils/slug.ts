/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Page, SeoData, Site } from '../types/index.js';
import { normalizeLocaleCode } from './localization.js';

export function slugToPath(slug?: string | string[]): string {
  if (slug === '/' || slug === '' || slug === undefined) return '/';
  if (Array.isArray(slug)) return slug.length === 0 ? '/' : `/${slug.join('/')}`;
  return `/${String(slug).replace(/^\//, '')}`;
}

export function normalizePathname(pathname: string): string {
  const raw = String(pathname || '/').trim();
  if (!raw) return '/';

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  const withoutTrailingSlash = collapsed.length > 1 ? collapsed.replace(/\/+$/g, '') : collapsed;
  return withoutTrailingSlash || '/';
}

export function pathToSlug(pathname: string): string | string[] {
  const normalized = String(pathname || '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '/';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '/';
  return parts;
}

export function pageToSlugParam(page?: { slug?: string | string[] } | null): string {
  if (!page) return '';
  const path = slugToPath(page.slug);
  return path === '/' ? '' : path.slice(1);
}

export function splitSlugSegments(slug?: string | string[]): string[] {
  if (!slug || slug === '/') return [];
  if (Array.isArray(slug)) return slug.filter(Boolean).map((entry) => String(entry).replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return String(slug)
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function joinSlugSegments(segments: string[]): string | string[] {
  const clean = segments.map((entry) => String(entry).trim()).filter(Boolean);
  if (clean.length === 0) return '/';
  if (clean.length === 1) return clean[0];
  return clean;
}

export function buildLocalizedPath(slug: string | string[], locale: string, defaultLocale: string): string {
  const normalizedLocale = normalizeLocaleCode(locale);
  const normalizedDefault = normalizeLocaleCode(defaultLocale);
  const basePath = slugToPath(slug);

  if (!normalizedLocale || normalizedLocale === normalizedDefault) return basePath;
  if (basePath === '/') return `/${normalizedLocale}`;
  return `/${normalizedLocale}${basePath}`;
}

export function resolveLocalizedSlug(
  slugParam: string | string[] | undefined,
  locales: string[],
  defaultLocale: string
): { locale: string; slug: string | string[] } {
  const normalizedDefault = normalizeLocaleCode(defaultLocale);
  const localeSet = new Set(locales.map((entry) => normalizeLocaleCode(entry)).filter(Boolean));
  const segments = splitSlugSegments(slugParam);

  if (segments.length === 0) {
    return { locale: normalizedDefault, slug: '/' };
  }

  const first = normalizeLocaleCode(segments[0]);
  if (first && localeSet.has(first) && first !== normalizedDefault) {
    const remaining = segments.slice(1);
    return {
      locale: first,
      slug: joinSlugSegments(remaining),
    };
  }

  return {
    locale: normalizedDefault,
    slug: joinSlugSegments(segments),
  };
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

export function resolvePageSeo(site: Site, page: Pick<Page, 'title'> & { slug: string | string[]; seo?: SeoData; indexable?: boolean }): {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  seo: SeoData;
} {
  const seo = page.seo || {};
  const baseUrl = (site.baseUrl || '').replace(/\/$/, '');
  const title = typeof page.title === 'string' ? page.title : site.siteName;

  return {
    title: seo.title ?? site.seo?.defaultTitle ?? title ?? site.siteName,
    description: seo.description ?? site.seo?.defaultDescription ?? '',
    canonical: resolveCanonical(site.baseUrl, page.slug, seo),
    noindex: page.indexable === false,
    seo: {
      ...seo,
      image: resolveSeoImage(baseUrl, seo.image),
    },
  };
}
