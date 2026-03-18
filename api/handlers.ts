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
import { getProjectRoot, getUploadsDir, resolveUploadPath } from '../utils/paths.js';
import type { AuthResult, AuthUser, BlockInstance, Menu, MenuItem, Page, PagesData, SchemaMap, SeoData, Site, User } from '../types/index.js';
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
  currentPage?: Pick<Page, 'id' | 'slug'> | null,
  previousPage?: Pick<Page, 'id' | 'slug'> | null
): Promise<void> {
  const tags = new Set<string>(getGlobalCacheTags());
  const paths = new Set<string>(getGlobalCachePaths());

  for (const page of [currentPage, previousPage]) {
    if (!page) continue;
    paths.add(getPageCachePath(page));
    for (const tag of getPageCacheTags(page)) tags.add(tag);
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

async function deleteById<T extends { id: string }, TKey extends string, TContainer extends Record<TKey, T[]>>(
  load: () => Promise<TContainer>,
  save: (data: TContainer) => Promise<void>,
  listKey: TKey,
  id: string
): Promise<Response> {
  const loaded = await load();
  const list = (loaded[listKey] ?? []) as T[];
  const filtered = list.filter((item) => item.id !== id);

  if (filtered.length === list.length) return jsonError('Not found', 404);

  await save({ ...loaded, [listKey]: filtered } as TContainer);
  return new Response(null, { status: 204 });
}

function scryptAsync(password: string, salt: crypto.BinaryLike, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
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

function normalizePageInput(
  body: Record<string, unknown>,
  existing?: PagesData['pages'][number]
): Pick<Page, 'slug' | 'status' | 'title' | 'blocks' | 'indexable' | 'seo'> {
  const rawSlug = body.slug !== undefined ? body.slug : existing?.slug ?? '/';
  const slug = Array.isArray(rawSlug) ? rawSlug.map(String) : String(rawSlug || '/');
  const rawStatus = typeof body.status === 'string' ? body.status : existing?.status ?? 'draft';
  const status: Page['status'] =
    rawStatus === 'published' || rawStatus === 'archived' || rawStatus === 'draft' ? rawStatus : 'draft';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing?.title ?? 'Untitled';
  const blocks = Array.isArray(body.blocks) ? (body.blocks as BlockInstance[]) : existing?.blocks ?? [];
  const seo = body.seo !== undefined ? normalizePageSeo(body.seo) : existing?.seo ?? {};
  const indexable = body.indexable !== undefined ? Boolean(body.indexable) : existing?.indexable ?? true;

  return { slug, status, title, blocks, seo, indexable };
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

export async function handleGetPages(): Promise<Response> {
  return Response.json(await data.loadPages());
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

  const pagesData = await data.loadPages();
  const now = new Date().toISOString();
  const normalized = normalizePageInput(body);

  const page = {
    id: data.generateId(),
    ...normalized,
    publishedAt: normalized.status === 'published' ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  pagesData.pages.push(page);
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, page);
  return Response.json(page);
}

export async function handlePutPage(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const pagesData = await data.loadPages();
  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return jsonError('Not found', 404);

  const blocksError = await ensureValidBlocks(body.blocks);
  if (blocksError) return blocksError;

  const existing = pagesData.pages[index];
  const normalized = normalizePageInput(body, existing);
  const now = new Date().toISOString();

  const page = {
    ...existing,
    ...normalized,
    seo: body.seo !== undefined ? { ...(existing.seo || {}), ...normalized.seo } : existing.seo,
    updatedAt: now,
    publishedAt: normalized.status === 'published' ? existing.publishedAt || now : existing.publishedAt,
  };

  pagesData.pages[index] = page;
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, page, existing);
  return Response.json(page);
}

export async function handleDeletePage(id: string, context: HandlerContext = {}): Promise<Response> {
  const pagesData = await data.loadPages();
  const index = pagesData.pages.findIndex((page) => page.id === id);
  if (index === -1) return jsonError('Not found', 404);

  const deletedPage = pagesData.pages[index];
  pagesData.pages.splice(index, 1);
  await data.savePages(pagesData);
  await invalidatePageContentCache(context.cache, null, deletedPage);
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

export async function handleGetMenus(): Promise<Response> {
  return Response.json(await data.loadMenus());
}

export async function handlePostMenus(request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const payload = normalizeMenuPayload(body);
  const menusData = await data.loadMenus();

  const selectorError = validateMenuSelector(menusData, payload.selector, null);
  if (selectorError) return jsonError(selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return jsonError(pathError);

  const newMenu: Menu = {
    id: data.generateId(),
    name: payload.name || 'Menú',
    selector: payload.selector || 'menu',
    items: payload.items,
  };

  menusData.menus.push(newMenu);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(newMenu);
}

export async function handlePutMenu(id: string, request: Request, context: HandlerContext = {}): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const payload = normalizeMenuPayload(body);
  const menusData = await data.loadMenus();
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1) return jsonError('Not found', 404);

  const selectorError = validateMenuSelector(menusData, payload.selector, id);
  if (selectorError) return jsonError(selectorError);

  const pathError = validateMenuItemsPaths(payload.items);
  if (pathError) return jsonError(pathError);

  const updated: Menu = {
    id: menusData.menus[index].id,
    name: payload.name || 'Menú',
    selector: payload.selector || 'menu',
    items: payload.items,
  };

  menusData.menus[index] = updated;
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(updated);
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

  return Response.json({ url: `/uploads/${subdir}/${filename}`.replace(/\/+/g, '/') });
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
