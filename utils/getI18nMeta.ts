/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { slugToPath } from './slug.js';
import { normalizeLocaleCode } from './localization.js';

export type I18nAlternatePath = {
  locale: string;
  path: string;
};

export type I18nLayoutContext = {
  locale: string;
  defaultLocale: string;
  alternates: I18nAlternatePath[];
};

export type I18nMetaLink = {
  hrefLang: string;
  href: string;
};

export type I18nMetaResult = {
  htmlLang: string;
  ogLocale: string;
  ogLocaleAlternate: string[];
  alternates: I18nMetaLink[];
};

export type GetI18nMetaOptions = {
  baseUrl?: string;
  includeXDefault?: boolean;
};

function localeToOgLocale(locale: string): string {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return '';
  const [language, region] = normalized.split('-');
  if (!region) return language;
  return `${language}_${region.toUpperCase()}`;
}

function toAbsoluteUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}${path === '/' ? '/' : path}`;
}

/**
 * Builds SEO i18n metadata (lang + hreflang + OG locale tags) for consumer layouts.
 * AstroBlocks provides the `i18n` prop in CMS-rendered pages; pass it directly here.
 */
export function getI18nMeta(i18n: I18nLayoutContext | undefined, options: GetI18nMetaOptions = {}): I18nMetaResult | null {
  if (!i18n) return null;

  const locale = normalizeLocaleCode(i18n.locale);
  const defaultLocale = normalizeLocaleCode(i18n.defaultLocale);
  const includeXDefault = options.includeXDefault !== false;

  const alternates = (i18n.alternates || [])
    .map((entry) => ({
      locale: normalizeLocaleCode(entry.locale),
      path: slugToPath(entry.path),
    }))
    .filter((entry) => Boolean(entry.locale && entry.path))
    .reduce<I18nAlternatePath[]>((acc, entry) => {
      if (acc.some((existing) => existing.locale === entry.locale)) return acc;
      acc.push(entry);
      return acc;
    }, []);

  if (alternates.length === 0) return null;

  const baseUrl = String(options.baseUrl || '').trim();
  const links: I18nMetaLink[] = alternates.map((entry) => ({
    hrefLang: entry.locale,
    href: toAbsoluteUrl(baseUrl, entry.path),
  }));

  if (includeXDefault) {
    const defaultEntry = alternates.find((entry) => entry.locale === defaultLocale);
    if (defaultEntry) {
      links.push({
        hrefLang: 'x-default',
        href: toAbsoluteUrl(baseUrl, defaultEntry.path),
      });
    }
  }

  const currentOgLocale = localeToOgLocale(locale || defaultLocale);
  const alternateOgLocales = alternates
    .map((entry) => entry.locale)
    .filter((entryLocale) => entryLocale !== locale)
    .map(localeToOgLocale)
    .filter(Boolean);

  return {
    htmlLang: locale || defaultLocale || 'en',
    ogLocale: currentOgLocale,
    ogLocaleAlternate: Array.from(new Set(alternateOgLocales)),
    alternates: links,
  };
}
