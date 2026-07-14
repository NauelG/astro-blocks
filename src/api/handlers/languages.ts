/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { normalizeLanguageCode, getLanguageLocaleKeys } from '../../utils/language-locales.js';
import { removeLocaleFromPage } from '../../utils/locale-projection.js';
import type { ContentLanguage, Menu, Page } from '../../types/index.js';
import * as data from '../data.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';
import { loadSchemaMap } from './schema-loading.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';

function ensureEnabledDefaultLanguage(
  languages: ContentLanguage[],
  preferredCode?: string,
  fallbackToFirst = false,
): ContentLanguage[] {
  if (!Array.isArray(languages) || languages.length === 0) return languages;

  let defaultCode = normalizeLanguageCode(preferredCode || '');
  if (!defaultCode) {
    const currentDefault = languages.find(
      (language) => language.isDefault && language.enabled !== false,
    );
    defaultCode = normalizeLanguageCode(currentDefault?.code || '');
  }
  if (!defaultCode) {
    const firstEnabled = languages.find((language) => language.enabled !== false);
    defaultCode = normalizeLanguageCode(firstEnabled?.code || '');
  }
  if (!defaultCode && fallbackToFirst) {
    defaultCode = normalizeLanguageCode(languages[0]?.code || '');
  }

  return languages.map((language) => ({
    ...language,
    isDefault: defaultCode ? normalizeLanguageCode(language.code) === defaultCode : false,
  }));
}

export async function handleGetLanguages(): Promise<Response> {
  return Response.json(await data.loadLanguages());
}

export async function handlePostLanguages(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const languagesData = await data.loadLanguages();
  const code = normalizeLanguageCode(typeof body.code === 'string' ? body.code : '');
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : code;
  const enabled = body.enabled !== false;
  const isDefault = body.isDefault === true;

  if (!code) return localizedJsonError(request, 'errors.languageCodeRequired');
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)) {
    return localizedJsonError(request, 'errors.invalidLanguageCode');
  }

  if (languagesData.languages.some((language) => normalizeLanguageCode(language.code) === code)) {
    return localizedJsonError(request, 'errors.languageCodeExists');
  }

  const newLanguage: ContentLanguage = { code, label, enabled, isDefault };
  languagesData.languages.push(newLanguage);

  if (isDefault) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages, code);
  }

  if (
    !languagesData.languages.some((language) => language.isDefault && language.enabled !== false)
  ) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages);
  }

  await data.saveLanguages(languagesData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(newLanguage);
}

export async function handlePutLanguage(
  code: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const normalizedCode = normalizeLanguageCode(code);
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const languagesData = await data.loadLanguages();
  const index = languagesData.languages.findIndex(
    (language) => normalizeLanguageCode(language.code) === normalizedCode,
  );
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const current = languagesData.languages[index];
  const next: ContentLanguage = {
    ...current,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : current.label,
    enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
    isDefault: body.isDefault === undefined ? current.isDefault : Boolean(body.isDefault),
  };

  languagesData.languages[index] = next;

  if (next.isDefault) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages, next.code);
  }

  if (!languagesData.languages.some((language) => language.enabled !== false)) {
    return localizedJsonError(request, 'errors.mustHaveEnabledLanguage');
  }

  if (
    !languagesData.languages.some((language) => language.isDefault && language.enabled !== false)
  ) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages);
  }

  await data.saveLanguages(languagesData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(languagesData.languages[index]);
}

export async function handleDeleteLanguage(
  code: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const normalizedCode = normalizeLanguageCode(code);

  const [languagesData, pagesData, menusData, schemaResult] = await Promise.all([
    data.loadLanguages(),
    data.loadPages(),
    data.loadMenus(),
    loadSchemaMap(),
  ]);

  const languageIndex = languagesData.languages.findIndex(
    (language) => normalizeLanguageCode(language.code) === normalizedCode,
  );
  if (languageIndex === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);
  if (languagesData.languages.length <= 1) {
    return request
      ? localizedJsonError(request, 'errors.cannotDeleteLastLanguage')
      : jsonError('Cannot delete the last language.');
  }

  const localeKeys = getLanguageLocaleKeys(languagesData);

  const affectedPages = pagesData.pages.filter((page) => {
    return Object.hasOwn(page.status || {}, normalizedCode);
  }).length;

  const affectedMenus = menusData.menus.filter((menu) => {
    return Object.hasOwn(menu.items || {}, normalizedCode);
  }).length;

  pagesData.pages = pagesData.pages
    .map((page) =>
      removeLocaleFromPage(page, normalizedCode, schemaResult.schemaMap || null, localeKeys),
    )
    .filter(Boolean) as Page[];

  menusData.menus = menusData.menus
    .map((menu) => {
      const items = { ...(menu.items || {}) };
      delete items[normalizedCode];
      if (Object.keys(items).length === 0) return null;
      return { ...menu, items };
    })
    .filter(Boolean) as Menu[];

  languagesData.languages.splice(languageIndex, 1);

  if (
    !languagesData.languages.some((language) => language.isDefault && language.enabled !== false)
  ) {
    languagesData.languages = ensureEnabledDefaultLanguage(
      languagesData.languages,
      undefined,
      true,
    );
  }

  await Promise.all([
    data.savePages(pagesData),
    data.saveMenus(menusData),
    data.saveLanguages(languagesData),
  ]);

  await invalidateGlobalContentCache(context.cache);

  return Response.json({
    ok: true,
    deletedLocale: normalizedCode,
    affectedPages,
    affectedMenus,
  });
}
