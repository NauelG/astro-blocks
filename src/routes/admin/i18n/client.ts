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
 * Read the active UI locale.
 *
 * Resolution order (per Design Decision #3 — avoids flash and drift):
 *   1. window.getCmsUiLocale() — SSR-injected via define:vars, authoritative
 *   2. Cookie store — fallback for scripts that load before the bridge is ready
 *   3. DEFAULT_UI_LOCALE ('en')
 *
 * The window bridge is the primary source because it reflects the locale the
 * SSR page was rendered in. The cookie is a secondary fallback so editors that
 * import this module before the bridge is ready still get the right locale.
 */
export function getUiLocale(): UiLocale {
  if (typeof window === 'undefined') return DEFAULT_UI_LOCALE;

  // 1. Read from SSR-injected window bridge (authoritative)
  const fromBridge = (window as CmsI18nWindow).getCmsUiLocale?.();
  if (fromBridge && (SUPPORTED_UI_LOCALES as readonly string[]).includes(fromBridge)) {
    return fromBridge;
  }

  // 2. Fall back to cookie store
  if (typeof document !== 'undefined') {
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
      }
    }
  }

  return DEFAULT_UI_LOCALE;
}

/**
 * Persist the chosen UI locale in the browser cookie store.
 *
 * Cookie attributes per design:
 *   - Path=/cms — scoped to the admin area
 *   - SameSite=Lax — CSRF mitigation without breaking nav flows
 *   - Max-Age=31536000 — persists across browser sessions (1 year)
 *   - NOT HttpOnly — SSR reads it server-side, client must also write it
 *
 * Also mirrors the choice to localStorage (best-effort, ignored in private mode).
 * Propagates the change to the window bridge so any registered listener
 * (e.g. the topbar locale selector) can react immediately, then reloads the
 * page so SSR re-resolves and re-renders every string in the new language.
 *
 * @param next - A supported UiLocale value.
 */
export function setUiLocale(next: UiLocale): void {
  if (typeof document === 'undefined') return;

  // Write cookie with correct attributes (server-readable, not HttpOnly)
  document.cookie = `${UI_LOCALE_COOKIE}=${encodeURIComponent(next)};path=/cms;max-age=31536000;samesite=Lax`;

  // Mirror to localStorage (best-effort; ignored in private browsing mode)
  try {
    localStorage.setItem(UI_LOCALE_COOKIE, next);
  } catch (_) {
    // localStorage unavailable — cookie alone is sufficient (REQ-4.5)
  }

  // Propagate via window bridge so layout scripts can react
  if (typeof window !== 'undefined') {
    (window as CmsI18nWindow).setCmsUiLocale?.(next);
  }

  // Full reload: SSR re-resolves the locale from the new cookie and
  // re-renders all strings server-side — no flash, no stale paint (Decision #1)
  location.reload();
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
  const value = tFn(key, params);
  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (viteEnv?.DEV === true && value === key) {
    console.warn(`[astro-blocks] i18n key not found: "${key}"`);
  }
  return value;
}

/** Minimal window extension for the UI locale bridge. */
type CmsI18nWindow = Window &
  typeof globalThis & {
    /** Set by the layout via define:vars — returns the SSR-resolved locale. */
    getCmsUiLocale?: () => UiLocale;
    /** Called by setUiLocale to propagate changes to the window bridge. */
    setCmsUiLocale?: (locale: UiLocale) => void;
  };
