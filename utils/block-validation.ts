/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ArrayItemDef, ArrayPropDef, ObjectArrayItemDef, PrimitivePropDef, PrimitivePropType, PropDef } from '../types/index.js';

const PRIMITIVE_TYPES = new Set<PrimitivePropType>(['string', 'text', 'number', 'boolean', 'image', 'link', 'select']);
const STRING_LIKE_TYPES = new Set<PrimitivePropType>(['string', 'text', 'image', 'link', 'select']);

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

function validatePrimitiveDefinition(
  def: PrimitivePropDef,
  schemaName: string,
  propName: string,
  fieldName?: string
): string | null {
  const label = fieldName ? `campo "${fieldName}" de "${propName}"` : `prop "${propName}"`;

  if (!isPrimitivePropType(def.type)) {
    return `Schema "${schemaName}": ${label} tiene un tipo no soportado.`;
  }

  if (typeof def.label !== 'string' || def.label.trim() === '') {
    return `Schema "${schemaName}": ${label} requiere un label no vacío.`;
  }

  if (def.type === 'select' && def.options !== undefined && !isValidSelectOptions(def.options)) {
    return `Schema "${schemaName}": ${label} define options inválidas.`;
  }

  return null;
}

export function validateSchemaItemsDefinition(items: Record<string, unknown>, schemaName: string): string | null {
  for (const [propName, rawDef] of Object.entries(items || {})) {
    if (!isRecord(rawDef)) {
      return `Schema "${schemaName}": prop "${propName}" inválida.`;
    }

    if (isPrimitivePropType(rawDef.type)) {
      const message = validatePrimitiveDefinition(rawDef as unknown as PrimitivePropDef, schemaName, propName);
      if (message) return message;
      continue;
    }

    if (rawDef.type !== 'array') {
      return `Schema "${schemaName}": prop "${propName}" usa un tipo no soportado.`;
    }

    if (typeof rawDef.label !== 'string' || rawDef.label.trim() === '') {
      return `Schema "${schemaName}": prop "${propName}" requiere un label no vacío.`;
    }

    const minItems = normalizeCount(rawDef.minItems);
    const maxItems = normalizeCount(rawDef.maxItems);

    if (rawDef.minItems !== undefined && minItems === null) {
      return `Schema "${schemaName}": prop "${propName}" tiene minItems inválido.`;
    }

    if (rawDef.maxItems !== undefined && maxItems === null) {
      return `Schema "${schemaName}": prop "${propName}" tiene maxItems inválido.`;
    }

    if (minItems !== null && maxItems !== null && minItems > maxItems) {
      return `Schema "${schemaName}": prop "${propName}" no puede tener minItems mayor que maxItems.`;
    }

    if (!Object.prototype.hasOwnProperty.call(rawDef, 'item')) {
      return `Schema "${schemaName}": prop "${propName}" requiere item.`;
    }

    if (!isRecord(rawDef.item)) {
      return `Schema "${schemaName}": prop "${propName}" tiene un item inválido.`;
    }

    if (isPrimitivePropType(rawDef.item.type)) {
      const message = validatePrimitiveDefinition(rawDef.item as unknown as PrimitivePropDef, schemaName, propName);
      if (message) return message;
      continue;
    }

    if (rawDef.item.type !== 'object') {
      return `Schema "${schemaName}": prop "${propName}" solo soporta item primitivo u object en Fase 1.`;
    }

    if (typeof rawDef.item.label !== 'string' || rawDef.item.label.trim() === '') {
      return `Schema "${schemaName}": prop "${propName}" requiere label en item object.`;
    }

    if (!isRecord(rawDef.item.fields)) {
      return `Schema "${schemaName}": prop "${propName}" requiere fields en item object.`;
    }

    for (const [fieldName, rawFieldDef] of Object.entries(rawDef.item.fields)) {
      if (!isRecord(rawFieldDef)) {
        return `Schema "${schemaName}": prop "${propName}" tiene un field inválido ("${fieldName}").`;
      }

      if (!isPrimitivePropType(rawFieldDef.type)) {
        return `Schema "${schemaName}": prop "${propName}" no soporta fields anidados en item object ("${fieldName}").`;
      }

      const message = validatePrimitiveDefinition(rawFieldDef as unknown as PrimitivePropDef, schemaName, propName, fieldName);
      if (message) return message;
    }

    if (rawDef.item.summaryField !== undefined) {
      if (typeof rawDef.item.summaryField !== 'string' || rawDef.item.summaryField.trim() === '') {
        return `Schema "${schemaName}": prop "${propName}" tiene summaryField inválido.`;
      }

      if (!Object.prototype.hasOwnProperty.call(rawDef.item.fields, rawDef.item.summaryField)) {
        return `Schema "${schemaName}": prop "${propName}" usa summaryField "${rawDef.item.summaryField}" inexistente.`;
      }
    }
  }

  return null;
}

export interface BlockValidationIssue {
  message: string;
  blockIndex?: number;
  propName?: string;
  itemIndex?: number;
  fieldName?: string;
}

function issue(
  message: string,
  blockIndex: number,
  propName: string,
  itemIndex?: number,
  fieldName?: string
): BlockValidationIssue {
  return { message, blockIndex, propName, ...(itemIndex !== undefined && { itemIndex }), ...(fieldName && { fieldName }) };
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
  fieldName?: string
): BlockValidationIssue | null {
  const empty = value === undefined || value === null || value === '';
  if (empty) {
    if (required) {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" es obligatorio.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
      );
    }
    return null;
  }

  if (STRING_LIKE_TYPES.has(def.type)) {
    if (typeof value !== 'string') {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" debe ser texto.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
      );
    }

    if (required && value.trim() === '') {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" no puede estar vacío.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
      );
    }

    if (def.type === 'select' && Array.isArray(def.options) && value && !def.options.includes(value)) {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" tiene una opción no válida.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
      );
    }

    return null;
  }

  if (def.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" debe ser un número válido.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
      );
    }
    return null;
  }

  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): el campo "${label}" debe ser booleano.`,
        blockIndex,
        propName,
        itemIndex,
        fieldName
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
  propName: string
): BlockValidationIssue | null {
  if (isPrimitivePropDef(def.item)) {
    const primitive = def.item;

    for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
      const value = values[itemIndex];
      const required = primitive.required !== false;
      const itemLabel = `${def.label} · elemento ${itemIndex + 1}`;
      const valueIssue = validatePrimitiveValue(
        primitive,
        value,
        blockName,
        blockIndex,
        propName,
        itemLabel,
        required,
        itemIndex
      );
      if (valueIssue) return valueIssue;
    }

    return null;
  }

  for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
    const rawItem = values[itemIndex];
    if (!isRecord(rawItem)) {
      return issue(
        `Bloque "${blockName}" (índice ${blockIndex}): "${def.label}" debe contener objetos válidos.`,
        blockIndex,
        propName,
        itemIndex
      );
    }

    for (const [fieldName, fieldDef] of Object.entries(def.item.fields || {})) {
      const fieldLabel = `${def.label} · elemento ${itemIndex + 1} · ${fieldDef.label || fieldName}`;
      const fieldIssue = validatePrimitiveValue(
        fieldDef,
        rawItem[fieldName],
        blockName,
        blockIndex,
        propName,
        fieldLabel,
        fieldDef.required === true,
        itemIndex,
        fieldName
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
  blockProps: Record<string, unknown>
): BlockValidationIssue | null {
  for (const [propName, def] of Object.entries(schemaItems || {})) {
    if (def.type === 'array') {
      const value = blockProps[propName];
      const minItems = normalizeCount(def.minItems);
      const maxItems = normalizeCount(def.maxItems);

      if (value === undefined || value === null) {
        if (def.required === true || (minItems !== null && minItems > 0)) {
          return issue(
            `Bloque "${blockName}" (índice ${blockIndex}): el campo "${def.label || propName}" requiere al menos ${minItems || 1} elemento(s).`,
            blockIndex,
            propName
          );
        }
        continue;
      }

      if (!Array.isArray(value)) {
        return issue(
          `Bloque "${blockName}" (índice ${blockIndex}): el campo "${def.label || propName}" debe ser un array.`,
          blockIndex,
          propName
        );
      }

      if (def.required === true && value.length === 0) {
        return issue(
          `Bloque "${blockName}" (índice ${blockIndex}): el campo "${def.label || propName}" es obligatorio.`,
          blockIndex,
          propName
        );
      }

      if (minItems !== null && value.length < minItems) {
        return issue(
          `Bloque "${blockName}" (índice ${blockIndex}): el campo "${def.label || propName}" requiere al menos ${minItems} elemento(s).`,
          blockIndex,
          propName
        );
      }

      if (maxItems !== null && value.length > maxItems) {
        return issue(
          `Bloque "${blockName}" (índice ${blockIndex}): el campo "${def.label || propName}" permite como máximo ${maxItems} elemento(s).`,
          blockIndex,
          propName
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
      def.required === true
    );
    if (fieldIssue) return fieldIssue;
  }

  return null;
}
