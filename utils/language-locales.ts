/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { LanguagesData } from '../types/index.js';
import { normalizeLocaleCode } from './localization.js';

export function normalizeLanguageCode(code: string): string {
  return normalizeLocaleCode(code);
}

export function getLanguageLocaleKeys(languagesData: LanguagesData): Set<string> {
  return new Set(
    (languagesData.languages || [])
      .map((language) => normalizeLanguageCode(language.code))
      .filter(Boolean),
  );
}
