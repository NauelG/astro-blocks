/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import {
  hasDuplicateRedirectFrom,
  normalizeRedirectPath,
  normalizeRedirectStatusCode,
  validateRedirectPathInput,
} from '../../utils/redirects.js';
import type { RedirectRule } from '../../types/index.js';
import * as data from '../data.js';
import { catalogs } from '../../routes/admin/i18n/catalogs.js';
import { t as translateFn } from '../../routes/admin/i18n/t.js';
import { jsonError, localizedJsonError, parseJsonBody, resolveRequestUiLocale } from './shared.js';
import type { HandlerContext } from './shared.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';

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
