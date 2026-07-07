/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { Site } from '../../types/index.js';
import * as data from '../data.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';
import { parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';

export async function handleGetSite(): Promise<Response> {
  return Response.json(await data.loadSite());
}

export async function handlePutSite(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Partial<Site>>(request);
  if (error || !body) return error as Response;

  const existing = await data.loadSite();
  const site = { ...existing, ...body };
  await data.saveSite(site);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(site);
}
