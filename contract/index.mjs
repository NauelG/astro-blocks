/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Block schema definition for Astro CMS.
 * Components in your project import defineBlockSchema and export a schema
 * so the CMS can generate the edit form and persist props.
 *
 * @typedef {'string'|'text'|'number'|'boolean'|'image'|'link'|'select'} PropType
 * @typedef {{ type: PropType, label: string, options?: string[] }} PropDef
 * @typedef {Record<string, PropDef>} BlockSchema
 */

/**
 * Define the editable props for a block component.
 * Use in your component: export const schema = defineBlockSchema({ ... })
 *
 * @param {BlockSchema} schema - Map of prop name to definition (type, label, optional options for select)
 * @returns {BlockSchema}
 */
export function defineBlockSchema(schema) {
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
