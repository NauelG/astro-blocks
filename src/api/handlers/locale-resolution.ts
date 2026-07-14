/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLanguageCode, normalizeLocaleCode } from '../../utils/localization.js';
import type { LanguagesData } from '../../types/index.js';
import * as data from '../data.js';

export function normalizeLocaleFromRequest(request: Request, languagesData: LanguagesData): string {
  const url = new URL(request.url);
  const queryLocale = normalizeLocaleCode(url.searchParams.get('locale'));
  const headerLocale = normalizeLocaleCode(request.headers.get('x-cms-locale'));
  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = queryLocale || headerLocale || defaultLocale;
  return data.ensureLocaleAvailable(locale, languagesData);
}

export function resolveLocaleFromBody(
  body: Record<string, unknown>,
  request: Request,
  languagesData: LanguagesData,
): string {
  const bodyLocale = normalizeLocaleCode(typeof body.locale === 'string' ? body.locale : '');
  return data.ensureLocaleAvailable(
    bodyLocale || normalizeLocaleFromRequest(request, languagesData),
    languagesData,
  );
}
