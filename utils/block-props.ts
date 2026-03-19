/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { SchemaMap } from '../types/index.js';
import { getLocalizedValue, isLocalizedMapValue, isSchemaPropLocalizable } from './localization.js';

export function localizeBlockPropsForRender(
  props: Record<string, unknown>,
  blockType: string,
  schemaMap: SchemaMap | null | undefined,
  locale: string,
  defaultLocale: string,
  localeKeys: Set<string>
): Record<string, unknown> {
  const schemaItems = schemaMap?.[blockType]?.items || {};
  const output: Record<string, unknown> = {};

  for (const [propName, value] of Object.entries(props || {})) {
    const def = schemaItems[propName];
    const localizable = isSchemaPropLocalizable(def);

    if ((localizable || !def) && isLocalizedMapValue(value, localeKeys)) {
      output[propName] = getLocalizedValue(value, locale, defaultLocale);
      continue;
    }

    output[propName] = value;
  }

  return output;
}
