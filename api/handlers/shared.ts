/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { APIContext } from 'astro';
import { resolveUiLocale } from '../../routes/admin/i18n/resolve.js';
import { catalogs } from '../../routes/admin/i18n/catalogs.js';
import { t as translateFn } from '../../routes/admin/i18n/t.js';

export type AstroCache = APIContext['cache'];
export type HandlerContext = { cache?: AstroCache | null };

/** Resolve the UI locale from the incoming API request (cookie > Accept-Language > 'en'). */
export function resolveRequestUiLocale(
  request: Request,
): import('../../routes/admin/i18n/types.js').UiLocale {
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
  extra?: Record<string, unknown>,
): Response {
  const locale = resolveRequestUiLocale(request);
  const catalog = catalogs[locale];
  const message = translateFn(catalog, key, params);
  return jsonError(message, status, extra);
}

export function jsonError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function parseJsonBody<T>(
  request: Request,
): Promise<{ data: T | null; error: Response | null }> {
  try {
    return { data: (await request.json()) as T, error: null };
  } catch {
    return { data: null, error: localizedJsonError(request, 'errors.invalidBody') };
  }
}
