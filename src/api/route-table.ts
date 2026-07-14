/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * api/route-table.ts — the declarative route inventory for the CMS API
 * dispatcher (Phase 3 of route-table-auth-gating, resolves #36 + #37).
 *
 * This is the SINGLE SOURCE OF TRUTH for every method+path+auth-level
 * combination reachable through `routes/api/catchall.ts`. Each entry is
 * built with `defineRoute<A>` (see `api/route-matcher.ts` ADR-3) so the
 * handler's `RouteContext<A>.user` nullability is checked against its
 * declared `auth` literal at compile time, then erased to the widened
 * `RouteDescriptor` for storage in this homogeneous array.
 *
 * Declaration order mirrors the original if-chain branch order per method
 * (ADR-4: the matcher is a pure first-match, order-preserving scan with NO
 * implicit static-over-dynamic precedence). The inventory has no arity+method
 * collision between a static and a dynamic pattern, so this ordering is a
 * defensive convention, not a correctness requirement — but it is kept
 * faithful to the original branches for auditability.
 *
 * Adapters below only reshape the uniform `RouteContext` into each handler's
 * existing, unchanged call signature — no handler body is touched.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as handlers from './handlers.js';
import { defineRoute, type RouteDescriptor } from './route-matcher.js';
import { localizedJsonError } from './handlers/shared.js';
import type { GlobalBlockRuntimeEntry } from '../types/index.js';

/**
 * Loads the global-blocks registry (moved here from `routes/api/catchall.ts`
 * — only the 3 global-block adapters below consume it).
 *
 * Primary: the registry baked into the bundle at build time (vite.define).
 * This is the robust source in every deployment. Reading
 * .astro-blocks/runtime.mjs from disk (below) fails whenever that
 * gitignored build artifact is absent from the deployed server — which
 * 404'd global-block open/edit even though rendering worked via the bundled
 * alias.
 */
type RegistryResult =
  | { ok: true; entries: GlobalBlockRuntimeEntry[] }
  | { ok: false; reason: 'unresolved' };

async function loadGlobalBlocksRegistry(): Promise<RegistryResult> {
  const baked = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env
    ?.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY;
  if (typeof baked === 'string' && baked.length > 0) {
    try {
      const parsed = JSON.parse(baked) as GlobalBlockRuntimeEntry[];
      if (Array.isArray(parsed)) return { ok: true, entries: parsed };
    } catch {
      // Malformed bake — fall through to the filesystem read.
    }
  }

  // Fallback: dev/test filesystem read of the generated runtime module.
  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
  const runtimePath = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');

  try {
    const runtimeUrl = pathToFileURL(runtimePath).href;
    const mod = (await import(/* @vite-ignore */ runtimeUrl)) as {
      globalBlocksRegistry?: GlobalBlockRuntimeEntry[];
    };
    return { ok: true, entries: mod.globalBlocksRegistry ?? [] };
  } catch (error) {
    // NOT an empty registry. `catch { return [] }` was the original symptom ADR-0009 was
    // written to kill: downstream, an empty array is indistinguishable from "this project
    // declares no global blocks", so a resolution failure rendered as a plausible, WRONG
    // answer — the admin simply showed no global blocks and nobody knew why.
    //
    // A project that genuinely declares none bakes "[]" and resolves successfully above.
    // Reaching here means the registry could not be resolved at all (ADR-0025).
    console.error(
      '[astro-blocks] Could not resolve the global-blocks registry. Neither the baked value ' +
        '(import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY) nor ' +
        `${runtimePath} resolved. On a deployed server this means the bundle was not built ` +
        'with the astro-blocks integration active — .astro-blocks/ is a gitignored build ' +
        'artifact and is never a resolution strategy. See ADR-0009 and ADR-0025.',
      error,
    );
    return { ok: false, reason: 'unresolved' };
  }
}

/**
 * A 500, not a throw: `dispatch()` (routes/api/catchall.ts) has no error boundary, so a
 * throw here would escape as Astro's HTML error page and break the JSON contract every
 * admin fetch depends on.
 */
function registryFailureResponse(request: Request): Response {
  return localizedJsonError(request, 'errors.loadGlobalBlocksRegistryFailed', 500);
}

/**
 * The declarative route inventory — 43 entries (GET 15, POST 12, PUT 8,
 * PATCH 1, DELETE 7). See spec's equivalence checklist for the full
 * method/path/auth inventory this mirrors.
 */
export const routes: RouteDescriptor[] = [
  // ─── GET (15) ───────────────────────────────────────────────────────────
  defineRoute({
    method: 'GET',
    pattern: 'auth/status',
    auth: 'public',
    handler: () => handlers.handleAuthStatus(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'auth/me',
    auth: 'public',
    handler: (ctx) => handlers.handleAuthMe(ctx.user ?? undefined, ctx.request),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'export',
    auth: 'owner',
    handler: (ctx) => handlers.handleExport(ctx.request, ctx.user),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'pages',
    auth: 'user',
    handler: (ctx) => handlers.handleGetPages(ctx.request),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'site',
    auth: 'user',
    handler: () => handlers.handleGetSite(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'menus',
    auth: 'user',
    handler: (ctx) => handlers.handleGetMenus(ctx.request),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'redirects',
    auth: 'user',
    handler: () => handlers.handleGetRedirects(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'configs',
    auth: 'user',
    handler: () => handlers.handleGetConfigs(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'users',
    auth: 'owner',
    handler: (ctx) => handlers.handleGetUsers(ctx.user),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'block-schemas',
    auth: 'user',
    handler: () => handlers.handleGetBlockSchemas(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'languages',
    auth: 'user',
    handler: () => handlers.handleGetLanguages(),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'media',
    auth: 'user',
    handler: (ctx) => handlers.handleGetMedia(ctx.request),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'media/:id/usage',
    auth: 'user',
    handler: (ctx) => handlers.handleGetMediaUsage(ctx.params.id, ctx.request),
  }),
  defineRoute({
    method: 'GET',
    pattern: 'global-blocks',
    auth: 'user',
    handler: async (ctx) => {
      const registry = await loadGlobalBlocksRegistry();
      if (!registry.ok) return registryFailureResponse(ctx.request);
      return handlers.handleGetGlobalBlocks(registry.entries, ctx.request);
    },
  }),
  defineRoute({
    method: 'GET',
    pattern: 'global-blocks/:id',
    auth: 'user',
    handler: async (ctx) => {
      const registry = await loadGlobalBlocksRegistry();
      if (!registry.ok) return registryFailureResponse(ctx.request);
      return handlers.handleGetGlobalBlock(ctx.params.id, registry.entries, ctx.request);
    },
  }),

  // ─── POST (12) ──────────────────────────────────────────────────────────
  defineRoute({
    method: 'POST',
    pattern: 'auth/login',
    auth: 'public',
    handler: (ctx) => handlers.handleLogin(ctx.request),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'import/bootstrap',
    auth: 'public',
    handler: (ctx) => handlers.handleBootstrapImport(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'pages',
    auth: 'user',
    handler: (ctx) => handlers.handlePostPages(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'menus',
    auth: 'user',
    handler: (ctx) => handlers.handlePostMenus(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'redirects',
    auth: 'user',
    handler: (ctx) => handlers.handlePostRedirects(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'configs',
    auth: 'user',
    handler: (ctx) => handlers.handlePostConfigs(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'upload',
    auth: 'user',
    handler: (ctx) => handlers.handleUpload(ctx.request),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'media/:id/replace',
    auth: 'user',
    handler: (ctx) => handlers.handleReplaceUpload(ctx.request, ctx.params.id),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'cache/invalidate',
    auth: 'user',
    handler: (ctx) => handlers.handleInvalidateCache(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'import',
    auth: 'owner',
    handler: (ctx) => handlers.handleImport(ctx.request, ctx.user, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'users',
    auth: 'owner',
    handler: (ctx) => handlers.handlePostUsers(ctx.request, ctx.user),
  }),
  defineRoute({
    method: 'POST',
    pattern: 'languages',
    auth: 'owner',
    handler: (ctx) => handlers.handlePostLanguages(ctx.request, { cache: ctx.cache }),
  }),

  // ─── PUT (8) ────────────────────────────────────────────────────────────
  defineRoute({
    method: 'PUT',
    pattern: 'pages/:id',
    auth: 'user',
    handler: (ctx) => handlers.handlePutPage(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'site',
    auth: 'owner',
    handler: (ctx) => handlers.handlePutSite(ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'menus/:id',
    auth: 'user',
    handler: (ctx) => handlers.handlePutMenu(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'redirects/:id',
    auth: 'user',
    handler: (ctx) => handlers.handlePutRedirect(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'configs/:id',
    auth: 'user',
    handler: (ctx) => handlers.handlePutConfig(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'users/:id',
    auth: 'owner',
    handler: (ctx) => handlers.handlePutUser(ctx.params.id, ctx.request, ctx.user),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'languages/:id',
    auth: 'owner',
    handler: (ctx) => handlers.handlePutLanguage(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'PUT',
    pattern: 'global-blocks/:id',
    auth: 'user',
    handler: async (ctx) => {
      const registry = await loadGlobalBlocksRegistry();
      if (!registry.ok) return registryFailureResponse(ctx.request);
      return handlers.handlePutGlobalBlock(
        ctx.params.id,
        ctx.request,
        { cache: ctx.cache },
        registry.entries,
      );
    },
  }),

  // ─── PATCH (1) ──────────────────────────────────────────────────────────
  defineRoute({
    method: 'PATCH',
    pattern: 'media/:id',
    auth: 'user',
    handler: (ctx) => handlers.handleUpdateMediaAlt(ctx.params.id, ctx.request),
  }),

  // ─── DELETE (7) ─────────────────────────────────────────────────────────
  defineRoute({
    method: 'DELETE',
    pattern: 'pages/:id',
    auth: 'user',
    handler: (ctx) => handlers.handleDeletePage(ctx.params.id, ctx.request, { cache: ctx.cache }),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'menus/:id',
    auth: 'user',
    handler: (ctx) => handlers.handleDeleteMenu(ctx.params.id, { cache: ctx.cache }, ctx.request),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'redirects/:id',
    auth: 'user',
    handler: (ctx) =>
      handlers.handleDeleteRedirect(ctx.params.id, { cache: ctx.cache }, ctx.request),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'configs/:id',
    auth: 'user',
    handler: (ctx) => handlers.handleDeleteConfig(ctx.params.id, { cache: ctx.cache }, ctx.request),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'users/:id',
    auth: 'owner',
    handler: (ctx) => handlers.handleDeleteUser(ctx.params.id, ctx.user, ctx.request),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'upload',
    auth: 'user',
    handler: (ctx) => handlers.handleDeleteUpload(ctx.request),
  }),
  defineRoute({
    method: 'DELETE',
    pattern: 'languages/:id',
    auth: 'owner',
    handler: (ctx) =>
      handlers.handleDeleteLanguage(ctx.params.id, { cache: ctx.cache }, ctx.request),
  }),
];
