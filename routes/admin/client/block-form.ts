/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * block-form.ts — Pure single-block field renderer for the admin UI.
 *
 * Interface contract:
 *   mountBlockForm(options) → { destroy() }
 *
 *   options.container   — HTMLElement where fields will be rendered
 *   options.schemaItems — Record<string, PropDef> from the block schema
 *   options.values      — mutable values object (mutated in place on change)
 *   options.onChange    — called whenever any field value changes
 *   options.inlineErrors— Map<errorKey, message> — read once on (re)mount; call remount to reflect changes
 *   options.fieldPrefix — string prefix for generated field IDs (default: 'gb-field')
 *
 * Sortable (for array fields) is initialized inside mountBlockForm and
 * destroyed on destroy(). Sortable lifecycle does NOT leave this module.
 *
 * What this module does NOT do:
 *   - Block-list management (add/remove/reorder blocks)
 *   - Block-level validation orchestration
 *   - Dialog open/close
 *   - Fetch / save operations
 *
 * Security note: all user-controlled string values are passed through escapeHtml()
 * before being inserted into innerHTML — consistent with the existing admin UI pattern.
 */

import Sortable, { type SortableEvent } from 'sortablejs';
import type { ArrayPropDef, ObjectArrayItemDef, PrimitivePropDef, PropDef } from '../../../types/index.js';
import {
  isObjectArrayItemDef,
  isPrimitivePropDef,
} from '../../../utils/block-validation.js';
import { isSchemaPropLocalizable } from '../../../utils/localization.js';
import { escapeHtml, getActiveContentLocale } from './common.js';

// SVG icons (same as page-editor.ts and global-blocks-editor.ts)
const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const chevronDownSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const dragHandleSvg =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';

// Field-level change context passed as second arg to onChange.
// Callers that don't need it (e.g. global-blocks-editor) may ignore the argument.
export interface FieldChangeInfo {
  propName: string;
  itemIndex?: number;
  fieldName?: string;
}

/** Info passed to onArrayLimitReached when an add/delete hits a min/max boundary. */
export interface ArrayLimitInfo {
  prop: string;
  limit: 'min' | 'max';
  value: number;
}

/**
 * Pure helper: given the current array length and its PropDef, returns limit info if the
 * array is AT or BEYOND a min/max boundary, or null if no limit applies.
 *
 * Used internally by the add/delete handlers and exported so tests can verify the logic.
 *
 * Convention:
 *   - "max" → currentLength >= maxItems (cannot add)
 *   - "min" → currentLength <= minItems (cannot delete)
 */
export function checkArrayLimitReached(
  currentLength: number,
  def: { maxItems?: number; minItems?: number }
): { limit: 'min' | 'max'; value: number } | null {
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  if (maxItems !== null && currentLength >= maxItems) return { limit: 'max', value: maxItems };
  if (minItems !== null && currentLength <= minItems) return { limit: 'min', value: minItems };
  return null;
}

export interface BlockFormOptions {
  container: HTMLElement;
  schemaItems: Record<string, PropDef>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>, change?: FieldChangeInfo) => void;
  inlineErrors?: Map<string, string>;
  fieldPrefix?: string;
  /** Restore previously saved open-array-item state across re-mounts. */
  initialOpenArrayItems?: Map<string, number | null>;
  /**
   * Called when an add or delete operation is blocked because the array has
   * reached its maxItems or minItems limit. Optional — if omitted the handler
   * silently returns (original behaviour).
   */
  onArrayLimitReached?: (info: ArrayLimitInfo) => void;
}

export interface BlockFormHandle {
  destroy(): void;
  /** Snapshot of which array item (by propName) is currently expanded. */
  getOpenArrayItems(): Map<string, number | null>;
}

// Key helpers
function errorKey(propName: string, itemIndex?: number, fieldName?: string): string {
  return [propName, itemIndex === undefined ? '' : String(itemIndex), fieldName || ''].join('::');
}

function withLocaleHint(label: string, localizable = true): string {
  if (!localizable) return escapeHtml(label);
  return `${escapeHtml(label)} <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`;
}

function parseFieldValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (input instanceof HTMLInputElement && input.type === 'number') return input.value === '' ? '' : Number(input.value);
  return input.value;
}

function defaultPrimitiveValue(def: PrimitivePropDef): unknown {
  if (def.type === 'boolean') return false;
  if (def.type === 'number') return '';
  if (def.type === 'select') return Array.isArray(def.options) && def.options.length > 0 ? def.options[0] : '';
  return '';
}

function defaultArrayItemValue(def: ArrayPropDef): unknown {
  if (isPrimitivePropDef(def.item)) return defaultPrimitiveValue(def.item);
  const output: Record<string, unknown> = {};
  for (const [fieldName, fieldDef] of Object.entries(def.item.fields || {})) {
    output[fieldName] = defaultPrimitiveValue(fieldDef);
  }
  return output;
}

function primitiveInputHtml(def: PrimitivePropDef, value: unknown, id: string, attrs: string, rows = 2): string {
  if (def.type === 'text') {
    return `<textarea id="${id}" ${attrs} class="cms-input" rows="${rows}">${escapeHtml(String(value ?? ''))}</textarea>`;
  }
  if (def.type === 'number') {
    const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : '';
    return `<input type="number" id="${id}" ${attrs} class="cms-input" value="${numericValue}">`;
  }
  if (def.type === 'select') {
    const selectedValue = typeof value === 'string' ? value : '';
    const options = (def.options || [])
      .map((option) => `<option value="${escapeHtml(option)}"${selectedValue === option ? ' selected' : ''}>${escapeHtml(option)}</option>`)
      .join('');
    return `<select id="${id}" ${attrs} class="cms-input">${options}</select>`;
  }
  const textValue = typeof value === 'string' ? value : String(value ?? '');
  return `<input type="text" id="${id}" ${attrs} class="cms-input" value="${escapeHtml(textValue)}">`;
}

function renderPrimitiveField(
  propName: string,
  def: PrimitivePropDef,
  value: unknown,
  prefix: string,
  errorMsg: string
): string {
  const fieldId = `${prefix}-${propName}`;
  const label = withLocaleHint(def.label, isSchemaPropLocalizable(def));
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';

  if (def.type === 'boolean') {
    return (
      `<div class="cms-field cms-field-checkbox" data-error-key="${escapeHtml(errorKey(propName))}">` +
      `<input type="checkbox" id="${fieldId}" data-prop="${escapeHtml(propName)}" ${(value === true || value === 'true') ? 'checked' : ''}>` +
      `<label for="${fieldId}" class="cms-label-tight">${label}</label>` +
      errorHtml +
      '</div>'
    );
  }

  return (
    `<div class="cms-field" data-error-key="${escapeHtml(errorKey(propName))}">` +
    `<label for="${fieldId}">${label}</label>` +
    primitiveInputHtml(def, value, fieldId, `data-prop="${escapeHtml(propName)}"`) +
    errorHtml +
    '</div>'
  );
}

function renderArrayPrimitiveItem(
  propName: string,
  arrayDef: ArrayPropDef,
  itemDef: PrimitivePropDef,
  itemValue: unknown,
  itemIndex: number,
  prefix: string,
  errorMsg: string
): string {
  const inputId = `${prefix}-${propName}-${itemIndex}`;
  const attrs = `data-array-primitive="true" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}"`;
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';
  const inputControl = itemDef.type === 'boolean'
    ? `<label class="cms-array-item-checkbox"><input type="checkbox" id="${inputId}" ${attrs} ${(itemValue === true || itemValue === 'true') ? 'checked' : ''}><span>${escapeHtml(itemDef.label || arrayDef.label)}</span></label>`
    : primitiveInputHtml(itemDef, itemValue, inputId, `${attrs} placeholder="${escapeHtml(itemDef.label || arrayDef.label)}"`, 2);

  return (
    `<li class="cms-array-item cms-array-item--primitive" data-array-item-row="${itemIndex}" data-error-key="${escapeHtml(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
    `<div class="cms-array-item-input">${inputControl}</div>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
    '</div>' +
    errorHtml +
    '</li>'
  );
}

function renderArrayObjectItem(
  propName: string,
  objectDef: ObjectArrayItemDef,
  rawItem: unknown,
  itemIndex: number,
  prefix: string,
  openItemIndex: number | null | undefined,
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string
): string {
  const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
  const rowError = getError(propName, itemIndex);
  const rowErrorHtml = rowError ? `<p class="cms-field-error">${escapeHtml(rowError)}</p>` : '';
  const isOpen = openItemIndex === itemIndex;

  let summary = `Elemento ${itemIndex + 1}`;
  if (objectDef.summaryField) {
    const fromSummaryField = item[objectDef.summaryField];
    if (typeof fromSummaryField === 'string' && fromSummaryField.trim()) summary = fromSummaryField.trim();
  }
  if (summary === `Elemento ${itemIndex + 1}`) {
    for (const fieldName of Object.keys(objectDef.fields || {})) {
      const v = item[fieldName];
      if (typeof v === 'string' && v.trim()) { summary = v.trim(); break; }
    }
  }

  const fieldsHtml = Object.entries(objectDef.fields || {})
    .map(([fieldName, fieldDef]) => {
      const value = item[fieldName];
      const fieldId = `${prefix}-${propName}-${itemIndex}-${fieldName}`;
      const inputAttrs = `data-array-primitive="true" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" data-array-field="${escapeHtml(fieldName)}"`;
      const fieldError = getError(propName, itemIndex, fieldName);
      const fieldErrorHtml = fieldError ? `<p class="cms-field-error">${escapeHtml(fieldError)}</p>` : '';
      if (fieldDef.type === 'boolean') {
        return (
          `<div class="cms-field cms-field-checkbox" data-error-key="${escapeHtml(errorKey(propName, itemIndex, fieldName))}">` +
          `<input type="checkbox" id="${fieldId}" ${inputAttrs} ${(value === true || value === 'true') ? 'checked' : ''}>` +
          `<label for="${fieldId}" class="cms-label-tight">${escapeHtml(fieldDef.label)}</label>` +
          fieldErrorHtml +
          '</div>'
        );
      }
      return (
        `<div class="cms-field" data-error-key="${escapeHtml(errorKey(propName, itemIndex, fieldName))}">` +
        `<label for="${fieldId}">${escapeHtml(fieldDef.label)}</label>` +
        primitiveInputHtml(fieldDef, value, fieldId, inputAttrs, 2) +
        fieldErrorHtml +
        '</div>'
      );
    })
    .join('');

  return (
    `<li class="cms-array-item cms-array-item--object" data-array-item-row="${itemIndex}" data-error-key="${escapeHtml(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
    `<span class="cms-array-item-summary">${escapeHtml(summary)}</span>` +
    '<div class="cms-array-item-actions">' +
    `<button type="button" class="cms-array-item-toggle" data-array-toggle="true" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? 'Contraer' : 'Expandir'}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
    '</div>' +
    '</div>' +
    `<div class="cms-array-item-body${isOpen ? '' : ' cms-hidden'}">${fieldsHtml}</div>` +
    rowErrorHtml +
    '</li>'
  );
}

function renderArrayField(
  propName: string,
  def: ArrayPropDef,
  rawValue: unknown,
  prefix: string,
  openItemIndex: number | null | undefined,
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string
): string {
  const items = Array.isArray(rawValue) ? rawValue : [];
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const maxReached = maxItems !== null && items.length >= maxItems;
  const limits = [minItems !== null ? `Min ${minItems}` : '', maxItems !== null ? `Max ${maxItems}` : ''].filter(Boolean).join(' · ');
  const arrayError = getError(propName);
  const arrayErrorHtml = arrayError ? `<p class="cms-field-error cms-array-field-error">${escapeHtml(arrayError)}</p>` : '';

  const rowsHtml = items.map((itemValue, itemIndex) => {
    if (isPrimitivePropDef(def.item)) {
      return renderArrayPrimitiveItem(propName, def, def.item, itemValue, itemIndex, prefix, getError(propName, itemIndex));
    }
    return renderArrayObjectItem(propName, def.item, itemValue, itemIndex, prefix, openItemIndex, getError);
  }).join('');

  const sortableEnabled = def.sortable !== false;
  return (
    `<div class="cms-array-field" data-array-field="true" data-array-prop="${escapeHtml(propName)}" data-error-key="${escapeHtml(errorKey(propName))}">` +
    '<div class="cms-array-field-head">' +
    `<label class="cms-array-field-label">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label>` +
    '<div class="cms-array-field-meta">' +
    `<span class="cms-array-field-counter">${items.length} elemento${items.length === 1 ? '' : 's'}</span>` +
    (limits ? `<span class="cms-array-field-hint">${escapeHtml(limits)}</span>` : '') +
    `<button type="button" class="cms-btn cms-btn-secondary cms-array-field-add" data-array-add="true" data-array-prop="${escapeHtml(propName)}" ${maxReached ? 'disabled' : ''}>Añadir</button>` +
    '</div>' +
    '</div>' +
    `<ul class="cms-array-list" data-array-list="true" data-array-prop="${escapeHtml(propName)}" data-array-sortable="${sortableEnabled ? 'true' : 'false'}">${rowsHtml}</ul>` +
    (maxReached ? `<p class="cms-muted cms-array-field-hint">Has alcanzado el máximo de ${maxItems} elementos.</p>` : '') +
    arrayErrorHtml +
    '</div>'
  );
}

/**
 * Mount a single-block form into `container`.
 * Renders all fields from `schemaItems`, wires up value sync + array sortable.
 * Returns a handle with `destroy()` to clean up sortables and event listeners.
 */
export function mountBlockForm(options: BlockFormOptions): BlockFormHandle {
  const {
    container,
    schemaItems,
    values,
    onChange,
    inlineErrors = new Map(),
    fieldPrefix = 'gb-field',
    initialOpenArrayItems,
    onArrayLimitReached,
  } = options;

  const sortables: Sortable[] = [];
  const openArrayItemByKey: Map<string, number | null> = initialOpenArrayItems
    ? new Map(initialOpenArrayItems)
    : new Map();

  function getError(propName: string, itemIndex?: number, fieldName?: string): string {
    const key = errorKey(propName, itemIndex, fieldName);
    const exact = inlineErrors.get(key);
    if (exact) return exact;
    if (fieldName !== undefined) {
      const itemLevel = inlineErrors.get(errorKey(propName, itemIndex));
      if (itemLevel) return itemLevel;
    }
    return '';
  }

  function getArrayValue(propName: string): unknown[] {
    const v = values[propName];
    if (Array.isArray(v)) return v;
    const next: unknown[] = [];
    values[propName] = next;
    return next;
  }

  function render(): void {
    sortables.forEach((s) => s.destroy());
    sortables.length = 0;

    let html = '<div class="cms-stack cms-block-item-fields">';
    for (const [propName, def] of Object.entries(schemaItems)) {
      const value = values[propName];
      if (def.type === 'array') {
        html += renderArrayField(propName, def, value, fieldPrefix, openArrayItemByKey.get(propName) ?? null, getError);
      } else {
        html += renderPrimitiveField(propName, def as PrimitivePropDef, value ?? '', fieldPrefix, getError(propName));
      }
    }
    html += '</div>';
    // All values passed to escapeHtml() before insertion — consistent with admin UI pattern
    container.innerHTML = html;
    bindEvents();
  }

  function bindEvents(): void {
    // Primitive field inputs (not inside arrays)
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-prop]:not([data-array-primitive])').forEach((input) => {
      const sync = (): void => {
        const propName = input.dataset.prop;
        if (!propName) return;
        values[propName] = parseFieldValue(input);
        onChange(values, { propName });
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });

    // Array primitive / object field inputs
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-array-primitive="true"]').forEach((input) => {
      const sync = (): void => {
        const propName = input.dataset.arrayProp;
        const itemIndex = Number.parseInt(input.dataset.arrayItem || '', 10);
        const fieldName = input.dataset.arrayField;
        if (!propName || Number.isNaN(itemIndex)) return;
        const arr = getArrayValue(propName);
        while (arr.length <= itemIndex) arr.push('');
        if (fieldName) {
          const current = arr[itemIndex];
          const obj = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
          obj[fieldName] = parseFieldValue(input);
          arr[itemIndex] = obj;
        } else {
          arr[itemIndex] = parseFieldValue(input);
        }
        onChange(values, { propName, itemIndex, fieldName: fieldName || undefined });
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });

    // Array add buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-add="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        if (!propName) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo) {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.push(defaultArrayItemValue(def));
        if (isObjectArrayItemDef(def.item)) openArrayItemByKey.set(propName, arr.length - 1);
        onChange(values, { propName });
        render();
      });
    });

    // Array delete buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-delete="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo?.limit === 'min') {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.splice(itemIndex, 1);
        const current = openArrayItemByKey.get(propName);
        if (current !== undefined && current !== null) {
          if (current === itemIndex) openArrayItemByKey.set(propName, null);
          if (current > itemIndex) openArrayItemByKey.set(propName, current - 1);
        }
        onChange(values, { propName, itemIndex });
        render();
      });
    });

    // Array object item toggle
    container.querySelectorAll<HTMLButtonElement>('[data-array-toggle="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const current = openArrayItemByKey.get(propName);
        openArrayItemByKey.set(propName, current === itemIndex ? null : itemIndex);
        render();
      });
    });

    // Array sortable for reordering items within each array field
    container.querySelectorAll<HTMLElement>('[data-array-list="true"]').forEach((listEl) => {
      if (listEl.dataset.arraySortable === 'false') return;
      const propName = listEl.dataset.arrayProp;
      if (!propName) return;
      const arr = getArrayValue(propName);
      if (arr.length < 2) return;
      const sortable = Sortable.create(listEl, {
        handle: '.cms-array-item-drag',
        ghostClass: 'cms-dragging',
        onEnd(event: SortableEvent) {
          if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return;
          const row = arr[event.oldIndex];
          arr.splice(event.oldIndex, 1);
          arr.splice(event.newIndex, 0, row);
          const openRow = openArrayItemByKey.get(propName);
          if (openRow !== undefined && openRow !== null) {
            if (openRow === event.oldIndex) openArrayItemByKey.set(propName, event.newIndex);
            else if (event.oldIndex < openRow && event.newIndex >= openRow) openArrayItemByKey.set(propName, openRow - 1);
            else if (event.oldIndex > openRow && event.newIndex <= openRow) openArrayItemByKey.set(propName, openRow + 1);
          }
          onChange(values, { propName });
          render();
        },
      });
      sortables.push(sortable);
    });
  }

  // Re-render on locale change (updates locale hints in labels)
  const localeChangeHandler = (): void => { render(); };
  window.addEventListener('cms:content-locale-change', localeChangeHandler);

  render();

  return {
    destroy(): void {
      sortables.forEach((s) => s.destroy());
      sortables.length = 0;
      window.removeEventListener('cms:content-locale-change', localeChangeHandler);
      container.innerHTML = '';
    },
    getOpenArrayItems(): Map<string, number | null> {
      return new Map(openArrayItemByKey);
    },
  };
}
