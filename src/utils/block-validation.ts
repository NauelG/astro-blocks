/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type {
  ArrayItemDef,
  ArrayPropDef,
  FileFieldValue,
  ObjectArrayItemDef,
  PrimitivePropDef,
  PrimitivePropType,
  PropDef,
} from '../types/index.js';

const PRIMITIVE_TYPES = new Set<PrimitivePropType>([
  'string',
  'text',
  'number',
  'boolean',
  'image',
  'link',
  'select',
  'file',
]);
// 'image' is intentionally NOT in STRING_LIKE_TYPES — image values are objects, not strings.
const STRING_LIKE_TYPES = new Set<PrimitivePropType>(['string', 'text', 'link', 'select']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function isValidSelectOptions(options: unknown): options is string[] {
  if (!Array.isArray(options)) return false;
  return options.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

export function isPrimitivePropType(type: unknown): type is PrimitivePropType {
  return typeof type === 'string' && PRIMITIVE_TYPES.has(type as PrimitivePropType);
}

export function isPrimitivePropDef(def: unknown): def is PrimitivePropDef {
  if (!isRecord(def)) return false;
  if (!isPrimitivePropType(def.type)) return false;
  if (typeof def.label !== 'string' || def.label.trim() === '') return false;
  if (def.options !== undefined && !isValidSelectOptions(def.options)) return false;
  return true;
}

export function isObjectArrayItemDef(def: unknown): def is ObjectArrayItemDef {
  if (!isRecord(def)) return false;
  if (def.type !== 'object') return false;
  if (typeof def.label !== 'string' || def.label.trim() === '') return false;
  if (!isRecord(def.fields)) return false;
  return Object.values(def.fields).every((fieldDef) => isPrimitivePropDef(fieldDef));
}

export function isArrayItemDef(def: unknown): def is ArrayItemDef {
  return isPrimitivePropDef(def) || isObjectArrayItemDef(def);
}

export function isArrayPropDef(def: unknown): def is ArrayPropDef {
  if (!isRecord(def)) return false;
  if (def.type !== 'array') return false;
  if (typeof def.label !== 'string' || def.label.trim() === '') return false;
  if (!isArrayItemDef(def.item)) return false;
  if (def.minItems !== undefined && normalizeCount(def.minItems) === null) return false;
  if (def.maxItems !== undefined && normalizeCount(def.maxItems) === null) return false;

  const minItems = normalizeCount(def.minItems);
  const maxItems = normalizeCount(def.maxItems);
  if (minItems !== null && maxItems !== null && minItems > maxItems) return false;

  return true;
}

// ─── Schema definition validation (developer/build-time, not user-facing) ────

function validatePrimitiveDefinition(
  def: PrimitivePropDef,
  schemaName: string,
  propName: string,
  fieldName?: string,
): string | null {
  const label = fieldName ? `field "${fieldName}" of "${propName}"` : `prop "${propName}"`;

  if (!isPrimitivePropType(def.type)) {
    return `Schema "${schemaName}": ${label} has an unsupported type.`;
  }

  if (typeof def.label !== 'string' || def.label.trim() === '') {
    return `Schema "${schemaName}": ${label} requires a non-empty label.`;
  }

  if (def.type === 'select' && def.options !== undefined && !isValidSelectOptions(def.options)) {
    return `Schema "${schemaName}": ${label} defines invalid options.`;
  }

  return null;
}

export function validateSchemaItemsDefinition(
  items: Record<string, unknown>,
  schemaName: string,
): string | null {
  for (const [propName, rawDef] of Object.entries(items || {})) {
    if (!isRecord(rawDef)) {
      return `Schema "${schemaName}": prop "${propName}" is invalid.`;
    }

    if (isPrimitivePropType(rawDef.type)) {
      const message = validatePrimitiveDefinition(
        rawDef as unknown as PrimitivePropDef,
        schemaName,
        propName,
      );
      if (message) return message;
      continue;
    }

    if (rawDef.type !== 'array') {
      return `Schema "${schemaName}": prop "${propName}" uses an unsupported type.`;
    }

    if (typeof rawDef.label !== 'string' || rawDef.label.trim() === '') {
      return `Schema "${schemaName}": prop "${propName}" requires a non-empty label.`;
    }

    const minItems = normalizeCount(rawDef.minItems);
    const maxItems = normalizeCount(rawDef.maxItems);

    if (rawDef.minItems !== undefined && minItems === null) {
      return `Schema "${schemaName}": prop "${propName}" has an invalid minItems value.`;
    }

    if (rawDef.maxItems !== undefined && maxItems === null) {
      return `Schema "${schemaName}": prop "${propName}" has an invalid maxItems value.`;
    }

    if (minItems !== null && maxItems !== null && minItems > maxItems) {
      return `Schema "${schemaName}": prop "${propName}" cannot have minItems greater than maxItems.`;
    }

    if (!Object.hasOwn(rawDef, 'item')) {
      return `Schema "${schemaName}": prop "${propName}" requires an item definition.`;
    }

    if (!isRecord(rawDef.item)) {
      return `Schema "${schemaName}": prop "${propName}" has an invalid item definition.`;
    }

    if (isPrimitivePropType(rawDef.item.type)) {
      const message = validatePrimitiveDefinition(
        rawDef.item as unknown as PrimitivePropDef,
        schemaName,
        propName,
      );
      if (message) return message;
      continue;
    }

    if (rawDef.item.type !== 'object') {
      return `Schema "${schemaName}": prop "${propName}" only supports primitive or object item types.`;
    }

    if (typeof rawDef.item.label !== 'string' || rawDef.item.label.trim() === '') {
      return `Schema "${schemaName}": prop "${propName}" requires a label on the object item.`;
    }

    if (!isRecord(rawDef.item.fields)) {
      return `Schema "${schemaName}": prop "${propName}" requires fields on the object item.`;
    }

    for (const [fieldName, rawFieldDef] of Object.entries(rawDef.item.fields)) {
      if (!isRecord(rawFieldDef)) {
        return `Schema "${schemaName}": prop "${propName}" has an invalid field definition ("${fieldName}").`;
      }

      if (!isPrimitivePropType(rawFieldDef.type)) {
        return `Schema "${schemaName}": prop "${propName}" does not support nested fields in an object item ("${fieldName}").`;
      }

      const message = validatePrimitiveDefinition(
        rawFieldDef as unknown as PrimitivePropDef,
        schemaName,
        propName,
        fieldName,
      );
      if (message) return message;
    }

    if (rawDef.item.summaryField !== undefined) {
      if (typeof rawDef.item.summaryField !== 'string' || rawDef.item.summaryField.trim() === '') {
        return `Schema "${schemaName}": prop "${propName}" has an invalid summaryField value.`;
      }

      if (!Object.hasOwn(rawDef.item.fields, rawDef.item.summaryField)) {
        return `Schema "${schemaName}": prop "${propName}" references a non-existent summaryField "${rawDef.item.summaryField}".`;
      }
    }
  }

  return null;
}

// ─── Block value validation (user-facing, fully i18n'd) ──────────────────────

/**
 * A block validation issue.
 *
 * `messageKey` and `params` are the canonical i18n representation:
 *   - Server callers use localizedJsonError(request, issue.messageKey, 400, issue.params)
 *   - Client callers use ct(issue.messageKey, issue.params)
 *
 * `message` is the English rendering of the issue for backward compat and
 * for callers that do not yet support i18n (e.g. validateBlocks in blocks.ts).
 */
export interface BlockValidationIssue {
  /** Catalog key for the user-facing message (i18n). */
  messageKey: string;
  /** Interpolation params for the catalog key. */
  params: Record<string, string | number>;
  /** English rendering of the issue (backward compat). */
  message: string;
  blockIndex?: number;
  propName?: string;
  itemIndex?: number;
  fieldName?: string;
}

/**
 * Minimal English catalog subset used to render the backward-compat `message`.
 * Keep in sync with blockValidation.* keys in routes/admin/i18n/en.ts.
 */
const EN_BLOCK_MESSAGES: Record<string, string> = {
  'blockValidation.fieldRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" is required.',
  'blockValidation.fieldMustBeImage':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be an image object.',
  'blockValidation.fieldImageNeedsUrl':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires a valid URL.',
  'blockValidation.fieldCannotBeEmpty':
    'Block "{blockName}" (index {blockIndex}): field "{label}" cannot be empty.',
  'blockValidation.fieldAltMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — alt must be text.',
  'blockValidation.fieldCaptionMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — caption must be text.',
  'blockValidation.fieldDimInvalid':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — {dim} must be a positive integer (> 0).',
  'blockValidation.fieldMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be text.',
  'blockValidation.fieldInvalidOption':
    'Block "{blockName}" (index {blockIndex}): field "{label}" has an invalid option.',
  'blockValidation.fieldMustBeNumber':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a valid number.',
  'blockValidation.fieldMustBeBoolean':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a boolean.',
  'blockValidation.fieldMustBeFile':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a file object.',
  'blockValidation.fieldFileNeedsUrl':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires a valid URL.',
  'blockValidation.arrayMustContainObjects':
    'Block "{blockName}" (index {blockIndex}): "{label}" must contain valid objects.',
  'blockValidation.arrayRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires at least {min} item(s).',
  'blockValidation.arrayMustBeArray':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be an array.',
  'blockValidation.arrayMinItems':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires at least {min} item(s).',
  'blockValidation.arrayMaxItems':
    'Block "{blockName}" (index {blockIndex}): field "{label}" allows at most {max} item(s).',
  'blockValidation.arrayIsRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" is required.',
};

/** Interpolate a template string with params (same logic as routes/admin/i18n/t.ts). */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/** Build an English message string from the catalog key + params. */
function enMessage(messageKey: string, params: Record<string, string | number>): string {
  const template = EN_BLOCK_MESSAGES[messageKey] ?? messageKey;
  return interpolate(template, params);
}

function issue(
  messageKey: string,
  params: Record<string, string | number>,
  blockIndex: number,
  propName: string,
  itemIndex?: number,
  fieldName?: string,
): BlockValidationIssue {
  return {
    messageKey,
    params,
    message: enMessage(messageKey, params),
    blockIndex,
    propName,
    ...(itemIndex !== undefined && { itemIndex }),
    ...(fieldName && { fieldName }),
  };
}

function validatePrimitiveValue(
  def: PrimitivePropDef,
  value: unknown,
  blockName: string,
  blockIndex: number,
  propName: string,
  label: string,
  required: boolean,
  itemIndex?: number,
  fieldName?: string,
): BlockValidationIssue | null {
  const base = { blockName, blockIndex: String(blockIndex), label };

  // Image-type: handled entirely in its own branch before the generic empty check.
  // A plain string for an image field is ALWAYS invalid (per REQ-2 SC-2.4), even when
  // required=false — validation receives already-coerced values, never raw strings.
  if (def.type === 'image') {
    // null/undefined → truly no value → empty
    if (value === null || value === undefined) {
      if (required) {
        return issue(
          'blockValidation.fieldRequired',
          base,
          blockIndex,
          propName,
          itemIndex,
          fieldName,
        );
      }
      return null;
    }

    // Any non-object (incl. string) → always an error
    if (!isRecord(value)) {
      return issue(
        'blockValidation.fieldMustBeImage',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    const imgVal = value as Record<string, unknown>;
    if (typeof imgVal.url !== 'string') {
      return issue(
        'blockValidation.fieldImageNeedsUrl',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (required && imgVal.url.trim() === '') {
      return issue(
        'blockValidation.fieldCannotBeEmpty',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (imgVal.alt !== undefined && typeof imgVal.alt !== 'string') {
      return issue(
        'blockValidation.fieldAltMustBeText',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (imgVal.caption !== undefined && typeof imgVal.caption !== 'string') {
      return issue(
        'blockValidation.fieldCaptionMustBeText',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    for (const dim of ['width', 'height'] as const) {
      const v = imgVal[dim];
      if (v !== undefined) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
          return issue(
            'blockValidation.fieldDimInvalid',
            { ...base, dim },
            blockIndex,
            propName,
            itemIndex,
            fieldName,
          );
        }
      }
    }
    return null;
  }

  // File-type: handled entirely in its own branch before the generic empty check.
  // A plain string for a file field is ALWAYS invalid — file values are objects.
  if (def.type === 'file') {
    // null/undefined → truly no value → empty
    if (value === null || value === undefined) {
      if (required) {
        return issue(
          'blockValidation.fieldRequired',
          base,
          blockIndex,
          propName,
          itemIndex,
          fieldName,
        );
      }
      return null;
    }

    // Any non-object (incl. string) → always an error
    if (!isRecord(value)) {
      return issue(
        'blockValidation.fieldMustBeFile',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    // Cast through unknown: at this point we know value is Record<string,unknown>,
    // and we validate each field manually below before trusting the shape.
    const fileVal = value as unknown as FileFieldValue;
    if (typeof fileVal.url !== 'string') {
      return issue(
        'blockValidation.fieldFileNeedsUrl',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (required && fileVal.url.trim() === '') {
      return issue(
        'blockValidation.fieldCannotBeEmpty',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (fileVal.filename !== undefined && typeof fileVal.filename !== 'string') {
      return issue(
        'blockValidation.fieldMustBeFile',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (fileVal.mimeType !== undefined && typeof fileVal.mimeType !== 'string') {
      return issue(
        'blockValidation.fieldMustBeFile',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    if (fileVal.download !== undefined && typeof fileVal.download !== 'boolean') {
      return issue(
        'blockValidation.fieldMustBeFile',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    return null;
  }

  // Generic empty check for non-image types
  const empty = value === undefined || value === null || value === '';
  if (empty) {
    if (required) {
      return issue(
        'blockValidation.fieldRequired',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    return null;
  }

  if (STRING_LIKE_TYPES.has(def.type)) {
    if (typeof value !== 'string') {
      return issue(
        'blockValidation.fieldMustBeText',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }

    if (required && value.trim() === '') {
      return issue(
        'blockValidation.fieldCannotBeEmpty',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }

    if (
      def.type === 'select' &&
      Array.isArray(def.options) &&
      value &&
      !def.options.includes(value)
    ) {
      return issue(
        'blockValidation.fieldInvalidOption',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }

    return null;
  }

  if (def.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return issue(
        'blockValidation.fieldMustBeNumber',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
    return null;
  }

  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return issue(
        'blockValidation.fieldMustBeBoolean',
        base,
        blockIndex,
        propName,
        itemIndex,
        fieldName,
      );
    }
  }

  return null;
}

function validateArrayItems(
  def: ArrayPropDef,
  values: unknown[],
  blockName: string,
  blockIndex: number,
  propName: string,
): BlockValidationIssue | null {
  if (isPrimitivePropDef(def.item)) {
    const primitive = def.item;

    for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
      const value = values[itemIndex];
      const required = primitive.required !== false;
      const itemLabel = `${def.label} · element ${itemIndex + 1}`;
      const valueIssue = validatePrimitiveValue(
        primitive,
        value,
        blockName,
        blockIndex,
        propName,
        itemLabel,
        required,
        itemIndex,
      );
      if (valueIssue) return valueIssue;
    }

    return null;
  }

  for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
    const rawItem = values[itemIndex];
    if (!isRecord(rawItem)) {
      return issue(
        'blockValidation.arrayMustContainObjects',
        { blockName, blockIndex: String(blockIndex), label: def.label },
        blockIndex,
        propName,
        itemIndex,
      );
    }

    for (const [fieldName, fieldDef] of Object.entries(def.item.fields || {})) {
      const fieldLabel = `${def.label} · element ${itemIndex + 1} · ${fieldDef.label || fieldName}`;
      const fieldIssue = validatePrimitiveValue(
        fieldDef,
        rawItem[fieldName],
        blockName,
        blockIndex,
        propName,
        fieldLabel,
        fieldDef.required === true,
        itemIndex,
        fieldName,
      );
      if (fieldIssue) return fieldIssue;
    }
  }

  return null;
}

export function validateBlockPropsAgainstSchema(
  blockName: string,
  blockIndex: number,
  schemaItems: Record<string, PropDef>,
  blockProps: Record<string, unknown>,
): BlockValidationIssue | null {
  for (const [propName, def] of Object.entries(schemaItems || {})) {
    if (def.type === 'array') {
      const value = blockProps[propName];
      const minItems = normalizeCount(def.minItems);
      const maxItems = normalizeCount(def.maxItems);

      if (value === undefined || value === null) {
        if (def.required === true || (minItems !== null && minItems > 0)) {
          return issue(
            'blockValidation.arrayRequired',
            {
              blockName,
              blockIndex: String(blockIndex),
              label: def.label || propName,
              min: minItems || 1,
            },
            blockIndex,
            propName,
          );
        }
        continue;
      }

      if (!Array.isArray(value)) {
        return issue(
          'blockValidation.arrayMustBeArray',
          { blockName, blockIndex: String(blockIndex), label: def.label || propName },
          blockIndex,
          propName,
        );
      }

      if (def.required === true && value.length === 0) {
        return issue(
          'blockValidation.arrayIsRequired',
          { blockName, blockIndex: String(blockIndex), label: def.label || propName },
          blockIndex,
          propName,
        );
      }

      if (minItems !== null && value.length < minItems) {
        return issue(
          'blockValidation.arrayMinItems',
          {
            blockName,
            blockIndex: String(blockIndex),
            label: def.label || propName,
            min: minItems,
          },
          blockIndex,
          propName,
        );
      }

      if (maxItems !== null && value.length > maxItems) {
        return issue(
          'blockValidation.arrayMaxItems',
          {
            blockName,
            blockIndex: String(blockIndex),
            label: def.label || propName,
            max: maxItems,
          },
          blockIndex,
          propName,
        );
      }

      const itemIssue = validateArrayItems(def, value, blockName, blockIndex, propName);
      if (itemIssue) return itemIssue;
      continue;
    }

    const value = blockProps[propName];
    const fieldIssue = validatePrimitiveValue(
      def,
      value,
      blockName,
      blockIndex,
      propName,
      def.label || propName,
      def.required === true,
    );
    if (fieldIssue) return fieldIssue;
  }

  return null;
}
