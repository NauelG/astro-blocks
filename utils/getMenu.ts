/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLocale, getMenuItemsStrict, loadLanguages, loadMenus } from '../api/data.js';
import { normalizeLocaleCode } from './localization.js';
import type { MenuItem } from '../types/index.js';

export type { MenuItem } from '../types/index.js';

export type GetMenuLocaleOptions = {
  locale?: string;
};

/**
 * Returns menu items for the given selector and locale.
 * Locale can be passed as a string or as { locale }.
 * Items may include nested `children` for dropdown/submenus.
 */
export async function getMenu(key: string, localeOrOptions?: string | GetMenuLocaleOptions): Promise<MenuItem[]> {
  const [menusData, languagesData] = await Promise.all([loadMenus(), loadLanguages()]);
  const menus = menusData.menus ?? [];
  const menu = menus.find((entry) => entry.selector === key);
  if (!menu) return [];

  const requestedLocale =
    typeof localeOrOptions === 'string' ? localeOrOptions : localeOrOptions && typeof localeOrOptions.locale === 'string' ? localeOrOptions.locale : '';

  const locale = normalizeLocaleCode(requestedLocale) || getDefaultLocale(languagesData);

  return getMenuItemsStrict(menu, locale);
}
