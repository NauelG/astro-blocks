/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export type PropType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'image'
  | 'link'
  | 'select';

export interface PropDef {
  type: PropType;
  label: string;
  required?: boolean;
  options?: string[];
}

export interface BlockDefinition {
  name: string;
  icon?: string;
  key?: string;
  items: Record<string, PropDef>;
}

/** Internal key where the component path is stored. Plugin reads this; API must not expose it. */
export const COMPONENT_PATH_KEY: '__componentPath';

export interface BlockSchema extends BlockDefinition {
  __componentPath?: string;
}

export function defineBlockSchema(definition: BlockDefinition, componentUrl?: string | URL): BlockSchema;

export const PROP_TYPES: readonly PropType[];
