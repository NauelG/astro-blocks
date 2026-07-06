/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * routes/api/catchall.ts — Astro binding shim for the CMS API.
 *
 * Phase 3 of route-table-auth-gating (resolves #36 + #37): the five
 * hand-rolled if-chains are replaced by a single central `dispatch()` that
 * resolves auth exactly ONCE per request and enforces the matched route's
 * declared `auth` level BEFORE invoking any handler. There is exactly one
 * code path to any handler and it always passes through the auth gate —
 * authorization is correct-by-construction (ADR-5).
 *
 * This module keeps only: `getPathSegments` (the `/cms/api` mount-prefix
 * strip), `dispatch`, and the five per-verb exports Astro requires. The
 * route inventory lives in `api/route-table.ts`; the pure matcher lives in
 * `api/route-matcher.ts`.
 */

import type { APIContext } from 'astro';
import * as handlers from '../../api/handlers.js';
import { localizedJsonError } from '../../api/handlers.js';
import { matchRoute, type HttpMethod } from '../../api/route-matcher.js';
import { routes } from '../../api/route-table.js';

export const prerender = false;

function getPathSegments(url: string): string[] {
  const pathname = new URL(url).pathname;
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(2);
}

/**
 * The single dispatch point for all 43 CMS API routes.
 *
 * Resolves `getAuth()` ONCE (replacing the four `ensureAuth` copies of the
 * old if-chain), matches the route table, then enforces the matched
 * descriptor's declared auth level before running its handler:
 *   - no match                    -> 401 if unauthenticated, else 404
 *     (info-hiding: an unauthenticated caller can never observe whether a
 *     route exists — mirrors the old `ensureAuth`-before-404 ordering)
 *   - `public`                    -> handler runs unconditionally
 *   - `user` / `owner`, no auth   -> 401, handler never runs
 *   - `owner`, non-owner caller   -> 403 (`requireOwner`), handler never runs
 *   - otherwise                   -> handler runs
 */
async function dispatch(method: HttpMethod, context: APIContext): Promise<Response> {
  const { request, cache } = context;
  const seg = getPathSegments(request.url);
  const match = matchRoute(method, seg, routes);
  const auth = await handlers.getAuth(request);

  if (!match) {
    if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    return localizedJsonError(request, 'errors.notFound', 404);
  }

  const { descriptor, params } = match;

  if (descriptor.auth === 'public') {
    return descriptor.handler({ request, cache, params, user: auth?.user ?? null });
  }

  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  if (descriptor.auth === 'owner') {
    const forbidden = handlers.requireOwner(auth.user, request);
    if (forbidden) return forbidden;
  }

  return descriptor.handler({ request, cache, params, user: auth.user });
}

export const GET = (context: APIContext): Promise<Response> => dispatch('GET', context);
export const POST = (context: APIContext): Promise<Response> => dispatch('POST', context);
export const PUT = (context: APIContext): Promise<Response> => dispatch('PUT', context);
export const PATCH = (context: APIContext): Promise<Response> => dispatch('PATCH', context);
export const DELETE = (context: APIContext): Promise<Response> => dispatch('DELETE', context);
