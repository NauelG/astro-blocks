/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { loadMenus } from '../api/data.mjs';

/**
 * Returns menu items for the given selector. Use in layout or components (server-side).
 * Items may include nested `children` for dropdown/submenus.
 * @param {string} key - Menu selector (e.g. 'main', 'footer')
 * @returns {{ name: string, path: string, children?: Array<{ name: string, path: string, children?: Array<...> }> }[]}
 */
export async function getMenu(key) {
  const data = await loadMenus();
  const menus = data.menus ?? [];
  const menu = menus.find((m) => m.selector === key);
  if (!menu || !Array.isArray(menu.items)) return [];
  return menu.items;
}
