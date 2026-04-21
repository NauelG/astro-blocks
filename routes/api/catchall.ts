/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { APIContext } from 'astro';
import * as handlers from '../../api/handlers.js';
import type { GlobalBlockRuntimeEntry } from '../../types/index.js';

export const prerender = false;

async function loadGlobalBlocksRegistry(): Promise<GlobalBlockRuntimeEntry[]> {
  try {
    const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
    const runtimePath = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');
    const runtimeUrl = pathToFileURL(runtimePath).href;
    const mod = (await import(/* @vite-ignore */ runtimeUrl)) as { globalBlocksRegistry?: GlobalBlockRuntimeEntry[] };
    return mod.globalBlocksRegistry ?? [];
  } catch {
    return [];
  }
}

function getPathSegments(url: string): string[] {
  const pathname = new URL(url).pathname;
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(2);
}

async function ensureAuth(request: Request): Promise<{ status: 401; body: { error: string } } | { user: NonNullable<Awaited<ReturnType<typeof handlers.getAuth>>>['user'] }> {
  const auth = await handlers.getAuth(request);
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };
  return { user: auth.user };
}

export async function GET({ request }: APIContext): Promise<Response> {
  const seg = getPathSegments(request.url);

  if (seg[0] === 'auth' && seg[1] === 'status' && seg.length === 2) return handlers.handleAuthStatus();
  if (seg[0] === 'auth' && seg[1] === 'me' && seg.length === 2) {
    const auth = await handlers.getAuth(request);
    return handlers.handleAuthMe(auth?.user);
  }

  const authResult = await ensureAuth(request);
  if ('status' in authResult) return new Response(JSON.stringify(authResult.body), { status: 401 });

  if (seg[0] === 'pages' && seg.length === 1) return handlers.handleGetPages(request);
  if (seg[0] === 'site' && seg.length === 1) return handlers.handleGetSite();
  if (seg[0] === 'menus' && seg.length === 1) return handlers.handleGetMenus(request);
  if (seg[0] === 'redirects' && seg.length === 1) return handlers.handleGetRedirects();
  if (seg[0] === 'configs' && seg.length === 1) return handlers.handleGetConfigs();
  if (seg[0] === 'users' && seg.length === 1) return handlers.handleGetUsers(authResult.user);
  if (seg[0] === 'block-schemas' && seg.length === 1) return handlers.handleGetBlockSchemas();
  if (seg[0] === 'languages' && seg.length === 1) return handlers.handleGetLanguages();
  if (seg[0] === 'global-blocks' && seg.length === 1) {
    const registry = await loadGlobalBlocksRegistry();
    return handlers.handleGetGlobalBlocks(registry, request);
  }
  if (seg[0] === 'global-blocks' && seg.length === 2) {
    const registry = await loadGlobalBlocksRegistry();
    return handlers.handleGetGlobalBlock(seg[1], registry, request);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function POST({ request, cache }: APIContext): Promise<Response> {
  const seg = getPathSegments(request.url);

  if (seg[0] === 'auth' && seg[1] === 'login' && seg.length === 2) return handlers.handleLogin(request);

  const authResult = await ensureAuth(request);
  if ('status' in authResult) return new Response(JSON.stringify(authResult.body), { status: 401 });

  if (seg[0] === 'pages' && seg.length === 1) return handlers.handlePostPages(request, { cache });
  if (seg[0] === 'menus' && seg.length === 1) return handlers.handlePostMenus(request, { cache });
  if (seg[0] === 'redirects' && seg.length === 1) return handlers.handlePostRedirects(request, { cache });
  if (seg[0] === 'configs' && seg.length === 1) return handlers.handlePostConfigs(request, { cache });
  if (seg[0] === 'upload' && seg.length === 1) return handlers.handleUpload(request);
  if (seg[0] === 'cache' && seg[1] === 'invalidate' && seg.length === 2) return handlers.handleInvalidateCache({ cache });
  if (seg[0] === 'users' && seg.length === 1) return handlers.handlePostUsers(request, authResult.user);
  if (seg[0] === 'languages' && seg.length === 1) {
    const forbidden = handlers.requireOwner(authResult.user);
    if (forbidden) return forbidden;
    return handlers.handlePostLanguages(request, { cache });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function PUT({ request, cache }: APIContext): Promise<Response> {
  const authResult = await ensureAuth(request);
  if ('status' in authResult) return new Response(JSON.stringify(authResult.body), { status: 401 });

  const seg = getPathSegments(request.url);

  if (seg[0] === 'pages' && seg.length === 2) return handlers.handlePutPage(seg[1], request, { cache });
  if (seg[0] === 'site' && seg.length === 1) {
    const forbidden = handlers.requireOwner(authResult.user);
    if (forbidden) return forbidden;
    return handlers.handlePutSite(request, { cache });
  }
  if (seg[0] === 'menus' && seg.length === 2) return handlers.handlePutMenu(seg[1], request, { cache });
  if (seg[0] === 'redirects' && seg.length === 2) return handlers.handlePutRedirect(seg[1], request, { cache });
  if (seg[0] === 'configs' && seg.length === 2) return handlers.handlePutConfig(seg[1], request, { cache });
  if (seg[0] === 'users' && seg.length === 2) return handlers.handlePutUser(seg[1], request, authResult.user);
  if (seg[0] === 'languages' && seg.length === 2) {
    const forbidden = handlers.requireOwner(authResult.user);
    if (forbidden) return forbidden;
    return handlers.handlePutLanguage(seg[1], request, { cache });
  }
  if (seg[0] === 'global-blocks' && seg.length === 2) {
    const registry = await loadGlobalBlocksRegistry();
    return handlers.handlePutGlobalBlock(seg[1], request, { cache }, registry);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function DELETE({ request, cache }: APIContext): Promise<Response> {
  const authResult = await ensureAuth(request);
  if ('status' in authResult) return new Response(JSON.stringify(authResult.body), { status: 401 });

  const seg = getPathSegments(request.url);

  if (seg[0] === 'pages' && seg.length === 2) return handlers.handleDeletePage(seg[1], request, { cache });
  if (seg[0] === 'menus' && seg.length === 2) return handlers.handleDeleteMenu(seg[1], { cache });
  if (seg[0] === 'redirects' && seg.length === 2) return handlers.handleDeleteRedirect(seg[1], { cache });
  if (seg[0] === 'configs' && seg.length === 2) return handlers.handleDeleteConfig(seg[1], { cache });
  if (seg[0] === 'users' && seg.length === 2) return handlers.handleDeleteUser(seg[1], authResult.user);
  if (seg[0] === 'upload' && seg.length === 1) return handlers.handleDeleteUpload(request);
  if (seg[0] === 'languages' && seg.length === 2) {
    const forbidden = handlers.requireOwner(authResult.user);
    if (forbidden) return forbidden;
    return handlers.handleDeleteLanguage(seg[1], { cache });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}
