/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * field-renderers.ts — HTML string builders for block-form fields (primitive,
 * image, file, and array fields). Pure rendering: no event wiring, no DOM
 * mutation — mount.ts owns both.
 *
 * Security note: user-controlled string values use TWO escapers depending on
 * context, both imported from the canonical utils/html-escape.ts module:
 *   - escapeHtml() — element TEXT CONTENT only
 *   - escapeAttr() — HTML ATTRIBUTE VALUES
 */

import type {
  ArrayPropDef,
  FileFieldValue,
  ImageFieldValue,
  ObjectArrayItemDef,
  PrimitivePropDef,
} from '../../../../types/index.js';
import { isPrimitivePropDef } from '../../../../utils/block-validation.js';
import { isSchemaPropLocalizable } from '../../../../utils/localization.js';
import { escapeHtml, escapeAttr } from '../../../../utils/html-escape.js';
import { toImageValue, serializeImageValueAttr } from '../../../../utils/image-value.js';
import {
  toFileValue,
  serializeFileValueAttr,
  isEmptyFileValue,
} from '../../../../utils/file-value.js';
import { getActiveContentLocale } from '../common.js';
import { ct } from '../../i18n/client.js';
import {
  errorKey,
  imageFilenameFromUrl,
  imagePickerIconSvg,
  withLocaleHint,
} from './field-helpers.js';
import { computeEffectiveAccept } from './file-accept.js';

// SVG icons (same as page-editor.ts and global-blocks-editor.ts)
const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const chevronDownSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const dragHandleSvg =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';

/**
 * Render the image field as a compact horizontal control.
 * Same DOM shape for both states — toggled via .cms-image-field--has-value on
 * the root — so selectPickerImage()/Clear can mutate it in place.
 *
 * The hidden input carries the full JSON-serialized ImageFieldValue.
 * A visible alt-override input below the actions lets users set per-component alt.
 *
 * Responsive seam: when srcset/webp generation is added, it will slot into
 * selectPickerImage() and BlockImage.astro without breaking the hidden-input contract.
 */
function imageFieldHtml(
  id: string,
  attrs: string,
  value: ImageFieldValue,
  localizable = false,
): string {
  const urlValue = value.url;
  const altValue = value.alt ?? '';
  const captionValue = value.caption ?? '';
  const hasValue = urlValue.length > 0;
  const filename = hasValue ? imageFilenameFromUrl(urlValue) : '';
  const stateClass = hasValue ? ' cms-image-field--has-value' : '';
  // Preview slot: <img> when there is a value, placeholder icon otherwise.
  // data-image-preview marks the slot so the delegated error listener can swap
  // a failed <img> to the "file missing" state without inline JS in attributes.
  const previewInner = hasValue
    ? `<img src="${escapeAttr(urlValue)}" alt="${escapeAttr(filename)}" class="cms-image-field-thumb" data-image-thumb>`
    : `<span class="cms-image-field-placeholder" aria-hidden="true">${imagePickerIconSvg}</span>`;
  // "Selected: <filename>" vs "No image selected" — perceivable without color.
  const nameHtml = hasValue
    ? `<span class="cms-image-field-name" title="${escapeAttr(filename)}">${escapeHtml(filename)}</span>`
    : `<span class="cms-image-field-name cms-image-field-name--empty">${escapeHtml(ct('blockForm.noImageSelected'))}</span>`;
  const chooseLabel = hasValue ? ct('blockForm.replaceImage') : ct('blockForm.chooseImage');
  const altInputId = `${id}-alt`;
  const captionInputId = `${id}-caption`;
  const altLabel = localizable
    ? `${escapeHtml(ct('blockForm.altText'))} <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`
    : escapeHtml(ct('blockForm.altText'));
  // Clear button is always present in the DOM; visibility is toggled via the
  // root modifier class so the in-place update never has to insert/remove nodes.
  // The hidden input now carries the full JSON ImageFieldValue.
  // escapeAttr is used for all HTML attribute value contexts (encodes " too);
  // escapeHtml is sufficient for element content (text nodes cannot break attributes).
  return (
    `<div class="cms-image-field${stateClass}" data-image-field="${escapeAttr(id)}">` +
    `<input type="text" id="${id}" ${attrs} class="cms-media-value cms-hidden" value="${serializeImageValueAttr(value)}" tabindex="-1" aria-hidden="true" data-image-value="1">` +
    `<div class="cms-image-field-preview-wrap" data-image-preview>${previewInner}</div>` +
    `<div class="cms-image-field-detail">` +
    nameHtml +
    `<div class="cms-image-field-actions">` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-image-field-choose" data-picker-for="${escapeAttr(id)}" aria-label="${escapeAttr(ct('blockForm.chooseImage'))}">${imagePickerIconSvg}<span data-choose-label>${escapeHtml(chooseLabel)}</span></button>` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-image-field-clear" data-picker-clear="${escapeAttr(id)}" aria-label="${escapeAttr(ct('blockForm.clearImage'))}">${escapeHtml(ct('blockForm.clearImage'))}</button>` +
    `</div>` +
    `<div class="cms-image-field-alt-row">` +
    `<label for="${altInputId}" class="cms-image-field-alt-label">${altLabel}</label>` +
    `<input type="text" id="${altInputId}" class="cms-input cms-image-field-alt-input" data-image-alt-for="${escapeAttr(id)}" value="${escapeAttr(altValue)}" placeholder="${escapeAttr(ct('blockForm.altPlaceholder'))}" autocomplete="off">` +
    `</div>` +
    `<div class="cms-image-field-caption-row">` +
    `<label for="${captionInputId}" class="cms-image-field-caption-label">${escapeHtml(ct('blockForm.captionLabel'))}</label>` +
    `<input type="text" id="${captionInputId}" class="cms-input cms-image-field-caption-input" data-image-caption-for="${escapeAttr(id)}" value="${escapeAttr(captionValue)}" placeholder="${escapeAttr(ct('blockForm.captionPlaceholder'))}" autocomplete="off">` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

// Icon for file fields (document)
const filePickerIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

/**
 * Render a file field as a compact horizontal control (mirrors imageFieldHtml).
 *
 * The hidden input carries the full JSON-serialized FileFieldValue.
 * Data attributes on the choose button carry the effectiveAccept so the
 * openPickerDialog call can enforce the accept ∩ allowlist at render time.
 */
function fileFieldHtml(
  id: string,
  attrs: string,
  value: FileFieldValue,
  effectiveAccept: string[],
): string {
  const hasValue = !isEmptyFileValue(value);
  const displayName = hasValue ? (value.filename ?? imageFilenameFromUrl(value.url)) : '';
  const stateClass = hasValue ? ' cms-file-field--has-value' : '';
  const nameHtml = hasValue
    ? `<span class="cms-file-field-name" title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</span>`
    : `<span class="cms-file-field-name cms-file-field-name--empty">No file selected</span>`;
  const chooseLabel = hasValue ? 'Replace' : 'Choose file';
  // Serialize effectiveAccept as a JSON string in a data attribute so the picker
  // click handler can recover it without keeping additional module-level state per field.
  const acceptAttr = escapeAttr(JSON.stringify(effectiveAccept));

  return (
    `<div class="cms-file-field${stateClass}" data-file-field="${escapeAttr(id)}">` +
    `<input type="text" id="${id}" ${attrs} class="cms-media-value cms-hidden" value="${serializeFileValueAttr(value)}" tabindex="-1" aria-hidden="true" data-file-value="1">` +
    `<div class="cms-file-field-detail">` +
    nameHtml +
    `<div class="cms-file-field-actions">` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-file-field-choose" data-file-picker-for="${escapeAttr(id)}" data-file-accept="${acceptAttr}" aria-label="Choose file">${filePickerIconSvg}<span data-file-choose-label>${escapeHtml(chooseLabel)}</span></button>` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-file-field-clear" data-file-picker-clear="${escapeAttr(id)}" aria-label="Clear file">Clear</button>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

function primitiveInputHtml(
  def: PrimitivePropDef,
  value: unknown,
  id: string,
  attrs: string,
  rows = 2,
): string {
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
      .map(
        (option) =>
          `<option value="${escapeAttr(option)}"${selectedValue === option ? ' selected' : ''}>${escapeHtml(option)}</option>`,
      )
      .join('');
    return `<select id="${id}" ${attrs} class="cms-input">${options}</select>`;
  }
  if (def.type === 'image') {
    // Coerce legacy string → ImageFieldValue. Compact HORIZONTAL layout: fixed thumbnail
    // on the LEFT, state text + action buttons on the RIGHT. The DOM is the same for both
    // the empty and selected states (toggled via .cms-image-field--has-value modifier on
    // the root) so selectPickerImage / Clear can update it IN PLACE without a full re-render.
    const imageValue = toImageValue(value);
    return imageFieldHtml(id, attrs, imageValue, isSchemaPropLocalizable(def));
  }
  if (def.type === 'file') {
    // ADDITIVE branch — does NOT touch the image path above.
    // Compute effectiveAccept: def.accept ∩ globalAllowlist (or full global if omitted).
    const effectiveAccept = computeEffectiveAccept(def);
    const fileValue = toFileValue(value);
    return fileFieldHtml(id, attrs, fileValue, effectiveAccept);
  }
  const textValue = typeof value === 'string' ? value : String(value ?? '');
  return `<input type="text" id="${id}" ${attrs} class="cms-input" value="${escapeAttr(textValue)}">`;
}

export function renderPrimitiveField(
  propName: string,
  def: PrimitivePropDef,
  value: unknown,
  prefix: string,
  errorMsg: string,
): string {
  const fieldId = `${prefix}-${propName}`;
  const label = withLocaleHint(def.label, isSchemaPropLocalizable(def));
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';

  if (def.type === 'boolean') {
    return (
      `<div class="cms-field cms-field-checkbox" data-error-key="${escapeAttr(errorKey(propName))}">` +
      `<input type="checkbox" id="${fieldId}" data-prop="${escapeAttr(propName)}" ${value === true || value === 'true' ? 'checked' : ''}>` +
      `<label for="${fieldId}" class="cms-label-tight">${label}</label>` +
      errorHtml +
      '</div>'
    );
  }

  return (
    `<div class="cms-field" data-error-key="${escapeAttr(errorKey(propName))}">` +
    `<label for="${fieldId}">${label}</label>` +
    primitiveInputHtml(def, value, fieldId, `data-prop="${escapeAttr(propName)}"`) +
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
  errorMsg: string,
): string {
  const inputId = `${prefix}-${propName}-${itemIndex}`;
  const attrs = `data-array-primitive="true" data-array-prop="${escapeAttr(propName)}" data-array-item="${itemIndex}"`;
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';
  const inputControl =
    itemDef.type === 'boolean'
      ? `<label class="cms-array-item-checkbox"><input type="checkbox" id="${inputId}" ${attrs} ${itemValue === true || itemValue === 'true' ? 'checked' : ''}><span>${escapeHtml(itemDef.label || arrayDef.label)}</span></label>`
      : primitiveInputHtml(
          itemDef,
          itemValue,
          inputId,
          `${attrs} placeholder="${escapeAttr(itemDef.label || arrayDef.label)}"`,
          2,
        );

  return (
    `<li class="cms-array-item cms-array-item--primitive" data-array-item-row="${itemIndex}" data-error-key="${escapeAttr(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="${ct('common.drag')}">${dragHandleSvg}</span>` +
    `<div class="cms-array-item-input">${inputControl}</div>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapeAttr(propName)}" data-array-item="${itemIndex}" aria-label="${ct('common.delete')}">${trashIconSvg}</button>` +
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
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string,
): string {
  const item =
    rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)
      ? (rawItem as Record<string, unknown>)
      : {};
  const rowError = getError(propName, itemIndex);
  const rowErrorHtml = rowError ? `<p class="cms-field-error">${escapeHtml(rowError)}</p>` : '';
  const isOpen = openItemIndex === itemIndex;

  const defaultSummary = ct('pageEditor.blockElement', { n: itemIndex + 1 });
  let summary = defaultSummary;
  if (objectDef.summaryField) {
    const fromSummaryField = item[objectDef.summaryField];
    if (typeof fromSummaryField === 'string' && fromSummaryField.trim())
      summary = fromSummaryField.trim();
  }
  if (summary === defaultSummary) {
    for (const fieldName of Object.keys(objectDef.fields || {})) {
      const v = item[fieldName];
      if (typeof v === 'string' && v.trim()) {
        summary = v.trim();
        break;
      }
    }
  }

  const fieldsHtml = Object.entries(objectDef.fields || {})
    .map(([fieldName, fieldDef]) => {
      const value = item[fieldName];
      const fieldId = `${prefix}-${propName}-${itemIndex}-${fieldName}`;
      const inputAttrs = `data-array-primitive="true" data-array-prop="${escapeAttr(propName)}" data-array-item="${itemIndex}" data-array-field="${escapeAttr(fieldName)}"`;
      const fieldError = getError(propName, itemIndex, fieldName);
      const fieldErrorHtml = fieldError
        ? `<p class="cms-field-error">${escapeHtml(fieldError)}</p>`
        : '';
      if (fieldDef.type === 'boolean') {
        return (
          `<div class="cms-field cms-field-checkbox" data-error-key="${escapeAttr(errorKey(propName, itemIndex, fieldName))}">` +
          `<input type="checkbox" id="${fieldId}" ${inputAttrs} ${value === true || value === 'true' ? 'checked' : ''}>` +
          `<label for="${fieldId}" class="cms-label-tight">${escapeHtml(fieldDef.label)}</label>` +
          fieldErrorHtml +
          '</div>'
        );
      }
      return (
        `<div class="cms-field" data-error-key="${escapeAttr(errorKey(propName, itemIndex, fieldName))}">` +
        `<label for="${fieldId}">${escapeHtml(fieldDef.label)}</label>` +
        primitiveInputHtml(fieldDef, value, fieldId, inputAttrs, 2) +
        fieldErrorHtml +
        '</div>'
      );
    })
    .join('');

  return (
    `<li class="cms-array-item cms-array-item--object" data-array-item-row="${itemIndex}" data-error-key="${escapeAttr(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="${ct('common.drag')}">${dragHandleSvg}</span>` +
    `<span class="cms-array-item-summary">${escapeHtml(summary)}</span>` +
    '<div class="cms-array-item-actions">' +
    `<button type="button" class="cms-array-item-toggle" data-array-toggle="true" data-array-prop="${escapeAttr(propName)}" data-array-item="${itemIndex}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? ct('common.collapse') : ct('common.expand')}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapeAttr(propName)}" data-array-item="${itemIndex}" aria-label="${ct('common.delete')}">${trashIconSvg}</button>` +
    '</div>' +
    '</div>' +
    `<div class="cms-array-item-body${isOpen ? '' : ' cms-hidden'}">${fieldsHtml}</div>` +
    rowErrorHtml +
    '</li>'
  );
}

export function renderArrayField(
  propName: string,
  def: ArrayPropDef,
  rawValue: unknown,
  prefix: string,
  openItemIndex: number | null | undefined,
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string,
): string {
  const items = Array.isArray(rawValue) ? rawValue : [];
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const maxReached = maxItems !== null && items.length >= maxItems;
  const limits = [
    minItems !== null ? `Min ${minItems}` : '',
    maxItems !== null ? `Max ${maxItems}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const arrayError = getError(propName);
  const arrayErrorHtml = arrayError
    ? `<p class="cms-field-error cms-array-field-error">${escapeHtml(arrayError)}</p>`
    : '';

  const rowsHtml = items
    .map((itemValue, itemIndex) => {
      if (isPrimitivePropDef(def.item)) {
        return renderArrayPrimitiveItem(
          propName,
          def,
          def.item,
          itemValue,
          itemIndex,
          prefix,
          getError(propName, itemIndex),
        );
      }
      return renderArrayObjectItem(
        propName,
        def.item,
        itemValue,
        itemIndex,
        prefix,
        openItemIndex,
        getError,
      );
    })
    .join('');

  const sortableEnabled = def.sortable !== false;
  return (
    `<div class="cms-array-field" data-array-field="true" data-array-prop="${escapeAttr(propName)}" data-error-key="${escapeAttr(errorKey(propName))}">` +
    '<div class="cms-array-field-head">' +
    `<label class="cms-array-field-label">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label>` +
    '<div class="cms-array-field-meta">' +
    `<span class="cms-array-field-counter">${items.length} elemento${items.length === 1 ? '' : 's'}</span>` +
    (limits ? `<span class="cms-array-field-hint">${escapeHtml(limits)}</span>` : '') +
    `<button type="button" class="cms-btn cms-btn-secondary cms-array-field-add" data-array-add="true" data-array-prop="${escapeAttr(propName)}" ${maxReached ? 'disabled' : ''}>${ct('blockForm.addItem')}</button>` +
    '</div>' +
    '</div>' +
    `<ul class="cms-array-list" data-array-list="true" data-array-prop="${escapeAttr(propName)}" data-array-sortable="${sortableEnabled ? 'true' : 'false'}">${rowsHtml}</ul>` +
    (maxReached
      ? `<p class="cms-muted cms-array-field-hint">${ct('blockForm.maxReached', { max: maxItems })}</p>`
      : '') +
    arrayErrorHtml +
    '</div>'
  );
}
