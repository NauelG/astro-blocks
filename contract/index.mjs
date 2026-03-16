/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Block schema definition for AstroBlocks.
 * Each block component must export a schema via defineBlockSchema(definition, import.meta.url).
 * The project config passes the imported schemas in astroBlocks({ blocks: [schema1, schema2, ...] }).
 *
 * @typedef {'string'|'text'|'number'|'boolean'|'image'|'link'|'select'} PropType
 * @typedef {{ type: PropType, label: string, required?: boolean, options?: string[] }} PropDef
 * @typedef {{ name: string, icon?: string, key?: string, items: Record<string, PropDef> }} BlockDefinition
 * @typedef {BlockDefinition & { [COMPONENT_PATH_KEY]: string }} BlockSchema
 */

/** Internal key where the component path (from componentUrl) is stored. Plugin reads this; API must not expose it. */
export const COMPONENT_PATH_KEY = '__componentPath';

/**
 * Define the block schema. Call from your component with import.meta.url so the plugin can resolve the component path.
 *
 * @param {BlockDefinition} definition - name (display name), optional icon (Lucide icon name), optional key (block type id), items (prop definitions)
 * @param {string | URL} [componentUrl] - Typically import.meta.url; stored internally for the plugin
 * @returns {BlockSchema}
 *
 * @example
 * export const schema = defineBlockSchema(
 *   { name: 'Hero', icon: 'Layout', items: { title: { type: 'string', label: 'Título', required: true } } },
 *   import.meta.url
 * );
 */
export function defineBlockSchema(definition, componentUrl) {
  const schema = { ...definition };
  if (componentUrl !== undefined && componentUrl !== null) {
    const path =
      typeof componentUrl === 'string' ? componentUrl : (componentUrl && typeof componentUrl.href === 'string' ? componentUrl.href : '');
    if (path) schema[COMPONENT_PATH_KEY] = path;
  }
  return schema;
}

export const PROP_TYPES = /** @type {const} */ ([
  'string',
  'text',
  'number',
  'boolean',
  'image',
  'link',
  'select',
]);
