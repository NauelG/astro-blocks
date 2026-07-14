/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBlocks } from '../../utils/blocks.js';
import { getProjectRoot } from '../../utils/paths.js';
import type { SchemaMap } from '../../types/index.js';
import { jsonError, localizedJsonError } from './shared.js';

export async function loadSchemaMap(): Promise<{
  schemaMap?: SchemaMap;
  error?: string;
  missing?: string[];
}> {
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

export async function ensureValidBlocks(
  blocks: unknown,
  request?: Request,
): Promise<Response | null> {
  if (blocks === undefined) return null;

  if (!Array.isArray(blocks) || blocks.length > 0) {
    const result = await loadSchemaMap();
    if (result.error) {
      if (request)
        return localizedJsonError(request, 'errors.loadBlockSchemasFailed', 500, undefined, {
          missing: result.missing || [],
        });
      return jsonError(result.error, 500, { missing: result.missing || [] });
    }

    const validation = validateBlocks(result.schemaMap || {}, blocks);
    if (validation) {
      if (request && validation.messageKey) {
        return localizedJsonError(request, validation.messageKey, 400, validation.params);
      }
      return jsonError(validation.message);
    }
  }

  return null;
}
