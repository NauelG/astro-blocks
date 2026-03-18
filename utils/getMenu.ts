/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { loadMenus } from '../api/data.js';
import type { MenuItem } from '../types/index.js';

export type { MenuItem } from '../types/index.js';

/**
 * Returns menu items for the given selector. Use in layout or components (server-side).
 * Items may include nested `children` for dropdown/submenus.
 */
export async function getMenu(key: string): Promise<MenuItem[]> {
  const data = await loadMenus();
  const menus = data.menus ?? [];
  const menu = menus.find((entry) => entry.selector === key);
  if (!menu || !Array.isArray(menu.items)) return [];
  return menu.items;
}
