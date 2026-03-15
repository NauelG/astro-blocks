import { loadMenus } from '../api/data.mjs';

/**
 * Returns menu items for the given key. Use in layout or components (server-side).
 * @param {string} key - Menu key (e.g. 'main', 'footer')
 * @returns {{ name: string, path: string }[]}
 */
export async function getMenu(key) {
  const menus = await loadMenus();
  const items = menus[key];
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    name: item.name ?? '',
    path: item.path ?? '',
  }));
}
