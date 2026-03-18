/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { BlockDefinition, BlockSchema, PropType } from '../types/index.js';

export type {
  BlockDefinition,
  BlockInstance,
  BlockSchema,
  PropDef,
  PropType,
  SchemaMap,
  SerializedSchema,
} from '../types/index.js';

/** Internal key where the component path (from componentUrl) is stored. Plugin reads this; API must not expose it. */
export const COMPONENT_PATH_KEY = '__componentPath' as const;

/**
 * Define the block schema. Call from your component with import.meta.url so the
 * plugin can resolve the component path.
 */
export function defineBlockSchema(definition: BlockDefinition, componentUrl?: string | URL): BlockSchema {
  const schema: BlockSchema = { ...definition };

  if (componentUrl !== undefined && componentUrl !== null) {
    const componentPath =
      typeof componentUrl === 'string'
        ? componentUrl
        : componentUrl && typeof componentUrl.href === 'string'
          ? componentUrl.href
          : '';

    if (componentPath) {
      schema[COMPONENT_PATH_KEY] = componentPath;
    }
  }

  return schema;
}

export const PROP_TYPES: readonly PropType[] = [
  'string',
  'text',
  'number',
  'boolean',
  'image',
  'link',
  'select',
] as const;
