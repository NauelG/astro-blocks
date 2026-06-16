/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Catalog, UiLocale } from './types.js';
import { en } from './en.js';
import { es } from './es.js';

/**
 * Registry of all supported UI locale catalogs.
 * Add new locales here and in SUPPORTED_UI_LOCALES (types.ts).
 */
export const catalogs = {
  en,
  es,
} satisfies Record<UiLocale, Catalog>;
