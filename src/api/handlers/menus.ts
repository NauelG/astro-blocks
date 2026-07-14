/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLanguageCode } from '../../utils/localization.js';
import type { Menu, MenuItem } from '../../types/index.js';
import * as data from '../data.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';
import { normalizeLocaleFromRequest, resolveLocaleFromBody } from './locale-resolution.js';

/** Returns a catalog error key (not a user-facing string) or null. */
function validateMenuItemsPaths(items: unknown): string | null {
  if (!Array.isArray(items)) return 'errors.menuItemsArray';

  for (const item of items as MenuItem[]) {
    if (!item || typeof item !== 'object') return 'errors.invalidMenuItem';
    if (typeof item.path !== 'string' || item.path.trim() === '') {
      return 'errors.menuPathRequired';
    }
    if (Array.isArray(item.children)) {
      const childError = validateMenuItemsPaths(item.children);
      if (childError) return childError;
    }
  }

  return null;
}

/** Returns a catalog error key (not a user-facing string) or null. */
function validateMenuSelector(
  menusData: { menus: Menu[] },
  selector: string,
  excludeMenuId: string | null,
): string | null {
  if (!selector) return 'errors.menuSelectorRequired';
  if (!data.MENU_SELECTOR_REGEX.test(selector)) {
    return 'errors.invalidMenuSelector';
  }

  const taken = menusData.menus.some(
    (menu) => menu.selector === selector && menu.id !== excludeMenuId,
  );
  if (taken) return 'errors.menuSelectorExists';

  return null;
}

function normalizeMenuPayload(body: Record<string, unknown>) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    selector: typeof body.selector === 'string' ? body.selector.trim() : '',
    items: Array.isArray(body.items) ? (body.items as MenuItem[]) : [],
  };
}

export async function handleGetMenus(request: Request): Promise<Response> {
  const [menusData, languagesData] = await Promise.all([data.loadMenus(), data.loadLanguages()]);
  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = normalizeLocaleFromRequest(request, languagesData);

  return Response.json({
    menus: menusData.menus.map((menu) => data.getMenuLocaleView(menu, locale, defaultLocale)),
    locale,
    defaultLocale,
  });
}

export async function handlePostMenus(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const payload = normalizeMenuPayload(body);
  const [menusData, languagesData] = await Promise.all([data.loadMenus(), data.loadLanguages()]);
  const locale = resolveLocaleFromBody(body, request, languagesData);

  const selectorError = validateMenuSelector(menusData, payload.selector, null);
  if (selectorError) return localizedJsonError(request, selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return localizedJsonError(request, pathError);

  const newMenu: Menu = {
    id: data.generateId(),
    name: payload.name || 'Menu',
    selector: payload.selector || 'menu',
    items: {
      [locale]: payload.items,
    },
  };

  menusData.menus.push(newMenu);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  return Response.json(data.getMenuLocaleView(newMenu, locale, defaultLocale));
}

export async function handlePutMenu(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const payload = normalizeMenuPayload(body);
  const [menusData, languagesData] = await Promise.all([data.loadMenus(), data.loadLanguages()]);
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const locale = resolveLocaleFromBody(body, request, languagesData);

  const selectorError = validateMenuSelector(menusData, payload.selector, id);
  if (selectorError) return localizedJsonError(request, selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return localizedJsonError(request, pathError);

  const current = menusData.menus[index];
  const updated: Menu = {
    ...current,
    name: payload.name || current.name || 'Menu',
    selector: payload.selector || current.selector || 'menu',
    items: {
      ...(current.items || {}),
      [locale]: payload.items,
    },
  };

  menusData.menus[index] = updated;
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  return Response.json(data.getMenuLocaleView(updated, locale, defaultLocale));
}

export async function handleDeleteMenu(
  id: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const menusData = await data.loadMenus();
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  menusData.menus.splice(index, 1);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}
