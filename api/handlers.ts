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
import type {
  AuthResult,
  AuthUser,
  BlockInstance,
  ContentLanguage,
  LanguagesData,
  Menu,
  MenuItem,
  Page,
  PageLocaleView,
  PageStatus,
  PagesData,
  SchemaMap,
  SeoData,
  Site,
  User,
} from '../types/index.js';
import * as data from './data.js';

const JWT_SECRET = new TextEncoder().encode(process.env.CMS_JWT_SECRET || 'cms-jwt-secret-change-me');
const JWT_EXPIRY = '7d';
type AstroCache = APIContext['cache'];
type HandlerContext = { cache?: AstroCache | null };

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
    return { data: null, error: jsonError('Invalid body') };
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

function validateMenuItemsPaths(items: unknown): string | null {
  if (!Array.isArray(items)) return 'Los elementos del menú deben ser un array.';

  for (const item of items as MenuItem[]) {
    if (!item || typeof item !== 'object') return 'Elemento del menú no válido.';
    if (typeof item.path !== 'string' || item.path.trim() === '') {
      return 'La ruta es obligatoria en todos los elementos del menú.';
    }
    if (Array.isArray(item.children)) {
      const childError = validateMenuItemsPaths(item.children);
      if (childError) return childError;
    }
  }

  return null;
}

function validateMenuSelector(menusData: { menus: Menu[] }, selector: string, excludeMenuId: string | null): string | null {
  if (!selector) return 'El selector es obligatorio.';
  if (!data.MENU_SELECTOR_REGEX.test(selector)) {
    return 'El selector solo puede contener letras, números, guiones y guiones bajos (sin espacios).';
  }

  const taken = menusData.menus.some((menu) => menu.selector === selector && menu.id !== excludeMenuId);
  if (taken) return 'Ya existe un menú con ese selector.';

  return null;
}

function normalizeMenuPayload(body: Record<string, unknown>) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    selector: typeof body.selector === 'string' ? body.selector.trim() : '',
    items: Array.isArray(body.items) ? (body.items as MenuItem[]) : [],
  };
}

function validateLocalePrefixConflict(
  slug: string | string[],
  locale: string,
  defaultLocale: string,
  languagesData: LanguagesData
): string | null {
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
    return `El slug no puede comenzar con "${first}" porque está reservado para prefijos de idioma.`;
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
      output[propName] = rawValue[normalizedLocale];
      continue;
    }

    if (isLocalizedMapValue(rawValue, localeKeys)) {
      output[propName] = rawValue[normalizedLocale];
      continue;
    }

    output[propName] = rawValue;
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
      localized[locale] = value;
      output[propName] = localized;
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

async function ensureValidBlocks(blocks: unknown): Promise<Response | null> {
  if (blocks === undefined) return null;

  if (!Array.isArray(blocks) || blocks.length > 0) {
    const result = await loadSchemaMap();
    if (result.error) return jsonError(result.error, 500, { missing: result.missing || [] });

    const validation = validateBlocks(result.schemaMap || {}, blocks);
    if (validation) return jsonError(validation.message);
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

export function requireOwner(user?: AuthUser | null): Response | null {
  if (!user || user.role !== 'owner') return jsonError('Forbidden', 403);
  return null;
}

export async function handleLogin(request: Request): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return jsonError('Email and password required');

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
    return jsonError('Invalid credentials', 401);
  }

  const token = await createToken(user);
  return Response.json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

export async function handleAuthMe(user?: AuthUser | null): Promise<Response> {
  if (!user) return jsonError('Unauthorized', 401);
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
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'owner' ? 'owner' : 'user';
  if (!email || !password) return jsonError('Email and password required');

  const usersData = await data.loadUsers();
  if (usersData.users.some((user) => user.email === email)) return jsonError('Email already exists');

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
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1) return jsonError('Not found', 404);

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;

  if (body.role !== undefined) {
    const newRole = body.role === 'owner' ? 'owner' : 'user';
    if (target.role === 'owner' && newRole === 'user' && ownerCount <= 1) {
      return jsonError('No se puede quitar el único propietario');
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

export async function handleDeleteUser(id: string, authUser?: AuthUser | null): Promise<Response> {
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1) return jsonError('Not found', 404);

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) return jsonError('No se puede eliminar al único propietario');

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

  if (!code) return jsonError('El código de idioma es obligatorio.');
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)) {
    return jsonError('Código de idioma no válido. Usa formato como "es" o "pt-br".');
  }

  if (languagesData.languages.some((language) => normalizeLanguageCode(language.code) === code)) {
    return jsonError('Ya existe un idioma con ese código.');
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
  if (index === -1) return jsonError('Not found', 404);

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
    return jsonError('Debe existir al menos un idioma habilitado.');
  }

  if (!languagesData.languages.some((language) => language.isDefault && language.enabled !== false)) {
    languagesData.languages = ensureEnabledDefaultLanguage(languagesData.languages);
  }

  await data.saveLanguages(languagesData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(languagesData.languages[index]);
}

export async function handleDeleteLanguage(code: string, context: HandlerContext = {}): Promise<Response> {
  const normalizedCode = normalizeLanguageCode(code);

  const [languagesData, pagesData, menusData, schemaResult] = await Promise.all([
    data.loadLanguages(),
    data.loadPages(),
    data.loadMenus(),
    loadSchemaMap(),
  ]);

  const languageIndex = languagesData.languages.findIndex((language) => normalizeLanguageCode(language.code) === normalizedCode);
  if (languageIndex === -1) return jsonError('Not found', 404);
  if (languagesData.languages.length <= 1) return jsonError('No se puede eliminar el último idioma.');

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

  const blocksError = await ensureValidBlocks(body.blocks);
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
    return jsonError('Ya existe una página con ese slug para este idioma.');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError) return jsonError(conflictError);

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

  const blocksError = await ensureValidBlocks(body.blocks);
  if (blocksError) return blocksError;

  const [pagesData, languagesData, schemaResult] = await Promise.all([
    data.loadPages(),
    data.loadLanguages(),
    loadSchemaMap(),
  ]);

  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return jsonError('Not found', 404);

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
    return jsonError('Ya existe una página con ese slug para este idioma.');
  }

  const conflictError = validateLocalePrefixConflict(slug, locale, defaultLocale, languagesData);
  if (conflictError) return jsonError(conflictError);

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
  if (index === -1) return jsonError('Not found', 404);

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
  if (selectorError) return jsonError(selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return jsonError(pathError);

  const newMenu: Menu = {
    id: data.generateId(),
    name: payload.name || 'Menú',
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
  if (index === -1) return jsonError('Not found', 404);

  const locale = resolveLocaleFromBody(body, request, languagesData);

  const selectorError = validateMenuSelector(menusData, payload.selector, id);
  if (selectorError) return jsonError(selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return jsonError(pathError);

  const current = menusData.menus[index];
  const updated: Menu = {
    ...current,
    name: payload.name || current.name || 'Menú',
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

export async function handleDeleteMenu(id: string, context: HandlerContext = {}): Promise<Response> {
  const menusData = await data.loadMenus();
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1) return jsonError('Not found', 404);

  menusData.menus.splice(index, 1);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleUpload(request: Request): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof (file as File).arrayBuffer !== 'function') return jsonError('No file');

  const blob = file as File;
  const buffer = await blob.arrayBuffer();
  const fileName = blob.name || 'upload';
  const extension = path.extname(fileName) || '';
  const subdir = new Date().toISOString().slice(0, 7).replace(/-/g, '/');
  const dir = path.join(getUploadsDir(), subdir);

  await fs.mkdir(dir, { recursive: true });

  const token = crypto.randomBytes(4).toString('hex');
  const base = path.basename(fileName, extension) || 'file';
  const filename = `${token}-${base}${extension}`;
  await fs.writeFile(path.join(dir, filename), Buffer.from(buffer));

  return Response.json({ url: `/uploads/${subdir}/${filename}`.replace(/\/+/, '/') });
}

export async function handleDeleteUpload(request: Request): Promise<Response> {
  const { data: body, error } = await parseJsonBody<{ url?: string }>(request);
  if (error || !body) return error as Response;

  const filePath = resolveUploadPath(body.url ?? '');
  if (!filePath) return jsonError('Invalid or disallowed URL');

  try {
    await fs.unlink(filePath);
  } catch (deleteError) {
    if ((deleteError as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 204 });
    return jsonError('Delete failed', 500);
  }

  return new Response(null, { status: 204 });
}

export async function handleInvalidateCache(context: HandlerContext = {}): Promise<Response> {
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
    return jsonError('Cache invalidation failed', 500, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
