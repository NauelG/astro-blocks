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

/**
 * Resolves the block schema map for the precompiled API route.
 *
 * Primary: the map baked into the bundle at build time (vite.define). This is the
 * robust source in every deployment. Reading .astro-blocks/schema-map.mjs from disk
 * (below) fails whenever that gitignored build artifact is absent from the deployed
 * server — which is every deployed server. That was #101: page-save validation and the
 * admin block picker died in production while rendering worked via the bundled alias.
 *
 * Fallback: the filesystem read. It is the dev/test seam — `node --test` has no
 * `import.meta.env` — and never the mechanism. See ADR-0009 and ADR-0025.
 */
export async function loadSchemaMap(): Promise<{
  schemaMap?: SchemaMap;
  error?: string;
  missing?: string[];
}> {
  const baked = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env
    ?.ASTRO_BLOCKS_SCHEMA_MAP;
  if (typeof baked === 'string' && baked.length > 0) {
    try {
      const parsed = JSON.parse(baked) as SchemaMap;
      if (parsed && typeof parsed === 'object') return finalizeSchemaMap(parsed);
    } catch {
      // Malformed bake — fall through to the filesystem read.
    }
  }

  const projectRoot = getProjectRoot();
  const schemaMapPath = path.join(projectRoot, '.astro-blocks', 'schema-map.mjs');

  try {
    const schemaMapUrl = pathToFileURL(schemaMapPath).href;
    const mod = (await import(/* @vite-ignore */ schemaMapUrl)) as { schemaMap?: SchemaMap };
    return finalizeSchemaMap(mod.schemaMap || {});
  } catch {
    return { error: 'Failed to load block schemas', missing: [] };
  }
}

function finalizeSchemaMap(schemaMap: SchemaMap): {
  schemaMap?: SchemaMap;
  error?: string;
  missing?: string[];
} {
  const missing = Object.entries(schemaMap)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) return { error: 'Missing block schema', missing };

  return { schemaMap };
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
