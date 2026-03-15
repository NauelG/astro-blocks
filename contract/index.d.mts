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
