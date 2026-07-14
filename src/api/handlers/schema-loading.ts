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
 * The outcome of resolving the block schema map.
 *
 * A discriminated union, deliberately: the previous shape was
 * `{ schemaMap?; error?; missing? }` — both fields optional — so a caller could read
 * `result.schemaMap || null` and never look at the error. Four of eight call sites did
 * exactly that, and served pages projected against a `null` schema. The type is what
 * permitted it, so the type is what changed. Nothing compiles now without facing the
 * failure. See ADR-0025.
 *
 * - `unresolved` — neither the baked value nor the disk artifact yielded a map. The
 *   deployment is broken (ADR-0009's failure mode).
 * - `incomplete` — the map resolved, but declared blocks carry no schema. A consumer
 *   configuration error; `missing` names them.
 */
export type SchemaMapResult =
  | { ok: true; schemaMap: SchemaMap }
  | { ok: false; reason: 'unresolved' | 'incomplete'; missing: string[] };

/**
 * Resolves the block schema map for the precompiled API route.
 *
 * Primary: the map baked into the bundle at build time (vite.define). This is the robust
 * source in every deployment. Reading .astro-blocks/schema-map.mjs from disk (below) fails
 * whenever that gitignored build artifact is absent from the deployed server — which is
 * every deployed server. That was #101: page-save validation and the admin block picker
 * died in production while rendering worked via the bundled alias.
 *
 * Fallback: the filesystem read. It is the dev/test seam — `node --test` has no
 * `import.meta.env` — and never the mechanism. See ADR-0009 and ADR-0025.
 *
 * An empty map is a VALUE, not a failure: a project declaring no blocks bakes `"{}"`.
 * `ok: false` therefore means "unresolvable", never "empty".
 */
export async function loadSchemaMap(): Promise<SchemaMapResult> {
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
  } catch (error) {
    // NOT swallowed. The old `catch { return { error: 'Failed to load block schemas' } }`
    // told an operator nothing: it could not distinguish a missing artifact from a broken
    // one, and it hid the only fact that mattered — that this server was built without the
    // integration's bake and can never resolve schemas.
    console.error(
      '[astro-blocks] Could not resolve the block schema map. Neither the baked value ' +
        '(import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP) nor ' +
        `${schemaMapPath} resolved. On a deployed server this means the bundle was not built ` +
        'with the astro-blocks integration active — .astro-blocks/ is a gitignored build ' +
        'artifact and is never a resolution strategy. See ADR-0009 and ADR-0025.',
      error,
    );
    return { ok: false, reason: 'unresolved', missing: [] };
  }
}

function finalizeSchemaMap(schemaMap: SchemaMap): SchemaMapResult {
  const missing = Object.entries(schemaMap)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) return { ok: false, reason: 'incomplete', missing };

  return { ok: true, schemaMap };
}

/**
 * The 500 every handler returns when the schema map cannot be resolved.
 *
 * Reads included: a page list projected against a `null` schema serves silently mis-shaped
 * props (image values never coerced), from a server that will 500 on the very next save.
 * A half-working admin is a trap, not a degradation (ADR-0025).
 */
export function schemaMapFailureResponse(result: { missing: string[] }, request?: Request): Response {
  if (request) {
    return localizedJsonError(request, 'errors.loadBlockSchemasFailed', 500, undefined, {
      missing: result.missing,
    });
  }
  return jsonError('Failed to load block schemas', 500, { missing: result.missing });
}

export async function ensureValidBlocks(
  blocks: unknown,
  request?: Request,
): Promise<Response | null> {
  if (blocks === undefined) return null;

  if (!Array.isArray(blocks) || blocks.length > 0) {
    const result = await loadSchemaMap();
    if (!result.ok) return schemaMapFailureResponse(result, request);

    const validation = validateBlocks(result.schemaMap, blocks);
    if (validation) {
      if (request && validation.messageKey) {
        return localizedJsonError(request, validation.messageKey, 400, validation.params);
      }
      return jsonError(validation.message);
    }
  }

  return null;
}
