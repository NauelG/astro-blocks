/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * api/route-matcher.ts — pure route-table mechanics for the CMS API dispatcher.
 *
 * Phase 1 (PR1) of route-table-auth-gating: types + `defineRoute` + the
 * hand-rolled `matchRoute`/`matchPattern` matcher. Zero runtime dependency,
 * zero handler coupling — the only import from `handlers.js` is `import type`,
 * which is erased at compile time (verbatimModuleSyntax). This module never
 * imports the route table; `matchRoute` receives the table as a parameter
 * (dependency injection) so PR2/PR3 can build `api/route-table.ts` and
 * `routes/api/catchall.ts` on top without ever creating a circular import.
 *
 * See design ADR-1 (module location), ADR-2 (closed auth union), ADR-3
 * (typed handler/auth contract), and ADR-4 (hand-rolled arity-exact,
 * declaration-order, first-match-wins matching).
 */

import type { APIContext } from 'astro';
import type { getAuth } from './handlers.js';

/** HTTP methods dispatched by the CMS API router. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Closed authorization tiers (ADR-2). No role hierarchy, no speculative
 * roles — extension cost is one literal here plus one branch in `dispatch`.
 */
export type AuthLevel = 'public' | 'user' | 'owner';

/** The authenticated user shape resolved by `handlers.getAuth`. */
export type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuth>>>['user'];

/**
 * Binds `RouteContext.user` nullability to the route's auth level (ADR-3):
 * `public` handlers receive `AuthUser | null`; `user`/`owner` handlers are
 * guaranteed a non-null `AuthUser` by the central dispatcher before they run.
 */
export type UserForAuth<A extends AuthLevel> = A extends 'public' ? AuthUser | null : AuthUser;

/** The uniform context every route handler receives, generic over its auth level. */
export interface RouteContext<A extends AuthLevel = AuthLevel> {
  request: Request;
  params: Record<string, string>;
  cache: APIContext['cache'];
  user: UserForAuth<A>;
}

export type RouteHandler<A extends AuthLevel> = (
  ctx: RouteContext<A>,
) => Response | Promise<Response>;

/** A single declared route: method + seg-relative pattern + auth level + handler. */
export interface RouteDescriptor<A extends AuthLevel = AuthLevel> {
  method: HttpMethod;
  pattern: string;
  auth: A;
  handler: RouteHandler<A>;
}

/**
 * Captures the literal `A` per call site so the handler is type-checked
 * against `RouteContext<A>`, then erases to the widened union for storage
 * in a homogeneous `RouteDescriptor[]` table. A bare object literal (without
 * this helper) would widen `auth` to the `AuthLevel` union and collapse the
 * per-entry nullability guarantee from ADR-3.
 */
export function defineRoute<A extends AuthLevel>(descriptor: RouteDescriptor<A>): RouteDescriptor {
  return descriptor as RouteDescriptor;
}

/** Result of a successful match: the matched descriptor plus extracted `:param` values. */
export interface RouteMatch {
  descriptor: RouteDescriptor;
  params: Record<string, string>;
}

/**
 * Scans `table` in declaration order and returns the first descriptor whose
 * `method` and `pattern` match — mirroring the original if-chain's first-match
 * semantics exactly (ADR-4). Returns `null` when nothing matches.
 */
export function matchRoute(
  method: HttpMethod,
  segments: string[],
  table: RouteDescriptor[],
): RouteMatch | null {
  for (const descriptor of table) {
    if (descriptor.method !== method) continue;
    const params = matchPattern(descriptor.pattern, segments);
    if (params) return { descriptor, params };
  }
  return null;
}

/**
 * Matches a single seg-relative pattern (e.g. `'media/:id/usage'`) against a
 * segment array. Exact arity (same segment count) is required — this mirrors
 * the `seg.length` checks in the original if-chain dispatcher. `:name`
 * segments capture the corresponding value unless it is empty; a literal
 * segment must match exactly.
 */
function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith(':')) {
      if (!segments[i]) return null;
      params[part.slice(1)] = segments[i];
    } else if (part !== segments[i]) {
      return null;
    }
  }
  return params;
}
