/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { APIContext } from 'astro';
import { SignJWT, jwtVerify } from 'jose';
import { imageSize } from 'image-size';
import { getGlobalCachePaths, getGlobalCacheTags, getPageCachePath, getPageCacheTags } from '../utils/cache.js';
import { validateBlocks } from '../utils/blocks.js';
import {
  getDefaultLanguageCode,
  getLocalizedValue,
  isLocalizedMapValue,
  isSchemaPropLocalizable,
  normalizeLocaleCode,
  setLocalizedValue,
} from '../utils/localization.js';
import { joinSlugSegments, slugToPath, splitSlugSegments } from '../utils/slug.js';
import { getProjectRoot, getUploadsDir, resolveUploadPath } from '../utils/paths.js';
import { generateAndPersistVariants } from '../utils/variant-generator.js';
import { DEFAULT_ALLOWED_FILE_TYPES, MIME_TO_EXT as FILE_TYPES_MIME_TO_EXT, RASTER_MIME } from '../utils/file-types.js';
import { evaluateUpload } from '../utils/upload-gate.js';
import {
  hasDuplicateRedirectFrom,
  normalizeRedirectPath,
  normalizeRedirectStatusCode,
  validateRedirectPathInput,
} from '../utils/redirects.js';
import { validateBlockPropsAgainstSchema } from '../utils/block-validation.js';
import { toImageValue } from '../utils/image-value.js';
import type {
  AuthResult,
  AuthUser,
  BlockInstance,
  ConfigEntry,
  ContentLanguage,
  GlobalBlockRuntimeEntry,
  LanguagesData,
  MediaEntry,
  Menu,
  MenuItem,
  Page,
  PageLocaleView,
  PageStatus,
  PagesData,
  RedirectRule,
  SchemaMap,
  SeoData,
  Site,
  User,
} from '../types/index.js';
import * as data from './data.js';
import { buildExportStream, runImportPipeline } from './backup.js';
import { UNIT_TO_DATA_FILES } from './manifest.js';
import type { ExportUnit } from './manifest.js';
import { readCeilingEnvVars } from './import-utils.js';
import { resolveUiLocale } from '../routes/admin/i18n/resolve.js';
import { catalogs } from '../routes/admin/i18n/catalogs.js';
import { t as translateFn } from '../routes/admin/i18n/t.js';

/** Resolve the UI locale from the incoming API request (cookie > Accept-Language > 'en'). */
function resolveRequestUiLocale(request: Request): import('../routes/admin/i18n/types.js').UiLocale {
  return resolveUiLocale({
    cookie: request.headers.get('cookie'),
    acceptLanguage: request.headers.get('accept-language'),
  });
}

/** Return a localized JSON error response. The wire shape { error: string } is preserved. */
export function localizedJsonError(
  request: Request,
  key: string,
  status = 400,
  params?: Record<string, string | number>,
  extra?: Record<string, unknown>
): Response {
  const locale = resolveRequestUiLocale(request);
  const catalog = catalogs[locale];
  const message = translateFn(catalog, key, params);
  return jsonError(message, status, extra);
}

const JWT_SECRET = new TextEncoder().encode(process.env.CMS_JWT_SECRET || 'cms-jwt-secret-change-me');
const JWT_EXPIRY = '7d';
type AstroCache = APIContext['cache'];
type HandlerContext = { cache?: AstroCache | null };
const CONFIG_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_.-]*$/;

// Media upload constants

/**
 * Memoized parsed allowlist. Populated on first call to getAllowedFileTypes().
 * Exported resetAllowedFileTypesCache() clears it for test isolation.
 */
let _allowedFileTypesCache: Set<string> | null = null;

/**
 * Returns the resolved allowlist as a Set<string>.
 *
 * Source priority (ADR-1):
 *   1. import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES (injected by vite.define as JSON string)
 *   2. DEFAULT_ALLOWED_FILE_TYPES fallback
 *
 * Result is memoized; call resetAllowedFileTypesCache() between test runs.
 */
function getAllowedFileTypes(): Set<string> {
  if (_allowedFileTypesCache !== null) return _allowedFileTypesCache;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: string = ((import.meta as any).env as Record<string, unknown> | undefined)?.ASTRO_BLOCKS_ALLOWED_FILE_TYPES as string ?? '';
  let parsed: string[] | null = null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const decoded = JSON.parse(raw);
      if (Array.isArray(decoded) && decoded.every((v) => typeof v === 'string' && v.trim().length > 0)) {
        parsed = [...new Set(decoded.map((v: string) => v.toLowerCase().trim()))];
      }
    } catch {
      // Malformed env — fall through to default
    }
  }

  _allowedFileTypesCache = new Set(parsed ?? DEFAULT_ALLOWED_FILE_TYPES);
  return _allowedFileTypesCache;
}

/**
 * Test hook: clears the memoized allowlist so the next call to getAllowedFileTypes()
 * re-reads from the environment. Required when tests change env vars between calls.
 */
export function resetAllowedFileTypesCache(): void {
  _allowedFileTypesCache = null;
}

/** Single source of truth: extension is always derived from the validated MIME type, never from the user filename. */
const MIME_TO_EXT: Record<string, string> = FILE_TYPES_MIME_TO_EXT;
const MAX_UPLOAD_BYTES = (() => {
  const envVal = process.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 5 * 1024 * 1024; // 5 MB default
})();

function jsonError(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeSlugInput(rawSlug: unknown): string | string[] {
  if (Array.isArray(rawSlug)) {
    const parts = rawSlug.map(String).map((entry) => entry.trim()).filter(Boolean);
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
    ...(typeof seo.description === 'string' && seo.description.trim() ? { description: seo.description.trim() } : {}),
    ...(typeof seo.canonical === 'string' && seo.canonical.trim() ? { canonical: seo.canonical.trim() } : {}),
    ...(typeof seo.image === 'string' && seo.image.trim() ? { image: seo.image.trim() } : {}),
    ...(seo.nofollow !== undefined ? { nofollow: Boolean(seo.nofollow) } : {}),
  };
}

function normalizeLocaleFromRequest(request: Request, languagesData: LanguagesData): string {
  const url = new URL(request.url);
  const queryLocale = normalizeLocaleCode(url.searchParams.get('locale'));
  const headerLocale = normalizeLocaleCode(request.headers.get('x-cms-locale'));
  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = queryLocale || headerLocale || defaultLocale;
  return data.ensureLocaleAvailable(locale, languagesData);
}

function resolveLocaleFromBody(
  body: Record<string, unknown>,
  request: Request,
  languagesData: LanguagesData
): string {
  const bodyLocale = normalizeLocaleCode(typeof body.locale === 'string' ? body.locale : '');
  return data.ensureLocaleAvailable(bodyLocale || normalizeLocaleFromRequest(request, languagesData), languagesData);
}

function normalizeLanguageCode(code: string): string {
  return normalizeLocaleCode(code);
}

function getLanguageLocaleKeys(languagesData: LanguagesData): Set<string> {
  return new Set(
    (languagesData.languages || [])
      .map((language) => normalizeLanguageCode(language.code))
      .filter(Boolean)
  );
}

function ensureEnabledDefaultLanguage(
  languages: ContentLanguage[],
  preferredCode?: string,
  fallbackToFirst = false
): ContentLanguage[] {
  if (!Array.isArray(languages) || languages.length === 0) return languages;

  let defaultCode = normalizeLanguageCode(preferredCode || '');
  if (!defaultCode) {
    const currentDefault = languages.find((language) => language.isDefault && language.enabled !== false);
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

async function invalidateCachePath(cache: AstroCache | null | undefined, pathname: string): Promise<boolean> {
  if (!cache?.enabled) return false;

  try {
    await cache.invalidate({ path: pathname });
    return true;
  } catch (error) {
    console.warn(`[astro-blocks] Failed to invalidate cache path "${pathname}":`, error);
    return false;
  }
}

async function invalidateCacheTags(cache: AstroCache | null | undefined, tags: string[]): Promise<boolean> {
  if (!cache?.enabled || tags.length === 0) return false;

  try {
    await cache.invalidate({ tags });
    return true;
  } catch (error) {
    console.warn('[astro-blocks] Failed to invalidate cache tags:', tags, error);
    return false;
  }
}

async function invalidateGlobalContentCache(cache: AstroCache | null | undefined): Promise<void> {
  await invalidateCacheTags(cache, getGlobalCacheTags());
  for (const pathname of getGlobalCachePaths()) {
    await invalidateCachePath(cache, pathname);
  }
}

async function invalidatePageContentCache(
  cache: AstroCache | null | undefined,
  locale: string,
  defaultLocale: string,
  currentPage?: Pick<Page, 'id' | 'slug'> | null,
  previousPage?: Pick<Page, 'id' | 'slug'> | null
): Promise<void> {
  const tags = new Set<string>(getGlobalCacheTags());
  const paths = new Set<string>(getGlobalCachePaths());

  for (const page of [currentPage, previousPage]) {
    if (!page) continue;
    paths.add(getPageCachePath(page, locale, defaultLocale));
    for (const tag of getPageCacheTags(page, locale, defaultLocale)) tags.add(tag);
  }

  for (const pathname of paths) {
    await invalidateCachePath(cache, pathname);
  }

  await invalidateCacheTags(cache, Array.from(tags));
}

async function parseJsonBody<T>(request: Request): Promise<{ data: T | null; error: Response | null }> {
  try {
    return { data: (await request.json()) as T, error: null };
  } catch {
    return { data: null, error: localizedJsonError(request, 'errors.invalidBody') };
  }
}

function scryptAsync(password: string, salt: crypto.BinaryLike, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

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
function validateMenuSelector(menusData: { menus: Menu[] }, selector: string, excludeMenuId: string | null): string | null {
  if (!selector) return 'errors.menuSelectorRequired';
  if (!data.MENU_SELECTOR_REGEX.test(selector)) {
    return 'errors.invalidMenuSelector';
  }

  const taken = menusData.menus.some((menu) => menu.selector === selector && menu.id !== excludeMenuId);
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

function normalizeConfigKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function configKeyIdentity(key: string): string {
  return key.trim().toLowerCase();
}

function hasDuplicateConfigKey(configs: ConfigEntry[], key: string, excludeId?: string): boolean {
  const target = configKeyIdentity(key);
  if (!target) return false;
  return configs.some((entry) => {
    if (excludeId && entry.id === excludeId) return false;
    return configKeyIdentity(entry.key) === target;
  });
}

function normalizeConfigPayload(body: Record<string, unknown>, current?: ConfigEntry): ConfigEntry | { errorKey: string } {
  const key = normalizeConfigKey(body.key !== undefined ? body.key : current?.key);
  if (!key) return { errorKey: 'errors.configKeyRequired' };
  if (!CONFIG_KEY_REGEX.test(key)) {
    return { errorKey: 'errors.invalidConfigKey' };
  }

  const valueInput = body.value !== undefined ? body.value : current?.value;
  const value = typeof valueInput === 'string' ? valueInput : valueInput === undefined || valueInput === null ? '' : String(valueInput);
  const descriptionInput = body.description !== undefined ? body.description : current?.description;
  const description = typeof descriptionInput === 'string' ? descriptionInput.trim() : '';

  return {
    id: current?.id || '',
    key,
    value,
    ...(description ? { description } : {}),
    createdAt: current?.createdAt,
    updatedAt: current?.updatedAt,
  };
}

function normalizeRedirectPayload(
  body: Record<string, unknown>,
  current?: RedirectRule
): RedirectRule | { errorKey: string; fieldKey?: string } {
  const fromInput = body.from !== undefined ? body.from : current?.from;
  const toInput = body.to !== undefined ? body.to : current?.to;

  const fromError = validateRedirectPathInput(fromInput, 'from');
  if (fromError) return fromError;

  const toError = validateRedirectPathInput(toInput, 'to');
  if (toError) return toError;

  const from = normalizeRedirectPath(String(fromInput || '/'));
  const to = normalizeRedirectPath(String(toInput || '/'));

  if (from === to) return { errorKey: 'errors.redirectSameFromTo' };

  return {
    id: current?.id || '',
    from,
    to,
    statusCode: normalizeRedirectStatusCode(body.statusCode !== undefined ? body.statusCode : current?.statusCode),
    enabled: body.enabled === undefined ? current?.enabled !== false : Boolean(body.enabled),
    createdAt: current?.createdAt,
    updatedAt: current?.updatedAt,
  };
}

function validateLocalePrefixConflict(
  slug: string | string[],
  locale: string,
  defaultLocale: string,
  languagesData: LanguagesData
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

function hasDuplicateSlug(pages: Page[], id: string | null, locale: string, defaultLocale: string, slug: string | string[]): boolean {
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
  payloadSeo: SeoData
): Page['seo'] {
  const next = { ...(current || {}) };

  if (payloadSeo.title !== undefined) next.title = setLocalizedValue(next.title, locale, payloadSeo.title);
  if (payloadSeo.description !== undefined) next.description = setLocalizedValue(next.description, locale, payloadSeo.description);
  if (payloadSeo.canonical !== undefined) next.canonical = setLocalizedValue(next.canonical, locale, payloadSeo.canonical);
  if (payloadSeo.image !== undefined) next.image = setLocalizedValue(next.image, locale, payloadSeo.image);
  if (payloadSeo.nofollow !== undefined) next.nofollow = setLocalizedValue(next.nofollow, locale, Boolean(payloadSeo.nofollow));

  return next;
}

function projectBlockProps(
  block: BlockInstance,
  schemaMap: SchemaMap | null,
  locale: string,
  localeKeys: Set<string>
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

function mergeBlockPropsForLocale(
  existingBlock: BlockInstance | undefined,
  incomingBlock: BlockInstance,
  schemaMap: SchemaMap | null,
  locale: string,
  localeKeys: Set<string>
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

function projectPageForLocale(
  page: Page,
  locale: string,
  defaultLocale: string,
  schemaMap: SchemaMap | null,
  localeKeys: Set<string>
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

function removeLocaleFromLocalizedMap<T>(map: Record<string, T> | undefined, locale: string): Record<string, T> | undefined {
  if (!map || typeof map !== 'object') return map;
  const next = { ...map };
  delete next[locale];
  return Object.keys(next).length > 0 ? next : undefined;
}

function removeLocaleFromPage(page: Page, locale: string, schemaMap: SchemaMap | null, localeKeys: Set<string>): Page | null {
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
        const shouldLocalize = isSchemaPropLocalizable(def) || isLocalizedMapValue(value, localeKeys);

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

async function loadSchemaMap(): Promise<{ schemaMap?: SchemaMap; error?: string; missing?: string[] }> {
  const projectRoot = getProjectRoot();
  const schemaMapPath = path.join(projectRoot, '.astro-blocks', 'schema-map.mjs');

  try {
    const schemaMapUrl = pathToFileURL(schemaMapPath).href;
    const mod = (await import(/* @vite-ignore */ schemaMapUrl)) as { schemaMap?: SchemaMap };
    const schemaMap = mod.schemaMap || {};
    const missing = Object.entries(schemaMap)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);

    if (missing.length > 0) return { error: 'Missing block schema', missing };

    return { schemaMap };
  } catch {
    return { error: 'Failed to load block schemas', missing: [] };
  }
}

async function ensureValidBlocks(blocks: unknown, request?: Request): Promise<Response | null> {
  if (blocks === undefined) return null;

  if (!Array.isArray(blocks) || blocks.length > 0) {
    const result = await loadSchemaMap();
    if (result.error) {
      if (request) return localizedJsonError(request, 'errors.loadBlockSchemasFailed', 500, undefined, { missing: result.missing || [] });
      return jsonError(result.error, 500, { missing: result.missing || [] });
    }

    const validation = validateBlocks(result.schemaMap || {}, blocks);
    if (validation) {
      if (request && validation.messageKey) {
        return localizedJsonError(request, validation.messageKey, 400, validation.params);
      }
      return jsonError(validation.message);
    }
  }

  return null;
}

export function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return scryptAsync(password, salt, 64).then((hash) => `${salt.toString('base64')}:${hash.toString('base64')}`);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !password) return false;

  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(derived, expected);
}

async function createToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export async function getAuth(request: Request): Promise<AuthResult | null> {
  const token =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim() ||
    request.headers.get('x-cms-token') ||
    '';

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const id = payload.sub;
    const email = payload.email;
    const role = payload.role;
    if (!id || !email || !role) return null;

    return { user: { id: String(id), email: String(email), role: String(role) } };
  } catch {
    return null;
  }
}

export function requireOwner(user?: AuthUser | null, request?: Request): Response | null {
  if (!user || user.role !== 'owner') {
    return request ? localizedJsonError(request, 'errors.forbidden', 403) : jsonError('Forbidden', 403);
  }
  return null;
}

export async function handleLogin(request: Request): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return localizedJsonError(request, 'errors.emailPasswordRequired');

  const usersData = await data.loadUsers();
  const users = usersData.users || [];

  if (users.length === 0) {
    const id = data.generateId();
    const createdAt = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const newUser: User = { id, email, passwordHash, role: 'owner', createdAt };
    users.push(newUser);
    await data.saveUsers({ users });
    const token = await createToken(newUser);
    return Response.json({ token, user: { id, email, role: 'owner' } });
  }

  const user = users.find((entry) => entry.email === email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return localizedJsonError(request, 'errors.invalidCredentials', 401);
  }

  const token = await createToken(user);
  return Response.json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

export async function handleAuthMe(user?: AuthUser | null, request?: Request): Promise<Response> {
  if (!user) {
    return request ? localizedJsonError(request, 'errors.unauthorized', 401) : jsonError('Unauthorized', 401);
  }
  return Response.json({ user });
}

export async function handleAuthStatus(): Promise<Response> {
  const [usersData, site] = await Promise.all([data.loadUsers(), data.loadSite()]);
  return Response.json({
    hasUsers: (usersData.users || []).length > 0,
    logo: site.logo || '',
    siteName: site.siteName || 'CMS',
  });
}

export async function handleGetUsers(user?: AuthUser | null): Promise<Response> {
  const forbidden = requireOwner(user);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const list = (usersData.users || []).map(({ id, email, role, createdAt }) => ({ id, email, role, createdAt }));
  return Response.json({ users: list });
}

export async function handlePostUsers(request: Request, authUser?: AuthUser | null): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'owner' ? 'owner' : 'user';
  if (!email || !password) return localizedJsonError(request, 'errors.emailPasswordRequired');

  const usersData = await data.loadUsers();
  if (usersData.users.some((user) => user.email === email)) return localizedJsonError(request, 'errors.emailExists');

  const createdAt = new Date().toISOString();
  const newUser: User = {
    id: data.generateId(),
    email,
    passwordHash: await hashPassword(password),
    role,
    createdAt,
  };

  usersData.users.push(newUser);
  await data.saveUsers(usersData);
  return Response.json({ id: newUser.id, email, role, createdAt });
}

export async function handlePutUser(id: string, request: Request, authUser?: AuthUser | null): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;

  if (body.role !== undefined) {
    const newRole = body.role === 'owner' ? 'owner' : 'user';
    if (target.role === 'owner' && newRole === 'user' && ownerCount <= 1) {
      return localizedJsonError(request, 'errors.cannotRemoveLastOwner', 400);
    }
    usersData.users[index] = { ...target, role: newRole };
  }

  if (typeof body.password === 'string' && body.password.length > 0) {
    usersData.users[index] = { ...usersData.users[index], passwordHash: await hashPassword(body.password) };
  }

  await data.saveUsers(usersData);
  const updated = usersData.users[index];
  return Response.json({ id: updated.id, email: updated.email, role: updated.role, createdAt: updated.createdAt });
}

export async function handleDeleteUser(id: string, authUser?: AuthUser | null, request?: Request): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1) return request ? localizedJsonError(request, 'errors.notFound', 404) : jsonError('Not found', 404);

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) {
    return request
      ? localizedJsonError(request, 'errors.cannotDeleteLastOwner', 400)
      : jsonError('Cannot delete the only owner.', 400);
  }

  usersData.users.splice(index, 1);
  await data.saveUsers(usersData);
  return new Response(null, { status: 204 });
}

export async function handleGetLanguages(): Promise<Response> {
  return Response.json(await data.loadLanguages());
}

export async function handlePostLanguages(request: Request, context: HandlerContext = {}): Promise<Response> {
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

  if (!languagesData.languages.some((language) => language.isDefault && language.enabled !== false)) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages);
  }

  await data.saveLanguages(languagesData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(newLanguage);
}

export async function handlePutLanguage(code: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const normalizedCode = normalizeLanguageCode(code);
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const languagesData = await data.loadLanguages();
  const index = languagesData.languages.findIndex((language) => normalizeLanguageCode(language.code) === normalizedCode);
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

  if (!languagesData.languages.some((language) => language.isDefault && language.enabled !== false)) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages);
  }

  await data.saveLanguages(languagesData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(languagesData.languages[index]);
}

export async function handleDeleteLanguage(code: string, context: HandlerContext = {}, request?: Request): Promise<Response> {
  const normalizedCode = normalizeLanguageCode(code);

  const [languagesData, pagesData, menusData, schemaResult] = await Promise.all([
    data.loadLanguages(),
    data.loadPages(),
    data.loadMenus(),
    loadSchemaMap(),
  ]);

  const languageIndex = languagesData.languages.findIndex((language) => normalizeLanguageCode(language.code) === normalizedCode);
  if (languageIndex === -1) return request ? localizedJsonError(request, 'errors.notFound', 404) : jsonError('Not found', 404);
  if (languagesData.languages.length <= 1) {
    return request
      ? localizedJsonError(request, 'errors.cannotDeleteLastLanguage')
      : jsonError('Cannot delete the last language.');
  }

  const localeKeys = getLanguageLocaleKeys(languagesData);

  const affectedPages = pagesData.pages.filter((page) => {
    return Object.prototype.hasOwnProperty.call(page.status || {}, normalizedCode);
  }).length;

  const affectedMenus = menusData.menus.filter((menu) => {
    return Object.prototype.hasOwnProperty.call(menu.items || {}, normalizedCode);
  }).length;

  pagesData.pages = pagesData.pages
    .map((page) => removeLocaleFromPage(page, normalizedCode, schemaResult.schemaMap || null, localeKeys))
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

  if (!languagesData.languages.some((language) => language.isDefault && language.enabled !== false)) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages, undefined, true);
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

export async function handleGetPages(request: Request): Promise<Response> {
  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = normalizeLocaleFromRequest(request, languagesData);
  const localeKeys = getLanguageLocaleKeys(languagesData);

  const pages = pagesData.pages.map((page) => projectPageForLocale(page, locale, defaultLocale, schemaResult.schemaMap || null, localeKeys));
  return Response.json({ pages, locale, defaultLocale });
}

export async function handleGetBlockSchemas(): Promise<Response> {
  const result = await loadSchemaMap();
  if (result.error) return jsonError(result.error, 500, { missing: result.missing || [] });

  return Response.json(result.schemaMap || {});
}

export async function handlePostPages(request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const blocksError = await ensureValidBlocks(body.blocks, request);
  if (blocksError) return blocksError;

  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = resolveLocaleFromBody(body, request, languagesData);

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled';
  const slug = normalizeSlugInput(body.slug);
  const status = normalizeStatus(body.status);
  const indexable = body.indexable !== undefined ? Boolean(body.indexable) : true;
  const seo = normalizePageSeo(body.seo);
  const blocks = Array.isArray(body.blocks) ? (body.blocks as BlockInstance[]) : [];

  if (hasDuplicateSlug(pagesData.pages, null, locale, defaultLocale, slug)) {
    return localizedJsonError(request, 'errors.duplicateSlug');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError) return localizedJsonError(request, conflictError.errorKey, 400, conflictError.params);

  const localeKeys = getLanguageLocaleKeys(languagesData);
  const now = new Date().toISOString();

  const page: Page = {
    id: data.generateId(),
    title: setLocalizedValue({}, locale, title),
    slug: setLocalizedValue({}, locale, slug),
    status: setLocalizedValue({}, locale, status),
    indexable: setLocalizedValue({}, locale, indexable),
    seo: localizeSeoPayload(undefined, locale, seo),
    blocks: blocks.map((block) => mergeBlockPropsForLocale(undefined, block, schemaResult.schemaMap || null, locale, localeKeys)),
    publishedAt: setLocalizedValue({}, locale, status === 'published' ? now : null),
    createdAt: now,
    updatedAt: now,
  };

  pagesData.pages.push(page);
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, locale, defaultLocale, page);

  return Response.json(projectPageForLocale(page, locale, defaultLocale, schemaResult.schemaMap || null, localeKeys));
}

export async function handlePutPage(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const blocksError = await ensureValidBlocks(body.blocks, request);
  if (blocksError) return blocksError;

  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const defaultLocale = getDefaultLanguageCode(languagesData);
  const locale = resolveLocaleFromBody(body, request, languagesData);

  const existing = pagesData.pages[index];
  const existingView = data.getPageLocaleView(existing, locale, defaultLocale);

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existingView.title || 'Untitled';
  const slug = body.slug !== undefined ? normalizeSlugInput(body.slug) : existingView.slug;
  const status = body.status !== undefined ? normalizeStatus(body.status) : existingView.status;
  const indexable = body.indexable !== undefined ? Boolean(body.indexable) : existingView.indexable !== false;
  const seo = body.seo !== undefined ? normalizePageSeo(body.seo) : existingView.seo || {};

  if (hasDuplicateSlug(pagesData.pages, id, locale, defaultLocale, slug)) {
    return localizedJsonError(request, 'errors.duplicateSlug');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError) return localizedJsonError(request, conflictError.errorKey, 400, conflictError.params);

  const localeKeys = getLanguageLocaleKeys(languagesData);
  const now = new Date().toISOString();

  const nextBlocks =
    Array.isArray(body.blocks)
      ? (body.blocks as BlockInstance[]).map((block, blockIndex) =>
          mergeBlockPropsForLocale(existing.blocks?.[blockIndex], block, schemaResult.schemaMap || null, locale, localeKeys)
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
    publishedAt: setLocalizedValue(existing.publishedAt, locale, status === 'published' ? getLocalizedValue(existing.publishedAt, locale, defaultLocale) || now : getLocalizedValue(existing.publishedAt, locale, defaultLocale) || null),
    updatedAt: now,
  };

  pagesData.pages[index] = nextPage;
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, locale, defaultLocale, nextPage, existing);

  return Response.json(projectPageForLocale(nextPage, locale, defaultLocale, schemaResult.schemaMap || null, localeKeys));
}

export async function handleDeletePage(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
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

export async function handleGetSite(): Promise<Response> {
  return Response.json(await data.loadSite());
}

export async function handlePutSite(request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Partial<Site>>(request);
  if (error || !body) return error as Response;

  const existing = await data.loadSite();
  const site = { ...existing, ...body };
  await data.saveSite(site);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(site);
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

export async function handlePostMenus(request: Request, context: HandlerContext = {}): Promise<Response> {
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

export async function handlePutMenu(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
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

export async function handleDeleteMenu(id: string, context: HandlerContext = {}, request?: Request): Promise<Response> {
  const menusData = await data.loadMenus();
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1) return request ? localizedJsonError(request, 'errors.notFound', 404) : jsonError('Not found', 404);

  menusData.menus.splice(index, 1);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleGetRedirects(): Promise<Response> {
  const redirectsData = await data.loadRedirects();
  return Response.json(redirectsData);
}

export async function handlePostRedirects(request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const redirectsData = await data.loadRedirects();
  const parsed = normalizeRedirectPayload(body);
  if ('errorKey' in parsed) {
    const locale = resolveRequestUiLocale(request);
    const catalog = catalogs[locale];
    const fieldLabel = parsed.fieldKey ? translateFn(catalog, parsed.fieldKey) : '';
    return localizedJsonError(request, parsed.errorKey, 400, fieldLabel ? { field: fieldLabel } : undefined);
  }

  if (hasDuplicateRedirectFrom(redirectsData.redirects, parsed.from)) {
    return localizedJsonError(request, 'errors.redirectFromExists');
  }

  const now = new Date().toISOString();
  const redirect: RedirectRule = {
    ...parsed,
    id: data.generateId(),
    createdAt: now,
    updatedAt: now,
  };

  redirectsData.redirects.push(redirect);
  await data.saveRedirects(redirectsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(redirect);
}

export async function handlePutRedirect(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const redirectsData = await data.loadRedirects();
  const index = redirectsData.redirects.findIndex((entry) => entry.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const current = redirectsData.redirects[index];
  const parsed = normalizeRedirectPayload(body, current);
  if ('errorKey' in parsed) {
    const locale = resolveRequestUiLocale(request);
    const catalog = catalogs[locale];
    const fieldLabel = parsed.fieldKey ? translateFn(catalog, parsed.fieldKey) : '';
    return localizedJsonError(request, parsed.errorKey, 400, fieldLabel ? { field: fieldLabel } : undefined);
  }

  if (hasDuplicateRedirectFrom(redirectsData.redirects, parsed.from, id)) {
    return localizedJsonError(request, 'errors.redirectFromExists');
  }

  const updated: RedirectRule = {
    ...current,
    ...parsed,
    id: current.id,
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  redirectsData.redirects[index] = updated;
  await data.saveRedirects(redirectsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(updated);
}

export async function handleDeleteRedirect(id: string, context: HandlerContext = {}, request?: Request): Promise<Response> {
  const redirectsData = await data.loadRedirects();
  const index = redirectsData.redirects.findIndex((entry) => entry.id === id);
  if (index === -1) return request ? localizedJsonError(request, 'errors.notFound', 404) : jsonError('Not found', 404);

  redirectsData.redirects.splice(index, 1);
  await data.saveRedirects(redirectsData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleGetConfigs(): Promise<Response> {
  const configsData = await data.loadConfigs();
  return Response.json(configsData);
}

export async function handlePostConfigs(request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const configsData = await data.loadConfigs();
  const parsed = normalizeConfigPayload(body);
  if ('errorKey' in parsed) return localizedJsonError(request, parsed.errorKey);

  if (hasDuplicateConfigKey(configsData.configs, parsed.key)) {
    return localizedJsonError(request, 'errors.configKeyExists');
  }

  const now = new Date().toISOString();
  const entry: ConfigEntry = {
    ...parsed,
    id: data.generateId(),
    createdAt: now,
    updatedAt: now,
  };

  configsData.configs.push(entry);
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(entry);
}

export async function handlePutConfig(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const configsData = await data.loadConfigs();
  const index = configsData.configs.findIndex((entry) => entry.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const current = configsData.configs[index];
  const parsed = normalizeConfigPayload(body, current);
  if ('errorKey' in parsed) return localizedJsonError(request, parsed.errorKey);

  if (hasDuplicateConfigKey(configsData.configs, parsed.key, id)) {
    return localizedJsonError(request, 'errors.configKeyExists');
  }

  const updated: ConfigEntry = {
    ...current,
    ...parsed,
    id: current.id,
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  configsData.configs[index] = updated;
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(updated);
}

export async function handleDeleteConfig(id: string, context: HandlerContext = {}, request?: Request): Promise<Response> {
  const configsData = await data.loadConfigs();
  const index = configsData.configs.findIndex((entry) => entry.id === id);
  if (index === -1) return request ? localizedJsonError(request, 'errors.notFound', 404) : jsonError('Not found', 404);

  configsData.configs.splice(index, 1);
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleUpload(request: Request): Promise<Response> {
  // Read raw binary body. The request Content-Type carries the file's real MIME.
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');

  // Decode filename from x-cms-filename header (percent-encoded); fall back to 'upload'.
  let rawName = 'upload';
  try {
    rawName = decodeURIComponent(request.headers.get('x-cms-filename') ?? 'upload');
  } catch {
    rawName = 'upload';
  }

  // Validate MIME type BEFORE disk write (denylist + allowlist gate — ADR-4)
  const mimeType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mimeType) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const gateResult = evaluateUpload({
    mimeType,
    derivedExtension: MIME_TO_EXT[mimeType] ?? null,
    allowed: getAllowedFileTypes(),
  });
  if (!gateResult.ok) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }

  // Validate size BEFORE disk write
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    const limitMb = Math.ceil(MAX_UPLOAD_BYTES / (1024 * 1024));
    return localizedJsonError(request, 'errors.fileTooLarge', 413, { limitMb: String(limitMb) });
  }

  // Extension is derived from the already-validated MIME type — never from the user-supplied filename.
  // This prevents a stored-XSS bypass where an SVG uploaded as "foo.jpg" would be served inline.
  const extension = MIME_TO_EXT[mimeType];
  if (!extension) {
    // MIME passed the gate but has no extension mapping — refuse rather than store a broken filename.
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const subdir = new Date().toISOString().slice(0, 7).replace(/-/g, '/');
  const dir = path.join(getUploadsDir(), subdir);

  await fs.mkdir(dir, { recursive: true });

  const token = crypto.randomBytes(4).toString('hex');
  const rawBase = path.basename(rawName || 'upload', path.extname(rawName || ''));
  const base = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'file';
  const filename = `${token}-${base}${extension}`;
  await fs.writeFile(path.join(dir, filename), Buffer.from(buffer));

  const url = `/uploads/${subdir}/${filename}`.replace(/\/+/, '/');

  // Capture image dimensions from the in-memory buffer (REQ-4).
  // Skip for non-image MIME types (e.g. application/pdf) — imageSize cannot parse them
  // and they have no meaningful width/height. image/* types (jpeg/png/webp/svg/gif) are tried.
  // Wrapped in try/catch so corrupt headers or unsupported formats never fail the upload.
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  if (mimeType.startsWith('image/')) {
    try {
      const dim = imageSize(Buffer.from(buffer));
      if (
        typeof dim.width === 'number' &&
        typeof dim.height === 'number' &&
        Number.isFinite(dim.width) &&
        Number.isFinite(dim.height)
      ) {
        capturedWidth = Math.floor(dim.width);
        capturedHeight = Math.floor(dim.height);
      }
    } catch {
      // Swallow dimension errors — never fail the upload
    }
  }

  // Classify file category: image/* → 'image', everything else → 'document'
  const fileCategory: 'image' | 'document' = mimeType.startsWith('image/') ? 'image' : 'document';

  // Append MediaEntry to registry with status:'processing' (variants generated async)
  const entry: MediaEntry = {
    id: data.generateId(),
    url,
    filename: rawName || filename,
    size: buffer.byteLength,
    mimeType,
    fileCategory,
    createdAt: new Date().toISOString(),
    ...(capturedWidth !== undefined && { width: capturedWidth }),
    ...(capturedHeight !== undefined && { height: capturedHeight }),
    status: 'processing',
  };
  await data.appendMediaEntry(entry);

  // Build response first, then fire-and-forget variant generation (after response returns)
  const res = Response.json({ url, entry });
  void generateAndPersistVariants(entry).catch(() => {});
  return res;
}

export async function handleDeleteUpload(request: Request): Promise<Response> {
  const { data: body, error } = await parseJsonBody<{ url?: string }>(request);
  if (error || !body) return error as Response;

  const url = body.url ?? '';
  const filePath = resolveUploadPath(url);
  if (!filePath) return localizedJsonError(request, 'errors.invalidUrl');

  // Look up the entry BEFORE removing from registry so we can access its variants
  const mediaData = await data.loadMedia();
  const entry = mediaData.uploads.find((e) => e.url === url);

  // Delete variant files (cascade) — ENOENT is tolerated (idempotent)
  if (entry?.variants && entry.variants.length > 0) {
    for (const variant of entry.variants) {
      const variantPath = resolveUploadPath(variant.url);
      if (variantPath) {
        try {
          await fs.unlink(variantPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // Non-ENOENT errors are swallowed: cascade is best-effort
          }
        }
      }
    }
  }

  // Attempt to unlink original from disk; ENOENT is treated as no-error (idempotent)
  try {
    await fs.unlink(filePath);
  } catch (deleteError) {
    if ((deleteError as NodeJS.ErrnoException).code !== 'ENOENT') {
      return localizedJsonError(request, 'errors.deleteFailed', 500);
    }
  }

  // Always prune the registry entry by URL (idempotent for both normal and ENOENT cases).
  // Serialized read-modify-write — concurrency-safe.
  await data.removeMediaEntryByUrl(url);

  return new Response(null, { status: 204 });
}

export async function handleGetMedia(request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  // Parse query parameters: q, page, limit
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  let page = parseInt(url.searchParams.get('page') ?? '', 10);
  if (Number.isNaN(page) || page < 1) page = 1;

  let limit = parseInt(url.searchParams.get('limit') ?? '', 10);
  // NaN (non-numeric or absent) → default 24; otherwise clamp to [1, 100]
  if (Number.isNaN(limit)) limit = 24;
  limit = Math.min(100, Math.max(1, limit));

  // Pipeline: reconcile → sort newest-first → filter(q) → count total → slice page
  const reconciled = await data.reconcileMedia();

  const sorted = [...reconciled.uploads].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Filter by filename substring (case-insensitive) if q is non-empty
  const filtered = q
    ? sorted.filter((entry) => entry.filename.toLowerCase().includes(q))
    : sorted;

  const total = filtered.length;
  const uploads = filtered.slice((page - 1) * limit, page * limit);

  return Response.json({ uploads, total, page, limit });
}

/**
 * PATCH /cms/api/media/:id — Update the default alt text of a media entry.
 *
 * Request body: { alt: string }
 * Response 200: { entry: MediaEntry } — the updated entry
 * Errors: 401 (unauth), 404 (unknown id), 400 (malformed body)
 */
export async function handleUpdateMediaAlt(id: string, request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const { data: body, error } = await parseJsonBody<{ alt?: unknown }>(request);
  if (error || !body) return error as Response;

  if (typeof body.alt !== 'string') {
    return localizedJsonError(request, 'errors.altMustBeString');
  }

  const updated = await data.updateMediaEntryAlt(id, body.alt);
  if (!updated) return localizedJsonError(request, 'errors.notFound', 404);

  return Response.json({ entry: updated });
}

/**
 * GET /cms/api/media/:id/usage
 * Returns { count, usages[] } for the given media entry URL.
 * 401 if unauthenticated; 404 if media id not found.
 */
export async function handleGetMediaUsage(id: string, request: Request): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const m = await data.loadMedia();
  const entry = m.uploads.find((e) => e.id === id);
  if (!entry) return localizedJsonError(request, 'errors.notFound', 404);

  const result = await data.findMediaUsages(entry.url);
  return Response.json(result);
}

/**
 * POST /cms/api/media/:id/replace
 * Replaces the bytes of an existing media entry in-place (same URL, same MIME).
 * 401 unauth; 404 unknown id; 400 no file; 415 wrong/disallowed MIME; 413 oversize.
 * On success: 200 { entry } with status:'processing'; fires variant regen async.
 */
export async function handleReplaceUpload(request: Request, id: string): Promise<Response> {
  const auth = await getAuth(request);
  if (!auth) return localizedJsonError(request, 'errors.unauthorized', 401);

  const m = await data.loadMedia();
  const entry = m.uploads.find((e) => e.id === id);
  if (!entry) return localizedJsonError(request, 'errors.notFound', 404);

  // Read raw binary body. The request Content-Type carries the file's real MIME.
  // CSRF is not a concern here: these endpoints authenticate via a JWT in the
  // Authorization/x-cms-token HEADER (see getAuth), never an ambient cookie, so a
  // cross-origin page cannot forge an authenticated request — the OWASP token-in-
  // header pattern. The non-form Content-Type (and the custom x-cms-filename header)
  // also force a CORS preflight our server never answers cross-origin. Using a
  // non-form body additionally avoids Astro's origin-check middleware, which would
  // otherwise 403 legitimate same-app uploads behind a reverse proxy (Origin vs
  // computed url.origin mismatch).
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return localizedJsonError(request, 'errors.noFile');

  // Decode filename from x-cms-filename header; fall back to 'upload'.
  let rawReplaceName = 'upload';
  try {
    rawReplaceName = decodeURIComponent(request.headers.get('x-cms-filename') ?? 'upload');
  } catch {
    rawReplaceName = 'upload';
  }

  // MIME validation — denylist + allowlist gate (ADR-4), then same-MIME constraint
  const mimeType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!mimeType) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  const replaceGateResult = evaluateUpload({
    mimeType,
    derivedExtension: MIME_TO_EXT[mimeType] ?? null,
    allowed: getAllowedFileTypes(),
  });
  if (!replaceGateResult.ok) {
    return localizedJsonError(request, 'errors.unsupportedFileType', 415);
  }
  if (mimeType !== entry.mimeType) {
    return localizedJsonError(request, 'errors.replaceSameType', 415, { mimeType: entry.mimeType });
  }

  // Size guard
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    const limitMb = Math.ceil(MAX_UPLOAD_BYTES / (1024 * 1024));
    return localizedJsonError(request, 'errors.fileTooLarge', 413, { limitMb: String(limitMb) });
  }

  // Resolve the on-disk path (reuses traversal guard)
  const filePath = resolveUploadPath(entry.url);
  if (!filePath) return localizedJsonError(request, 'errors.invalidUrl', 500);

  // Overwrite bytes ATOMICALLY: write to a temp file then rename into place.
  // rename(2) is atomic on POSIX, so a read never observes a half-written file.
  // On failure the temp file is cleaned up and the original is left intact.
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmpPath, Buffer.from(buffer));
    await fs.rename(tmpPath, filePath);
  } catch (writeErr) {
    // Clean up the temp file on error (best-effort) and abort before any
    // variant unlink or registry update so the original stays intact.
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    return localizedJsonError(request, 'errors.replaceWriteFailed', 500);
  }

  // Recompute dimensions
  let capturedWidth: number | undefined;
  let capturedHeight: number | undefined;
  try {
    const dim = imageSize(Buffer.from(buffer));
    if (
      typeof dim.width === 'number' &&
      typeof dim.height === 'number' &&
      Number.isFinite(dim.width) &&
      Number.isFinite(dim.height)
    ) {
      capturedWidth = Math.floor(dim.width);
      capturedHeight = Math.floor(dim.height);
    }
  } catch {
    // Swallow dimension errors — never fail the replace
  }

  // Update registry under lock. replaceMediaEntryBytes atomically captures
  // the current variant list and clears it, then returns { entry, oldVariants }.
  // We use oldVariants (the set that was live at mutation time) to unlink —
  // not the pre-lock snapshot from the early loadMedia(), which avoids the race
  // where a concurrent regen re-populates variants between the snapshot and lock.
  const result = await data.replaceMediaEntryBytes(id, {
    size: buffer.byteLength,
    width: capturedWidth,
    height: capturedHeight,
  });
  if (!result) return localizedJsonError(request, 'errors.notFound', 404);

  const { entry: updated, oldVariants } = result;

  // Delete stale variant files (they map to old bytes; new image may be smaller).
  // ENOENT is tolerated: variant may already be gone.
  for (const variant of oldVariants) {
    const variantPath = resolveUploadPath(variant.url);
    if (variantPath) {
      try {
        await fs.unlink(variantPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Non-ENOENT errors are swallowed: cascade is best-effort
        }
      }
    }
  }

  // Build response, then fire-and-forget variant regen (same as handleUpload)
  const res = Response.json({ entry: updated });
  void generateAndPersistVariants(updated).catch(() => {});
  return res;
}

export async function handleGetGlobalBlocks(
  registry: GlobalBlockRuntimeEntry[],
  request: Request
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
      localeKeys
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
  request: Request
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
    localeKeys
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
  registry: GlobalBlockRuntimeEntry[]
): Promise<Response> {
  const decl = registry.find((entry) => entry.slug === slug);
  if (!decl) return localizedJsonError(request, 'errors.globalBlockNotFound', 404, { slug });

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  if (!Object.prototype.hasOwnProperty.call(body, 'props')) return localizedJsonError(request, 'errors.propsRequired');
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
      if (def && isSchemaPropLocalizable(def) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const localeValues = Object.values(value as Record<string, unknown>);
        propsForValidation[key] = localeValues.length > 0 ? localeValues[0] : '';
      } else {
        propsForValidation[key] = value;
      }
    }
    const issue = validateBlockPropsAgainstSchema(schema.name || decl.schemaName, 0, schemaItems, propsForValidation);
    if (issue) return localizedJsonError(request, issue.messageKey, 400, issue.params);
  }

  // Merge incoming (scalar-per-locale) props into existing props so other locales are preserved.
  const existingEntry = globalBlocksData.globalBlocks[slug];
  const merged = mergeBlockPropsForLocale(
    existingEntry ? ({ type: decl.schemaName, props: existingEntry.props ?? {} } as BlockInstance) : undefined,
    { type: decl.schemaName, props: incomingProps } as BlockInstance,
    schemaMap,
    locale,
    localeKeys
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
    localeKeys
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

export async function handleInvalidateCache(request: Request, context: HandlerContext = {}): Promise<Response> {
  if (!context.cache?.enabled) {
    return Response.json({
      ok: true,
      cacheEnabled: false,
      message: 'Astro cache is not enabled for this project.',
    });
  }

  try {
    for (const pathname of getGlobalCachePaths()) {
      await context.cache.invalidate({ path: pathname });
    }
    await context.cache.invalidate({ tags: getGlobalCacheTags() });

    return Response.json({
      ok: true,
      cacheEnabled: true,
      message: 'Cache invalidated successfully.',
    });
  } catch (error) {
    return localizedJsonError(request, 'errors.cacheInvalidationFailed', 500, undefined, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GET /cms/api/export?units=pages,media,...
 *
 * Owner-only streaming zip export of selected CMS units (ADR-4).
 * Returns the zip archive as a ReadableStream with Content-Type application/zip.
 */
export async function handleExport(request: Request, authUser?: AuthUser | null): Promise<Response> {
  // Auth gate: must be authenticated
  if (!authUser) {
    return request
      ? localizedJsonError(request, 'errors.unauthorized', 401)
      : jsonError('Unauthorized', 401);
  }

  // Owner-only gate
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  // Parse ?units=pages,media,... from the query string
  const url = new URL(request.url);
  const unitsParam = url.searchParams.get('units') ?? '';
  const rawUnits = [
    ...new Set(
      unitsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

  if (rawUnits.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Validate each unit against the known allowlist
  const knownUnits = new Set<string>(Object.keys(UNIT_TO_DATA_FILES));
  for (const unit of rawUnits) {
    if (!knownUnits.has(unit)) {
      return localizedJsonError(request, 'errors.invalidBody', 400);
    }
  }

  const units = rawUnits as ExportUnit[];

  try {
    const stream = await buildExportStream(units);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `astro-blocks-export-${timestamp}.zip`;

    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Export failed',
      500,
    );
  }
}

/**
 * POST /cms/api/import
 *
 * Owner-only import handler (ADR-5).
 * Reads the request body as a stream (never fully buffered in memory beyond what
 * we collect for fflate extraction). Orchestrates:
 *   requireOwner → readCeilingEnvVars → runImportPipeline → JSON response.
 *
 * Maps failures to HTTP status codes:
 *   400 — empty or corrupt zip
 *   413 — decompression ceiling exceeded (zip-bomb guard)
 *   422 — schemaVersion mismatch, checksum failure, or structural validation error
 *   401 — not authenticated
 *   403 — not owner
 */
export async function handleImport(
  request: Request,
  authUser: AuthUser | null | undefined,
  context: HandlerContext = {},
): Promise<Response> {
  // Auth gate
  if (!authUser) {
    return request
      ? localizedJsonError(request, 'errors.unauthorized', 401)
      : jsonError('Unauthorized', 401);
  }

  // Owner-only gate
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  // Read ceiling limits first so we can reject oversized payloads early.
  const ceilings = readCeilingEnvVars();

  // FIX 2: Reject oversized compressed body BEFORE buffering it.
  // Content-Length may be absent or spoofed, so we also check after buffering.
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const clBytes = parseInt(contentLength, 10);
    if (Number.isFinite(clBytes) && clBytes > ceilings.compressed) {
      return jsonError(
        `Compressed body too large: Content-Length ${clBytes} exceeds limit ${ceilings.compressed}`,
        413,
      );
    }
  }

  // Read the request body — collect stream into a Buffer for fflate processing.
  // The zip is never written to a temp file on disk here; fflate decompresses
  // directly from the in-memory buffer into the staging directory.
  let bodyBuffer: Buffer;
  try {
    const ab = await request.arrayBuffer();
    bodyBuffer = Buffer.from(ab);
  } catch {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Post-buffer compressed size check (catches absent/spoofed Content-Length)
  if (bodyBuffer.length > ceilings.compressed) {
    return jsonError(
      `Compressed body too large: ${bodyBuffer.length} bytes exceeds limit ${ceilings.compressed}`,
      413,
    );
  }

  if (bodyBuffer.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();

  // FIX 5c: Wrap runImportPipeline in a top-level try/catch to guarantee a JSON error
  // response even if the pipeline throws unexpectedly.
  let result: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    result = await runImportPipeline(bodyBuffer, {
      projectRoot,
      ceilings,
      context,
    });
  } catch (err) {
    return jsonError(`Import failed unexpectedly: ${(err as Error).message}`, 500);
  }

  if (!result.ok) {
    switch (result.errorCode) {
      case 'empty':
      case 'corrupt':
        return localizedJsonError(request, 'errors.invalidBody', 400);
      case 'ceiling':
        return jsonError(result.reason ?? 'Decompression ceiling exceeded', 413);
      case 'validation':
        return jsonError(result.reason ?? 'Validation failed', 422);
      case 'apply-failed':
        return jsonError(result.reason ?? 'Import apply failed (rollback attempted)', 500);
      default:
        return jsonError(result.reason ?? 'Import failed', 500);
    }
  }

  return Response.json({ success: true, usersReplaced: result.usersReplaced ?? false });
}

/**
 * POST /cms/api/import/bootstrap
 *
 * Unauthenticated import endpoint for seeding a fresh instance (ADR-6).
 * SECURITY-CRITICAL: this surface is public — the zero-user gate is the ONLY
 * protection. The gate MUST be checked before any request-body access.
 *
 * Flow:
 *   1. Load users — check length BEFORE reading the request body.
 *   2. If users.length !== 0 → 403 IMMEDIATELY (body never read).
 *   3. If users.length === 0 → run the shared runImportPipeline (same validation,
 *      ceilings, checksum, path guards, backup, atomic apply as the authed import).
 *
 * Status codes:
 *   200 {success:true, usersReplaced}   — pipeline succeeded
 *   400                                  — empty or corrupt zip
 *   403                                  — instance already has users
 *   413                                  — decompression ceiling exceeded
 *   422                                  — schemaVersion mismatch / checksum / structural
 */
export async function handleBootstrapImport(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  // GATE: load users FIRST — before reading/consuming any request body.
  // If any user exists, refuse immediately without touching the body.
  const usersData = await data.loadUsers();
  if (usersData.users.length !== 0) {
    return jsonError('Forbidden: instance already has users', 403);
  }

  // Read ceiling limits so we can reject oversized payloads early.
  const ceilings = readCeilingEnvVars();

  // Compressed body size check via Content-Length (may be absent or spoofed).
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const clBytes = parseInt(contentLength, 10);
    if (Number.isFinite(clBytes) && clBytes > ceilings.compressed) {
      return jsonError(
        `Compressed body too large: Content-Length ${clBytes} exceeds limit ${ceilings.compressed}`,
        413,
      );
    }
  }

  // Read the request body for fflate processing.
  let bodyBuffer: Buffer;
  try {
    const ab = await request.arrayBuffer();
    bodyBuffer = Buffer.from(ab);
  } catch {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  // Post-buffer compressed size check (catches absent/spoofed Content-Length).
  if (bodyBuffer.length > ceilings.compressed) {
    return jsonError(
      `Compressed body too large: ${bodyBuffer.length} bytes exceeds limit ${ceilings.compressed}`,
      413,
    );
  }

  if (bodyBuffer.length === 0) {
    return localizedJsonError(request, 'errors.invalidBody', 400);
  }

  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();

  // Run the shared import pipeline — same validation, ceilings, path guards,
  // backup snapshot, and atomic apply as the authenticated import (C-5/ADR-5).
  let result: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    result = await runImportPipeline(bodyBuffer, {
      projectRoot,
      ceilings,
      context,
    });
  } catch (err) {
    return jsonError(`Bootstrap import failed unexpectedly: ${(err as Error).message}`, 500);
  }

  if (!result.ok) {
    switch (result.errorCode) {
      case 'empty':
      case 'corrupt':
        return localizedJsonError(request, 'errors.invalidBody', 400);
      case 'ceiling':
        return jsonError(result.reason ?? 'Decompression ceiling exceeded', 413);
      case 'validation':
        return jsonError(result.reason ?? 'Validation failed', 422);
      case 'apply-failed':
        return jsonError(result.reason ?? 'Bootstrap import apply failed (rollback attempted)', 500);
      default:
        return jsonError(result.reason ?? 'Bootstrap import failed', 500);
    }
  }

  return Response.json({ success: true, usersReplaced: result.usersReplaced ?? false });
}
