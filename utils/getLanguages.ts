/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLocale, loadLanguages } from '../api/data.js';
import type { ContentLanguage } from '../types/index.js';

export type { ContentLanguage } from '../types/index.js';

export type GetLanguagesOptions = {
  enabledOnly?: boolean;
};

export type GetLanguagesResult = {
  languages: ContentLanguage[];
  defaultLocale: string;
};

/**
 * Returns content languages configured in the consumer project.
 * Default behavior only includes enabled languages.
 */
export async function getLanguages(options?: GetLanguagesOptions): Promise<GetLanguagesResult> {
  const data = await loadLanguages();
  const all = Array.isArray(data.languages) ? data.languages : [];
  const enabledOnly = options?.enabledOnly !== false;

  const languages = (enabledOnly ? all.filter((entry) => entry.enabled !== false) : all).map((entry) => ({ ...entry }));

  return {
    languages,
    defaultLocale: getDefaultLocale(data),
  };
}

