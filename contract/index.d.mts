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
  options?: string[];
}

export type BlockSchema = Record<string, PropDef>;

export function defineBlockSchema(schema: BlockSchema): BlockSchema;

export const PROP_TYPES: readonly PropType[];
