/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getGlobalCachePaths, getGlobalCacheTags } from '../utils/cache.js';
import { getDefaultLanguageCode } from '../utils/localization.js';
import {
  hasDuplicateRedirectFrom,
  normalizeRedirectPath,
  normalizeRedirectStatusCode,
  validateRedirectPathInput,
} from '../utils/redirects.js';
import { removeLocaleFromLocalizedMap } from '../utils/locale-projection.js';
import type {
  AuthUser,
  ConfigEntry,
  Menu,
  MenuItem,
  PagesData,
  RedirectRule,
} from '../types/index.js';
import * as data from './data.js';
import { buildExportStream, runImportPipeline } from './backup.js';
import { UNIT_TO_DATA_FILES } from './manifest.js';
import type { ExportUnit } from './manifest.js';
import { readCeilingEnvVars } from './import-utils.js';
import { catalogs } from '../routes/admin/i18n/catalogs.js';
import { t as translateFn } from '../routes/admin/i18n/t.js';
import {
  jsonError,
  localizedJsonError,
  parseJsonBody,
  resolveRequestUiLocale,
} from './handlers/shared.js';
import type { HandlerContext } from './handlers/shared.js';
import { invalidateGlobalContentCache } from './handlers/cache-invalidation.js';
import { requireOwner } from './handlers/auth-core.js';
import { normalizeLocaleFromRequest, resolveLocaleFromBody } from './handlers/locale-resolution.js';
export { localizedJsonError } from './handlers/shared.js';
export { handleGetSite, handlePutSite } from './handlers/site.js';
export {
  classifyJwtSecret,
  getAuth,
  hashPassword,
  requireOwner,
  verifyPassword,
} from './handlers/auth-core.js';
export type { JwtSecretStatus } from './handlers/auth-core.js';
export { handleLogin, handleAuthMe, handleAuthStatus } from './handlers/auth.js';
export {
  handleGetUsers,
  handlePostUsers,
  handlePutUser,
  handleDeleteUser,
} from './handlers/users.js';
export {
  handleGetLanguages,
  handlePostLanguages,
  handlePutLanguage,
  handleDeleteLanguage,
} from './handlers/languages.js';
export {
  handleGetPages,
  handleGetBlockSchemas,
  handlePostPages,
  handlePutPage,
  handleDeletePage,
} from './handlers/pages.js';
export {
  handleGetGlobalBlocks,
  handleGetGlobalBlock,
  handlePutGlobalBlock,
} from './handlers/global-blocks.js';
export {
  resetAllowedFileTypesCache,
  handleUpload,
  handleDeleteUpload,
  handleGetMedia,
  handleUpdateMediaAlt,
  handleGetMediaUsage,
  handleReplaceUpload,
} from './handlers/media.js';

const CONFIG_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_.-]*$/;

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
function validateMenuSelector(
  menusData: { menus: Menu[] },
  selector: string,
  excludeMenuId: string | null,
): string | null {
  if (!selector) return 'errors.menuSelectorRequired';
  if (!data.MENU_SELECTOR_REGEX.test(selector)) {
    return 'errors.invalidMenuSelector';
  }

  const taken = menusData.menus.some(
    (menu) => menu.selector === selector && menu.id !== excludeMenuId,
  );
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

function normalizeConfigPayload(
  body: Record<string, unknown>,
  current?: ConfigEntry,
): ConfigEntry | { errorKey: string } {
  const key = normalizeConfigKey(body.key !== undefined ? body.key : current?.key);
  if (!key) return { errorKey: 'errors.configKeyRequired' };
  if (!CONFIG_KEY_REGEX.test(key)) {
    return { errorKey: 'errors.invalidConfigKey' };
  }

  const valueInput = body.value !== undefined ? body.value : current?.value;
  const value =
    typeof valueInput === 'string'
      ? valueInput
      : valueInput === undefined || valueInput === null
        ? ''
        : String(valueInput);
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
  current?: RedirectRule,
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
    statusCode: normalizeRedirectStatusCode(
      body.statusCode !== undefined ? body.statusCode : current?.statusCode,
    ),
    enabled: body.enabled === undefined ? current?.enabled !== false : Boolean(body.enabled),
    createdAt: current?.createdAt,
    updatedAt: current?.updatedAt,
  };
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

export async function handlePostMenus(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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

export async function handlePutMenu(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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

export async function handleDeleteMenu(
  id: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const menusData = await data.loadMenus();
  const index = menusData.menus.findIndex((menu) => menu.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  menusData.menus.splice(index, 1);
  await data.saveMenus(menusData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleGetRedirects(): Promise<Response> {
  const redirectsData = await data.loadRedirects();
  return Response.json(redirectsData);
}

export async function handlePostRedirects(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const redirectsData = await data.loadRedirects();
  const parsed = normalizeRedirectPayload(body);
  if ('errorKey' in parsed) {
    const locale = resolveRequestUiLocale(request);
    const catalog = catalogs[locale];
    const fieldLabel = parsed.fieldKey ? translateFn(catalog, parsed.fieldKey) : '';
    return localizedJsonError(
      request,
      parsed.errorKey,
      400,
      fieldLabel ? { field: fieldLabel } : undefined,
    );
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

export async function handlePutRedirect(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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
    return localizedJsonError(
      request,
      parsed.errorKey,
      400,
      fieldLabel ? { field: fieldLabel } : undefined,
    );
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

export async function handleDeleteRedirect(
  id: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const redirectsData = await data.loadRedirects();
  const index = redirectsData.redirects.findIndex((entry) => entry.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  redirectsData.redirects.splice(index, 1);
  await data.saveRedirects(redirectsData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleGetConfigs(): Promise<Response> {
  const configsData = await data.loadConfigs();
  return Response.json(configsData);
}

export async function handlePostConfigs(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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

export async function handlePutConfig(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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

export async function handleDeleteConfig(
  id: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const configsData = await data.loadConfigs();
  const index = configsData.configs.findIndex((entry) => entry.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  configsData.configs.splice(index, 1);
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}

export async function handleInvalidateCache(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
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
export async function handleExport(
  request: Request,
  authUser?: AuthUser | null,
): Promise<Response> {
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
    return jsonError(error instanceof Error ? error.message : 'Export failed', 500);
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
    // Log the real error server-side; never expose raw message or paths to callers.
    console.error('[handleImport] unexpected error:', err);
    return jsonError('Import failed.', 500);
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
        return jsonError('Import failed.', 500);
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
  // bootstrapMode:true enables the in-lock re-check inside _runImportPipelineCore
  // to close the TOCTOU race between the outer gate above and pipeline start.
  let result: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    result = await runImportPipeline(bodyBuffer, {
      projectRoot,
      ceilings,
      context,
      bootstrapMode: true,
    });
  } catch (err) {
    // Log the real error server-side; never expose raw message to anonymous callers.
    console.error('[handleBootstrapImport] unexpected error:', err);
    return jsonError('Bootstrap import failed.', 500);
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
        return jsonError(
          result.reason ?? 'Bootstrap import apply failed (rollback attempted)',
          500,
        );
      case 'bootstrap-users-exist':
        return jsonError('Forbidden: instance already has users', 403);
      default:
        return jsonError('Bootstrap import failed.', 500);
    }
  }

  return Response.json({ success: true, usersReplaced: result.usersReplaced ?? false });
}
