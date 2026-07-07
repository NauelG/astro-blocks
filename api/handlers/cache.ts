/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { getGlobalCachePaths, getGlobalCacheTags } from '../../utils/cache.js';
import { localizedJsonError } from './shared.js';
import type { HandlerContext } from './shared.js';

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
