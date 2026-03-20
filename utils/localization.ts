/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ContentLanguage, LanguagesData, LocalizedValueMap, PropDef } from '../types/index.js';

export const DEFAULT_CONTENT_LANGUAGES: LanguagesData = {
  languages: [{ code: 'es', label: 'Español', enabled: true, isDefault: true }],
};

function cloneDefaultLanguagesData(): LanguagesData {
  return {
    languages: DEFAULT_CONTENT_LANGUAGES.languages.map((language) => ({ ...language })),
  };
}

export function normalizeLocaleCode(code: string | undefined | null): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

export function normalizeLanguages(input: unknown): LanguagesData {
  if (!input || typeof input !== 'object') return cloneDefaultLanguagesData();
  const raw = (input as Partial<LanguagesData>).languages;
  if (!Array.isArray(raw) || raw.length === 0) return cloneDefaultLanguagesData();

  const seen = new Set<string>();
  const normalized: ContentLanguage[] = [];

  for (const language of raw) {
    if (!language || typeof language !== 'object') continue;
    const entry = language as Partial<ContentLanguage>;
    const code = normalizeLocaleCode(entry.code);
    if (!code || seen.has(code)) continue;

    seen.add(code);
    normalized.push({
      code,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : code,
      enabled: entry.enabled !== false,
      isDefault: Boolean(entry.isDefault),
    });
  }

  if (normalized.length === 0) return cloneDefaultLanguagesData();

  const enabled = normalized.filter((language) => language.enabled !== false);
  if (enabled.length === 0) {
    normalized[0].enabled = true;
  }

  let defaultIndex = normalized.findIndex((language) => language.isDefault && language.enabled !== false);
  if (defaultIndex === -1) {
    defaultIndex = normalized.findIndex((language) => language.enabled !== false);
  }

  normalized.forEach((language, index) => {
    language.isDefault = index === defaultIndex;
  });

  return { languages: normalized };
}

export function getEnabledLanguages(languagesData: LanguagesData): ContentLanguage[] {
  const languages = Array.isArray(languagesData.languages) ? languagesData.languages : [];
  return languages.filter((language) => language.enabled !== false);
}

export function getDefaultLanguageCode(languagesData: LanguagesData): string {
  const enabled = getEnabledLanguages(languagesData);
  const fallback = normalizeLocaleCode(DEFAULT_CONTENT_LANGUAGES.languages[0].code) || 'es';
  if (enabled.length === 0) return fallback;

  const preferred = enabled.find((language) => language.isDefault);
  return normalizeLocaleCode(preferred?.code || enabled[0].code) || fallback;
}

export function getLocalizedValue<T>(
  map: LocalizedValueMap<T> | undefined,
  locale: string,
  defaultLocale?: string
): T | undefined {
  if (!map || typeof map !== 'object') return undefined;

  const normalizedLocale = normalizeLocaleCode(locale);
  const normalizedDefault = normalizeLocaleCode(defaultLocale);

  if (normalizedLocale && map[normalizedLocale] !== undefined) return map[normalizedLocale];
  if (normalizedDefault && map[normalizedDefault] !== undefined) return map[normalizedDefault];

  const firstKey = Object.keys(map).find((key) => map[key] !== undefined);
  return firstKey ? map[firstKey] : undefined;
}

export function getLocalizedValueForLocale<T>(
  map: LocalizedValueMap<T> | undefined,
  locale: string
): T | undefined {
  if (!map || typeof map !== 'object') return undefined;

  const normalizedLocale = normalizeLocaleCode(locale);
  if (!normalizedLocale) return undefined;
  return map[normalizedLocale];
}

export function hasLocalizedValue<T>(
  map: LocalizedValueMap<T> | undefined,
  locale: string
): boolean {
  return getLocalizedValueForLocale(map, locale) !== undefined;
}

export function setLocalizedValue<T>(
  map: LocalizedValueMap<T> | undefined,
  locale: string,
  value: T
): LocalizedValueMap<T> {
  const normalizedLocale = normalizeLocaleCode(locale);
  return {
    ...(map || {}),
    [normalizedLocale]: value,
  };
}

export function isKnownLocale(locale: string, languagesData: LanguagesData): boolean {
  const normalizedLocale = normalizeLocaleCode(locale);
  return getEnabledLanguages(languagesData).some((language) => normalizeLocaleCode(language.code) === normalizedLocale);
}

export function isLocalizedMapValue(value: unknown, localeKeys: Set<string>): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((key) => localeKeys.has(normalizeLocaleCode(key)));
}

export function isSchemaPropLocalizable(def: Pick<PropDef, 'type' | 'localizable'> | undefined): boolean {
  if (!def) return false;
  if (def.localizable === true) return true;
  if (def.localizable === false) return false;
  return def.type === 'string' || def.type === 'text';
}

type AcceptLanguageEntry = {
  locale: string;
  q: number;
  index: number;
};

function parseAcceptLanguage(headerValue: string | null | undefined): AcceptLanguageEntry[] {
  const raw = String(headerValue || '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((part, index) => {
      const [localePart, ...params] = part.trim().split(';');
      const locale = normalizeLocaleCode(localePart);
      if (!locale || locale === '*') return null;

      const qParam = params
        .map((entry) => entry.trim())
        .find((entry) => entry.toLowerCase().startsWith('q='));
      const qValue = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const q = Number.isFinite(qValue) ? qValue : 1;
      if (q <= 0) return null;

      return {
        locale,
        q,
        index,
      } as AcceptLanguageEntry;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const byQ = (b as AcceptLanguageEntry).q - (a as AcceptLanguageEntry).q;
      if (byQ !== 0) return byQ;
      return (a as AcceptLanguageEntry).index - (b as AcceptLanguageEntry).index;
    }) as AcceptLanguageEntry[];
}

function resolveLocaleCandidate(
  requestedLocale: string,
  availableLocales: string[],
  localeSet: Set<string>
): string | null {
  if (localeSet.has(requestedLocale)) return requestedLocale;

  const requestedBase = requestedLocale.split('-')[0];
  const exactBase = availableLocales.find((locale) => locale === requestedBase);
  if (exactBase) return exactBase;

  const prefixedBase = availableLocales.find((locale) => locale.split('-')[0] === requestedBase);
  if (prefixedBase) return prefixedBase;

  return null;
}

export function resolvePreferredLocaleFromAcceptLanguage(
  headerValue: string | null | undefined,
  availableLocalesInput: string[],
  defaultLocaleInput: string
): string {
  const availableLocales = (availableLocalesInput || []).map((entry) => normalizeLocaleCode(entry)).filter(Boolean);
  const localeSet = new Set(availableLocales);
  const defaultLocale = normalizeLocaleCode(defaultLocaleInput);
  const safeDefault = localeSet.has(defaultLocale) ? defaultLocale : availableLocales[0] || defaultLocale || 'es';

  if (availableLocales.length === 0) return safeDefault;

  const entries = parseAcceptLanguage(headerValue);
  for (const entry of entries) {
    const candidate = resolveLocaleCandidate(entry.locale, availableLocales, localeSet);
    if (candidate) return candidate;
  }

  return safeDefault;
}

export function getLocaleFromCookiePreference(
  cookieValue: string | null | undefined,
  availableLocalesInput: string[]
): string | null {
  const availableLocales = (availableLocalesInput || []).map((entry) => normalizeLocaleCode(entry)).filter(Boolean);
  const localeSet = new Set(availableLocales);
  const locale = normalizeLocaleCode(cookieValue);
  if (!locale) return null;
  return localeSet.has(locale) ? locale : null;
}

export function hasSameOriginReferrer(
  requestUrl: URL,
  refererValue: string | null | undefined
): boolean {
  const raw = String(refererValue || '').trim();
  if (!raw) return false;

  try {
    const refererUrl = new URL(raw);
    return refererUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

type RootLocaleRedirectSource = 'cookie' | 'accept-language';

export type RootLocaleRedirectResolution = {
  locale: string;
  source: RootLocaleRedirectSource;
};

type ResolveRootLocaleRedirectInput = {
  requestUrl: URL;
  referer: string | null | undefined;
  cookieLocale: string | null | undefined;
  acceptLanguage: string | null | undefined;
  availableLocales: string[];
  defaultLocale: string;
  hasPublishedHome: (locale: string) => boolean;
};

export function resolveRootLocaleRedirect(
  input: ResolveRootLocaleRedirectInput
): RootLocaleRedirectResolution | null {
  if (input.requestUrl.pathname !== '/') return null;
  if (hasSameOriginReferrer(input.requestUrl, input.referer)) return null;

  const availableLocales = (input.availableLocales || []).map((entry) => normalizeLocaleCode(entry)).filter(Boolean);
  const defaultLocale = normalizeLocaleCode(input.defaultLocale);

  const cookieLocale = getLocaleFromCookiePreference(input.cookieLocale, availableLocales);
  if (cookieLocale === defaultLocale) return null;
  if (cookieLocale && cookieLocale !== defaultLocale && input.hasPublishedHome(cookieLocale)) {
    return {
      locale: cookieLocale,
      source: 'cookie',
    };
  }

  const preferredLocale = resolvePreferredLocaleFromAcceptLanguage(
    input.acceptLanguage,
    availableLocales,
    defaultLocale
  );

  if (preferredLocale && preferredLocale !== defaultLocale && input.hasPublishedHome(preferredLocale)) {
    return {
      locale: preferredLocale,
      source: 'accept-language',
    };
  }

  return null;
}
