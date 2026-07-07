/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Catalog, TParams, TranslateFn, UiLocale } from './types.js';
import { catalogs } from './catalogs.js';

/**
 * Translate a key using the given catalog.
 *
 * Fallback chain (REQ-5.3):
 *   1. active catalog value
 *   2. fallbackCatalog value (defaults to the en catalog)
 *   3. key itself as a visible sentinel
 *
 * @param catalog        - Active locale's catalog.
 * @param key            - Dot-namespaced translation key.
 * @param params         - Optional interpolation parameters.
 * @param fallbackCatalog - Optional explicit fallback catalog (defaults to en).
 */
export function t(
  catalog: Catalog,
  key: string,
  params?: TParams,
  fallbackCatalog?: Catalog,
): string {
  const enFallback: Catalog = catalogs.en;
  const raw = catalog[key] ?? (fallbackCatalog ?? enFallback)[key] ?? key;

  if (!params) return raw;

  // Replace {name} placeholders with provided param values.
  return raw.replace(/\{(\w+)\}/g, (match, paramKey) => {
    const val = params[paramKey];
    return val !== undefined ? String(val) : match;
  });
}

/**
 * Factory: bind a locale and return a bound translate function.
 * Internally resolves the catalog from the registry and pre-binds the en
 * catalog as the fallback so callers never have to pass it explicitly.
 *
 * @param locale - A supported UI locale (e.g. 'en' | 'es').
 */
export function createT(locale: UiLocale): TranslateFn {
  const catalog: Catalog = catalogs[locale];
  const fallback: Catalog | undefined = locale === 'en' ? undefined : catalogs.en;

  return function boundT(key: string, params?: TParams): string {
    return t(catalog, key, params, fallback);
  };
}
