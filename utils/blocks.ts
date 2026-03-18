/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_PATH_KEY } from '../contract/index.js';
import type { BlockInstance, BlockSchema, SchemaMap, SerializedSchema } from '../types/index.js';

export interface ResolvedBlockEntry {
  key: string;
  schema: BlockSchema;
  resolvedPath: string;
}

export function serializeSchema(schema: BlockSchema): SerializedSchema | null {
  if (!schema || typeof schema !== 'object') return null;

  return {
    name: schema.name,
    ...(schema.icon !== undefined && { icon: schema.icon }),
    items: schema.items && typeof schema.items === 'object' ? schema.items : {},
  };
}

export function getBlockKey(schema: BlockSchema, resolvedPath: string): string {
  return typeof schema.key === 'string' && schema.key.trim()
    ? schema.key.trim()
    : path.basename(resolvedPath, '.astro');
}

export function resolveBlockEntries(projectRoot: string, blocks: BlockSchema[]): ResolvedBlockEntry[] {
  const seenKeys = new Set<string>();

  return blocks.map((schema, index) => {
    const componentPathUrl = schema[COMPONENT_PATH_KEY];

    if (componentPathUrl === undefined || componentPathUrl === null || String(componentPathUrl).trim() === '') {
      const name = schema.name || `block at index ${index}`;
      throw new Error(
        `[astro-blocks] Block schema for "${name}" is missing component path. Use defineBlockSchema(definition, import.meta.url) in the component.`
      );
    }

    const resolvedPath =
      typeof componentPathUrl === 'string' && componentPathUrl.startsWith('file:')
        ? fileURLToPath(componentPathUrl)
        : path.resolve(projectRoot, String(componentPathUrl));

    const key = getBlockKey(schema, resolvedPath);

    if (seenKeys.has(key)) {
      throw new Error(`[astro-blocks] Duplicate block key: ${key}. Use schema.key to disambiguate or rename the component file.`);
    }

    seenKeys.add(key);
    return { key, schema, resolvedPath };
  });
}

export function buildSchemaMap(entries: ResolvedBlockEntry[]): SchemaMap {
  return entries.reduce<SchemaMap>((acc, entry) => {
    const serialized = serializeSchema(entry.schema);
    if (serialized) acc[entry.key] = serialized;
    return acc;
  }, {});
}

export function validateBlocks(schemaMap: SchemaMap, blocks: unknown): { message: string } | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index] as Partial<BlockInstance> | null;
    const type = block && typeof block === 'object' ? block.type : undefined;

    if (typeof type !== 'string' || type.trim() === '') {
      return { message: `Block at index ${index}: missing or invalid type.` };
    }

    const schema = schemaMap[type];
    if (!schema || !schema.items) {
      return { message: `Block at index ${index}: unknown type "${type}".` };
    }

    const props = block?.props && typeof block.props === 'object' ? block.props : {};

    for (const [propName, def] of Object.entries(schema.items)) {
      if (!def || def.required !== true) continue;

      const value = (props as Record<string, unknown>)[propName];
      if (value === undefined || value === null) {
        return { message: `Block "${schema.name}" (index ${index}): required prop "${propName}" is missing.` };
      }

      if ((def.type === 'string' || def.type === 'text') && (typeof value !== 'string' || value.trim() === '')) {
        return { message: `Block "${schema.name}" (index ${index}): required prop "${propName}" must be non-empty.` };
      }

      if (def.type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
        return { message: `Block "${schema.name}" (index ${index}): required prop "${propName}" must be a valid number.` };
      }
    }
  }

  return null;
}
