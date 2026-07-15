/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * field-helpers.ts — cross-cutting pure helpers shared by the block-form modules
 * (error keys, field labels, field value parsing/defaults, filename derivation).
 */

import type { ArrayPropDef, PrimitivePropDef } from '../../../../types/index.js';
import { isPrimitivePropDef } from '../../../../utils/block-validation.js';
import { escapeHtml } from '../../../../utils/html-escape.js';
import { parseImageValue } from '../../../../utils/image-value.js';
import { parseFileValue } from '../../../../utils/file-value.js';
import { getActiveContentLocale } from '../common.js';

// Shared by field-renderers (initial placeholder + choose button) and
// field-dom-sync (placeholder swap on clear).
export const imagePickerIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

// Key helpers
export function errorKey(propName: string, itemIndex?: number, fieldName?: string): string {
  return [propName, itemIndex === undefined ? '' : String(itemIndex), fieldName || ''].join('::');
}

export function withLocaleHint(label: string, localizable = true): string {
  if (!localizable) return escapeHtml(label);
  return `${escapeHtml(label)} <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`;
}

export function parseFieldValue(
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): unknown {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (input instanceof HTMLInputElement && input.type === 'number')
    return input.value === '' ? '' : Number(input.value);
  // Image field: hidden input carries JSON ImageFieldValue (marked with data-image-value)
  if (input instanceof HTMLInputElement && input.dataset.imageValue !== undefined) {
    return parseImageValue(input.value);
  }
  // File field: hidden input carries JSON FileFieldValue (marked with data-file-value)
  if (input instanceof HTMLInputElement && input.dataset.fileValue !== undefined) {
    return parseFileValue(input.value);
  }
  return input.value;
}

export function defaultPrimitiveValue(def: PrimitivePropDef): unknown {
  if (def.type === 'boolean') return false;
  if (def.type === 'number') return '';
  if (def.type === 'select')
    return Array.isArray(def.options) && def.options.length > 0 ? def.options[0] : '';
  if (def.type === 'file') return { url: '' };
  if (def.type === 'image') return { url: '', alt: '' };
  return '';
}

export function defaultArrayItemValue(def: ArrayPropDef): unknown {
  if (isPrimitivePropDef(def.item)) return defaultPrimitiveValue(def.item);
  const output: Record<string, unknown> = {};
  for (const [fieldName, fieldDef] of Object.entries(def.item.fields || {})) {
    output[fieldName] = defaultPrimitiveValue(fieldDef);
  }
  return output;
}

/** Derive a human-friendly filename from a stored URL/path value. */
export function imageFilenameFromUrl(url: string): string {
  const last = url.split('/').pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
