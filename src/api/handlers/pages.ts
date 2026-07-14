/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import {
  getDefaultLanguageCode,
  getLocalizedValue,
  normalizeLocaleCode,
  setLocalizedValue,
} from '../../utils/localization.js';
import { joinSlugSegments, slugToPath, splitSlugSegments } from '../../utils/slug.js';
import { getLanguageLocaleKeys } from '../../utils/language-locales.js';
import { mergeBlockPropsForLocale, projectBlockProps } from '../../utils/locale-projection.js';
import type {
  BlockInstance,
  LanguagesData,
  Page,
  PageLocaleView,
  PageStatus,
  SchemaMap,
  SeoData,
} from '../../types/index.js';
import * as data from '../data.js';
import { invalidatePageContentCache } from './cache-invalidation.js';
import { normalizeLocaleFromRequest, resolveLocaleFromBody } from './locale-resolution.js';
import { ensureValidBlocks, loadSchemaMap, schemaMapFailureResponse } from './schema-loading.js';
import { localizedJsonError, parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';

function normalizeSlugInput(rawSlug: unknown): string | string[] {
  if (Array.isArray(rawSlug)) {
    const parts = rawSlug
      .map(String)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return joinSlugSegments(parts);
  }

  const raw = String(rawSlug ?? '/').trim();
  if (!raw || raw === '/') return '/';

  const parts = splitSlugSegments(raw);
  return joinSlugSegments(parts);
}

function normalizeStatus(value: unknown): PageStatus {
  return value === 'published' || value === 'archived' || value === 'draft' ? value : 'draft';
}

function normalizePageSeo(input: unknown): SeoData {
  if (!input || typeof input !== 'object') return {};
  const seo = input as Partial<SeoData>;
  return {
    ...(typeof seo.title === 'string' && seo.title.trim() ? { title: seo.title.trim() } : {}),
    ...(typeof seo.description === 'string' && seo.description.trim()
      ? { description: seo.description.trim() }
      : {}),
    ...(typeof seo.canonical === 'string' && seo.canonical.trim()
      ? { canonical: seo.canonical.trim() }
      : {}),
    ...(typeof seo.image === 'string' && seo.image.trim() ? { image: seo.image.trim() } : {}),
    ...(seo.nofollow !== undefined ? { nofollow: Boolean(seo.nofollow) } : {}),
  };
}

function validateLocalePrefixConflict(
  slug: string | string[],
  locale: string,
  defaultLocale: string,
  languagesData: LanguagesData,
): { errorKey: string; params: Record<string, string> } | null {
  if (locale !== defaultLocale) return null;

  const segments = splitSlugSegments(slug);
  if (segments.length === 0) return null;

  const first = normalizeLocaleCode(segments[0]);
  if (!first) return null;

  const enabledLocales = languagesData.languages
    .filter((language) => language.enabled !== false)
    .map((language) => normalizeLocaleCode(language.code))
    .filter(Boolean);

  if (enabledLocales.includes(first) && first !== defaultLocale) {
    return { errorKey: 'errors.slugLocaleConflict', params: { locale: first } };
  }

  return null;
}

function hasDuplicateSlug(
  pages: Page[],
  id: string | null,
  locale: string,
  defaultLocale: string,
  slug: string | string[],
): boolean {
  const nextPath = slugToPath(slug);

  return pages.some((entry) => {
    if (id && entry.id === id) return false;
    const currentPath = slugToPath(data.getPageSlug(entry, locale, defaultLocale));
    return currentPath === nextPath;
  });
}

function localizeSeoPayload(
  current: Page['seo'] | undefined,
  locale: string,
  payloadSeo: SeoData,
): Page['seo'] {
  const next = { ...(current || {}) };

  if (payloadSeo.title !== undefined)
    next.title = setLocalizedValue(next.title, locale, payloadSeo.title);
  if (payloadSeo.description !== undefined)
    next.description = setLocalizedValue(next.description, locale, payloadSeo.description);
  if (payloadSeo.canonical !== undefined)
    next.canonical = setLocalizedValue(next.canonical, locale, payloadSeo.canonical);
  if (payloadSeo.image !== undefined)
    next.image = setLocalizedValue(next.image, locale, payloadSeo.image);
  if (payloadSeo.nofollow !== undefined)
    next.nofollow = setLocalizedValue(next.nofollow, locale, Boolean(payloadSeo.nofollow));

  return next;
}

function projectPageForLocale(
  page: Page,
  locale: string,
  defaultLocale: string,
  schemaMap: SchemaMap | null,
  localeKeys: Set<string>,
): PageLocaleView {
  const view = data.getPageLocaleView(page, locale, defaultLocale);
  return {
    ...view,
    blocks: (page.blocks || []).map((block) => ({
      type: block.type,
      props: projectBlockProps(block, schemaMap, locale, localeKeys),
    })),
  };
}

export async function handleGetPages(request: Request): Promise<Response> {
  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  if (!schemaResult.ok) return schemaMapFailureResponse(request);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = normalizeLocaleFromRequest(request, languagesData);
  const localeKeys = getLanguageLocaleKeys(languagesData);

  const pages = pagesData.pages.map((page) =>
    projectPageForLocale(page, locale, defaultLocale, schemaResult.schemaMap, localeKeys),
  );
  return Response.json({ pages, locale, defaultLocale });
}

export async function handleGetBlockSchemas(): Promise<Response> {
  const result = await loadSchemaMap();
  if (!result.ok) return schemaMapFailureResponse();

  return Response.json(result.schemaMap);
}

export async function handlePostPages(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const blocksError = await ensureValidBlocks(body.blocks, request);
  if (blocksError) return blocksError;

  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  // ensureValidBlocks above already fails on an unresolvable map, but only when the payload
  // carries blocks. This guard is what makes the merge below unreachable without a schema —
  // mergeBlockPropsForLocale with a null map would flatten a LocalizedValueMap into a scalar.
  if (!schemaResult.ok) return schemaMapFailureResponse(request);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = resolveLocaleFromBody(body, request, languagesData);

  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled';
  const slug = normalizeSlugInput(body.slug);
  const status = normalizeStatus(body.status);
  const indexable = body.indexable !== undefined ? Boolean(body.indexable) : true;
  const seo = normalizePageSeo(body.seo);
  const blocks = Array.isArray(body.blocks) ? (body.blocks as BlockInstance[]) : [];

  if (hasDuplicateSlug(pagesData.pages, null, locale, defaultLocale, slug)) {
    return localizedJsonError(request, 'errors.duplicateSlug');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError)
    return localizedJsonError(request, conflictError.errorKey, 400, conflictError.params);

  const localeKeys = getLanguageLocaleKeys(languagesData);
  const now = new Date().toISOString();

  const page: Page = {
    id: data.generateId(),
    title: setLocalizedValue({}, locale, title),
    slug: setLocalizedValue({}, locale, slug),
    status: setLocalizedValue({}, locale, status),
    indexable: setLocalizedValue({}, locale, indexable),
    seo: localizeSeoPayload(undefined, locale, seo),
    blocks: blocks.map((block) =>
      mergeBlockPropsForLocale(undefined, block, schemaResult.schemaMap, locale, localeKeys),
    ),
    publishedAt: setLocalizedValue({}, locale, status === 'published' ? now : null),
    createdAt: now,
    updatedAt: now,
  };

  pagesData.pages.push(page);
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, locale, defaultLocale, page);

  return Response.json(
    projectPageForLocale(page, locale, defaultLocale, schemaResult.schemaMap, localeKeys),
  );
}

export async function handlePutPage(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const blocksError = await ensureValidBlocks(body.blocks, request);
  if (blocksError) return blocksError;

  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  // Before the 404, deliberately. A "page not found" from a server that cannot resolve schemas
  // is a confident wrong answer: it names the wrong culprit and sends the owner looking at their
  // content instead of their deployment. Report what is actually broken (ADR-0025). Same
  // ordering, same reason, as handleDeleteLanguage.
  if (!schemaResult.ok) return schemaMapFailureResponse(request);

  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = resolveLocaleFromBody(body, request, languagesData);

  const existing = pagesData.pages[index];
  const existingView = data.getPageLocaleView(existing, locale, defaultLocale);

  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : existingView.title || 'Untitled';
  const slug = body.slug !== undefined ? normalizeSlugInput(body.slug) : existingView.slug;
  const status = body.status !== undefined ? normalizeStatus(body.status) : existingView.status;
  const indexable =
    body.indexable !== undefined ? Boolean(body.indexable) : existingView.indexable !== false;
  const seo = body.seo !== undefined ? normalizePageSeo(body.seo) : existingView.seo || {};

  if (hasDuplicateSlug(pagesData.pages, id, locale, defaultLocale, slug)) {
    return localizedJsonError(request, 'errors.duplicateSlug');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError)
    return localizedJsonError(request, conflictError.errorKey, 400, conflictError.params);

  const localeKeys = getLanguageLocaleKeys(languagesData);
  const now = new Date().toISOString();

  const nextBlocks = Array.isArray(body.blocks)
    ? (body.blocks as BlockInstance[]).map((block, blockIndex) =>
        mergeBlockPropsForLocale(
          existing.blocks?.[blockIndex],
          block,
          schemaResult.schemaMap,
          locale,
          localeKeys,
        ),
      )
    : existing.blocks;

  const nextPage: Page = {
    ...existing,
    title: setLocalizedValue(existing.title, locale, title),
    slug: setLocalizedValue(existing.slug, locale, slug),
    status: setLocalizedValue(existing.status, locale, status),
    indexable: setLocalizedValue(existing.indexable, locale, indexable),
    seo: localizeSeoPayload(existing.seo, locale, seo),
    blocks: nextBlocks,
    publishedAt: setLocalizedValue(
      existing.publishedAt,
      locale,
      status === 'published'
        ? getLocalizedValue(existing.publishedAt, locale, defaultLocale) || now
        : getLocalizedValue(existing.publishedAt, locale, defaultLocale) || null,
    ),
    updatedAt: now,
  };

  pagesData.pages[index] = nextPage;
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, locale, defaultLocale, nextPage, existing);

  return Response.json(
    projectPageForLocale(nextPage, locale, defaultLocale, schemaResult.schemaMap, localeKeys),
  );
}

export async function handleDeletePage(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const [pagesData, languagesData] = await Promise.all([data.loadPages(), data.loadLanguages()]);

  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const locale = normalizeLocaleFromRequest(request, languagesData);
  const defaultLocale = getDefaultLanguageCode(languagesData);

  const deletedPage = pagesData.pages[index];
  pagesData.pages.splice(index, 1);
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, locale, defaultLocale, null, deletedPage);
  return new Response(null, { status: 204 });
}
