/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * SERVER-ONLY — do NOT import in client bundles.
 *
 * Locale resolution for the admin UI locale (cms-ui-locale cookie).
 * HARD WALL: this module is completely independent of the content-locale axis
 * (getActiveContentLocale, normalizeLocaleFromRequest, x-cms-locale).
 */

import { SUPPORTED_UI_LOCALES } from './types.js';
import type { UiLocale } from './types.js';

/** Cookie name that carries the user's preferred UI locale. */
export const UI_LOCALE_COOKIE = 'cms-ui-locale' as const;

/**
 * Shape accepted by resolveUiLocale.
 * Using a plain-object API makes it easy to test without constructing a full
 * Request object while still being usable from Astro SSR handlers.
 */
export interface LocaleResolutionInput {
  /** Raw value of the HTTP Cookie header (optional). */
  cookie?: string | null;
  /** Raw value of the HTTP Accept-Language header (optional). */
  acceptLanguage?: string | null;
}

/**
 * Parse an Accept-Language header value and return the first supported
 * locale, using primary-subtag matching (e.g. "es-MX" → "es").
 *
 * Returns null when no supported locale can be matched.
 *
 * @param header - Value of the HTTP Accept-Language header, or null/undefined.
 */
export function parseAcceptLanguage(header: string | null | undefined): UiLocale | null {
  if (!header) return null;

  // Split on comma, parse q-values, sort by preference
  const parts = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: (tag ?? '').trim(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of parts) {
    if (!tag) continue;

    // Try exact match first
    const exact = tag.toLowerCase();
    if ((SUPPORTED_UI_LOCALES as readonly string[]).includes(exact)) {
      return exact as UiLocale;
    }

    // Try primary-subtag match (e.g. "es-MX" → "es")
    const primary = exact.split('-')[0];
    if (primary && (SUPPORTED_UI_LOCALES as readonly string[]).includes(primary)) {
      return primary as UiLocale;
    }
  }

  return null;
}

/**
 * Read the UI locale from a Cookie header string.
 *
 * Parses a standard HTTP Cookie header value and extracts the `cms-ui-locale`
 * cookie, returning it only when the value is a supported locale.
 *
 * Returns null when the cookie is absent, empty, or not a supported locale.
 *
 * @param cookieHeader - Value of the HTTP Cookie header, or null/undefined.
 */
export function readUiLocaleCookie(cookieHeader: string | null | undefined): UiLocale | null {
  if (!cookieHeader) return null;

  // Parse as a full Cookie header
  for (const pair of cookieHeader.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;

    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();

    if (name === UI_LOCALE_COOKIE) {
      const candidate = decodeURIComponent(value).toLowerCase();
      if ((SUPPORTED_UI_LOCALES as readonly string[]).includes(candidate)) {
        return candidate as UiLocale;
      }
      // Cookie present but value not supported → continue scanning remaining pairs
      continue;
    }
  }

  return null;
}

/**
 * Resolve the UI locale from a locale resolution input using the precedence chain:
 *   1. cms-ui-locale cookie (from Cookie header)
 *   2. Accept-Language header (primary-subtag matching)
 *   3. 'en' (default fallback)
 *
 * Can be used from Astro SSR pages by passing the request headers:
 *   resolveUiLocale({
 *     cookie: Astro.request.headers.get('cookie'),
 *     acceptLanguage: Astro.request.headers.get('accept-language'),
 *   })
 *
 * @param input - An object with optional cookie and acceptLanguage fields.
 */
export function resolveUiLocale(input: LocaleResolutionInput): UiLocale {
  const { cookie, acceptLanguage } = input;

  const fromCookie = readUiLocaleCookie(cookie);
  if (fromCookie) return fromCookie;

  const fromHeader = parseAcceptLanguage(acceptLanguage);
  if (fromHeader) return fromHeader;

  return 'en';
}
