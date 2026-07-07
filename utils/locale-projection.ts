/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { BlockInstance, Page, SchemaMap } from '../types/index.js';
import { toImageValue } from './image-value.js';
import {
  isLocalizedMapValue,
  isSchemaPropLocalizable,
  normalizeLocaleCode,
} from './localization.js';

export function projectBlockProps(
  block: BlockInstance,
  schemaMap: SchemaMap | null,
  locale: string,
  localeKeys: Set<string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const schemaItems = schemaMap?.[block.type]?.items || {};
  const normalizedLocale = normalizeLocaleCode(locale);

  for (const [propName, rawValue] of Object.entries(block.props || {})) {
    const def = schemaItems[propName];
    const localizable = isSchemaPropLocalizable(def);

    if (localizable && isLocalizedMapValue(rawValue, localeKeys)) {
      const projected = rawValue[normalizedLocale];
      output[propName] = def?.type === 'image' ? toImageValue(projected) : projected;
      continue;
    }

    if (isLocalizedMapValue(rawValue, localeKeys)) {
      const projected = rawValue[normalizedLocale];
      output[propName] = def?.type === 'image' ? toImageValue(projected) : projected;
      continue;
    }

    // Coerce legacy string image values to ImageFieldValue at the consumer API boundary
    output[propName] = def?.type === 'image' ? toImageValue(rawValue) : rawValue;
  }

  return output;
}

export function mergeBlockPropsForLocale(
  existingBlock: BlockInstance | undefined,
  incomingBlock: BlockInstance,
  schemaMap: SchemaMap | null,
  locale: string,
  localeKeys: Set<string>,
): BlockInstance {
  const schemaItems = schemaMap?.[incomingBlock.type]?.items || {};
  const output: Record<string, unknown> = {};
  const incomingProps = incomingBlock.props || {};

  for (const [propName, value] of Object.entries(incomingProps)) {
    const def = schemaItems[propName];
    const shouldLocalize = isSchemaPropLocalizable(def);

    if (shouldLocalize) {
      const existingValue = existingBlock?.props?.[propName];
      const localized = isLocalizedMapValue(existingValue, localeKeys) ? { ...existingValue } : {};

      if (isLocalizedMapValue(value, localeKeys)) {
        output[propName] = { ...localized, ...value };
      } else {
        localized[locale] = value;
        output[propName] = localized;
      }
      continue;
    }

    output[propName] = value;
  }

  for (const [propName, existingValue] of Object.entries(existingBlock?.props || {})) {
    if (Object.prototype.hasOwnProperty.call(output, propName)) continue;
    output[propName] = existingValue;
  }

  return {
    type: incomingBlock.type,
    props: output,
  };
}

export function removeLocaleFromLocalizedMap<T>(
  map: Record<string, T> | undefined,
  locale: string,
): Record<string, T> | undefined {
  if (!map || typeof map !== 'object') return map;
  const next = { ...map };
  delete next[locale];
  return Object.keys(next).length > 0 ? next : undefined;
}

export function removeLocaleFromPage(
  page: Page,
  locale: string,
  schemaMap: SchemaMap | null,
  localeKeys: Set<string>,
): Page | null {
  const next: Page = {
    ...page,
    title: removeLocaleFromLocalizedMap(page.title, locale) || {},
    slug: removeLocaleFromLocalizedMap(page.slug, locale) || {},
    status: removeLocaleFromLocalizedMap(page.status, locale) || {},
    indexable: removeLocaleFromLocalizedMap(page.indexable, locale),
    publishedAt: removeLocaleFromLocalizedMap(page.publishedAt, locale),
    seo: {
      title: removeLocaleFromLocalizedMap(page.seo?.title, locale),
      description: removeLocaleFromLocalizedMap(page.seo?.description, locale),
      canonical: removeLocaleFromLocalizedMap(page.seo?.canonical, locale),
      image: removeLocaleFromLocalizedMap(page.seo?.image, locale),
      nofollow: removeLocaleFromLocalizedMap(page.seo?.nofollow, locale),
    },
    blocks: (page.blocks || []).map((block) => {
      const schemaItems = schemaMap?.[block.type]?.items || {};
      const props: Record<string, unknown> = {};

      for (const [propName, value] of Object.entries(block.props || {})) {
        const def = schemaItems[propName];
        const shouldLocalize =
          isSchemaPropLocalizable(def) || isLocalizedMapValue(value, localeKeys);

        if (!shouldLocalize) {
          props[propName] = value;
          continue;
        }

        if (!isLocalizedMapValue(value, localeKeys)) {
          props[propName] = value;
          continue;
        }

        const localized = { ...value };
        delete localized[locale];
        if (Object.keys(localized).length > 0) props[propName] = localized;
      }

      return {
        type: block.type,
        props,
      };
    }),
  };

  const remainingLocales = Object.keys(next.status || {});
  if (remainingLocales.length === 0) return null;
  return next;
}
