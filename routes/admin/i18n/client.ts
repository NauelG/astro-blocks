/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * CLIENT-ONLY — runs exclusively in the browser.
 * Do NOT import in Astro SSR pages or API routes.
 *
 * Provides client-side access to the active UI locale (cms-ui-locale cookie)
 * and a bound translate function for use in inline <script> blocks.
 *
 * HARD WALL: this module is completely separate from the content-locale axis
 * (getActiveContentLocale, x-cms-locale sessionStorage key, etc.).
 */

import type { Catalog, TranslateFn, UiLocale } from './types.js';
import { SUPPORTED_UI_LOCALES } from './types.js';
import { catalogs } from './catalogs.js';
import { createT } from './t.js';

/** Cookie name — mirrors the server-side constant in resolve.ts. */
const UI_LOCALE_COOKIE = 'cms-ui-locale' as const;

/** Default fallback locale. */
const DEFAULT_UI_LOCALE: UiLocale = 'en';

/**
 * Read the UI locale from the browser cookie store.
 * Returns the cookie value when it is a supported locale, otherwise null.
 */
export function getUiLocale(): UiLocale {
  if (typeof document === 'undefined') return DEFAULT_UI_LOCALE;

  for (const pair of document.cookie.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;

    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();

    if (name === UI_LOCALE_COOKIE) {
      const candidate = decodeURIComponent(value).toLowerCase();
      if ((SUPPORTED_UI_LOCALES as readonly string[]).includes(candidate)) {
        return candidate as UiLocale;
      }
      break;
    }
  }

  return DEFAULT_UI_LOCALE;
}

/**
 * Persist the chosen UI locale in the browser cookie store.
 * Propagates the change to the window bridge so any registered listener
 * (e.g. the topbar locale selector) can react immediately.
 *
 * @param next - A supported UiLocale value.
 */
export function setUiLocale(next: UiLocale): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${UI_LOCALE_COOKIE}=${encodeURIComponent(next)};path=/;max-age=31536000`;

  // Propagate via window bridge so layout scripts can react
  if (typeof window !== 'undefined') {
    (window as CmsI18nWindow).setCmsUiLocale?.(next);
  }
}

/**
 * Return the catalog for the currently active UI locale.
 */
export function getCatalog(): Catalog {
  return catalogs[getUiLocale()];
}

/**
 * Client-side bound translate function.
 * Resolves the active locale at call time and looks up the key.
 *
 * Usage inside a <script> block:
 *   import { ct } from '../../i18n/client.js';
 *   document.querySelector('#label').textContent = ct('nav.dashboard');
 */
export function ct(key: string, params?: Record<string, string | number>): string {
  const tFn: TranslateFn = createT(getUiLocale());
  return tFn(key, params);
}

/** Minimal window extension for the UI locale bridge. */
type CmsI18nWindow = Window & typeof globalThis & {
  getCmsUiLocale?: () => UiLocale;
  setCmsUiLocale?: (locale: UiLocale) => void;
};
