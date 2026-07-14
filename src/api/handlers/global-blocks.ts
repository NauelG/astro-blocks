/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getDefaultLanguageCode, isSchemaPropLocalizable } from '../../utils/localization.js';
import { getLanguageLocaleKeys } from '../../utils/language-locales.js';
import { mergeBlockPropsForLocale, projectBlockProps } from '../../utils/locale-projection.js';
import { validateBlockPropsAgainstSchema } from '../../utils/block-validation.js';
import type { BlockInstance, GlobalBlockRuntimeEntry } from '../../types/index.js';
import * as data from '../data.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';
import { normalizeLocaleFromRequest, resolveLocaleFromBody } from './locale-resolution.js';
import { loadSchemaMap } from './schema-loading.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';

export async function handleGetGlobalBlocks(
  registry: GlobalBlockRuntimeEntry[],
  request: Request,
): Promise<Response> {
  const [globalBlocksData, languagesData, schemaResult] = await Promise.all([
    data.loadGlobalBlocks(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = normalizeLocaleFromRequest(request, languagesData);
  const localeKeys = getLanguageLocaleKeys(languagesData);
  const schemaMap = schemaResult.schemaMap || null;

  const result: Record<string, { props: Record<string, unknown>; updatedAt?: string }> = {};
  for (const decl of registry) {
    const entry = globalBlocksData.globalBlocks[decl.slug];
    const rawProps = entry?.props ?? {};
    const projected = projectBlockProps(
      { type: decl.schemaName, props: rawProps } as BlockInstance,
      schemaMap,
      locale,
      localeKeys,
    );
    result[decl.slug] = {
      props: projected,
      ...(entry?.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
    };
  }

  return Response.json({ globalBlocks: result, locale, defaultLocale });
}

export async function handleGetGlobalBlock(
  slug: string,
  registry: GlobalBlockRuntimeEntry[],
  request: Request,
): Promise<Response> {
  const decl = registry.find((entry) => entry.slug === slug);
  if (!decl) return jsonError(`Global block slug "${slug}" not found`, 404);

  const [globalBlocksData, languagesData, schemaResult] = await Promise.all([
    data.loadGlobalBlocks(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = normalizeLocaleFromRequest(request, languagesData);
  const localeKeys = getLanguageLocaleKeys(languagesData);
  const schemaMap = schemaResult.schemaMap || null;

  const entry = globalBlocksData.globalBlocks[slug];
  const rawProps = entry?.props ?? {};
  const projected = projectBlockProps(
    { type: decl.schemaName, props: rawProps } as BlockInstance,
    schemaMap,
    locale,
    localeKeys,
  );

  return Response.json({
    globalBlocks: {
      [slug]: {
        props: projected,
        ...(entry?.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
      },
    },
    locale,
    defaultLocale,
  });
}

export async function handlePutGlobalBlock(
  slug: string,
  request: Request,
  context: HandlerContext = {},
  registry: GlobalBlockRuntimeEntry[],
): Promise<Response> {
  const decl = registry.find((entry) => entry.slug === slug);
  if (!decl) return localizedJsonError(request, 'errors.globalBlockNotFound', 404, { slug });

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  if (!Object.prototype.hasOwnProperty.call(body, 'props'))
    return localizedJsonError(request, 'errors.propsRequired');
  if (typeof body.props !== 'object' || body.props === null || Array.isArray(body.props)) {
    return localizedJsonError(request, 'errors.propsMustBePlainObject');
  }

  const incomingProps = body.props as Record<string, unknown>;

  const [globalBlocksData, languagesData, schemaResult] = await Promise.all([
    data.loadGlobalBlocks(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);
  if (schemaResult.error) return localizedJsonError(request, 'errors.schemaLoadFailed', 500);

  const locale = resolveLocaleFromBody(body, request, languagesData);
  const localeKeys = getLanguageLocaleKeys(languagesData);
  const schemaMap = schemaResult.schemaMap || null;
  const schema = schemaMap?.[decl.schemaName];

  // Validate incoming scalar props against the schema.
  if (schema) {
    const schemaItems = schema.items ?? {};
    const propsForValidation: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incomingProps)) {
      const def = schemaItems[key];
      // Guard against legacy clients still posting LocalizedValueMap shape directly.
      if (
        def &&
        isSchemaPropLocalizable(def) &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const localeValues = Object.values(value as Record<string, unknown>);
        propsForValidation[key] = localeValues.length > 0 ? localeValues[0] : '';
      } else {
        propsForValidation[key] = value;
      }
    }
    const issue = validateBlockPropsAgainstSchema(
      schema.name || decl.schemaName,
      0,
      schemaItems,
      propsForValidation,
    );
    if (issue) return localizedJsonError(request, issue.messageKey, 400, issue.params);
  }

  // Merge incoming (scalar-per-locale) props into existing props so other locales are preserved.
  const existingEntry = globalBlocksData.globalBlocks[slug];
  const merged = mergeBlockPropsForLocale(
    existingEntry
      ? ({ type: decl.schemaName, props: existingEntry.props ?? {} } as BlockInstance)
      : undefined,
    { type: decl.schemaName, props: incomingProps } as BlockInstance,
    schemaMap,
    locale,
    localeKeys,
  );

  await data.saveGlobalBlock(slug, merged.props);
  await invalidateGlobalContentCache(context.cache);

  const updated = await data.loadGlobalBlocks();
  const entry = updated.globalBlocks[slug];
  const defaultLocale = getDefaultLanguageCode(languagesData);
  const projected = projectBlockProps(
    { type: decl.schemaName, props: entry?.props ?? {} } as BlockInstance,
    schemaMap,
    locale,
    localeKeys,
  );

  return Response.json({
    globalBlocks: {
      [slug]: {
        props: projected,
        ...(entry?.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
      },
    },
    locale,
    defaultLocale,
  });
}
