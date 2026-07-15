/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * field-dom-sync.ts — in-place DOM patchers for image/file fields.
 *
 * Fields are not re-rendered on value change (see docs/CONTEXT.md), so the
 * preview, filename, "selected" state and Choose/Clear labels are mutated
 * directly by these helpers.
 */

import type { FileFieldValue } from '../../../../types/index.js';
import { escapeAttr } from '../../../../utils/html-escape.js';
import { parseImageValue } from '../../../../utils/image-value.js';
import { isEmptyFileValue } from '../../../../utils/file-value.js';
import { imageFilenameFromUrl, imagePickerIconSvg } from './field-helpers.js';
import { ct } from '../../i18n/client.js';

/**
 * Update an image field's visible DOM IN PLACE to reflect `url` (empty string =
 * cleared). Fields are not re-rendered on value change, so the preview, filename,
 * "selected" state, and Choose/Clear labels must be mutated directly here.
 *
 * Pure presentation: it does NOT touch the hidden input value, dispatch events,
 * or alter the value contract — callers own that.
 */
export function updateImageFieldDom(hiddenInput: HTMLInputElement, url: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const hasValue = url.length > 0;
  const filename = hasValue ? imageFilenameFromUrl(url) : '';
  field.classList.toggle('cms-image-field--has-value', hasValue);

  const previewWrap = field.querySelector<HTMLElement>('[data-image-preview]');
  if (previewWrap) {
    previewWrap.innerHTML = hasValue
      ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(filename)}" class="cms-image-field-thumb" data-image-thumb>`
      : `<span class="cms-image-field-placeholder" aria-hidden="true">${imagePickerIconSvg}</span>`;
  }

  const nameEl = field.querySelector<HTMLElement>('.cms-image-field-name');
  if (nameEl) {
    nameEl.classList.toggle('cms-image-field-name--empty', !hasValue);
    nameEl.textContent = hasValue ? filename : ct('blockForm.noImageSelected');
    if (hasValue) nameEl.setAttribute('title', filename);
    else nameEl.removeAttribute('title');
  }

  const chooseLabel = field.querySelector<HTMLElement>('[data-choose-label]');
  if (chooseLabel)
    chooseLabel.textContent = hasValue ? ct('blockForm.replaceImage') : ct('blockForm.chooseImage');
}

/**
 * Update a file field's visible DOM IN PLACE to reflect the new value.
 * Mirror of updateImageFieldDom for the 'file' prop type.
 */
export function updateFileFieldDom(hiddenInput: HTMLInputElement, value: FileFieldValue): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-file-field');
  if (!field) return;
  const hasValue = !isEmptyFileValue(value);
  const displayName = hasValue ? (value.filename ?? imageFilenameFromUrl(value.url)) : '';
  field.classList.toggle('cms-file-field--has-value', hasValue);

  const nameEl = field.querySelector<HTMLElement>('.cms-file-field-name');
  if (nameEl) {
    nameEl.classList.toggle('cms-file-field-name--empty', !hasValue);
    nameEl.textContent = hasValue ? displayName : ct('blockForm.noFileSelected');
    if (hasValue) nameEl.setAttribute('title', displayName);
    else nameEl.removeAttribute('title');
  }

  const chooseLabel = field.querySelector<HTMLElement>('[data-file-choose-label]');
  if (chooseLabel)
    chooseLabel.textContent = hasValue ? ct('blockForm.replaceFile') : ct('blockForm.chooseFile');
}

/**
 * Seed the visible alt-override input for an image field from the current hidden-input JSON.
 * Reads parseImageValue(hidden.value).alt and sets the alt input value.
 */
export function seedAltInput(hiddenInput: HTMLInputElement, altOverride?: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const altInput = field.querySelector<HTMLInputElement>('[data-image-alt-for]');
  if (!altInput) return;
  if (altOverride !== undefined) {
    altInput.value = altOverride;
  } else {
    const current = parseImageValue(hiddenInput.value);
    altInput.value = current.alt ?? '';
  }
}

/**
 * Seed the visible caption input for an image field from the current hidden-input JSON.
 * Reads parseImageValue(hidden.value).caption and sets the caption input value.
 * If captionOverride is provided, that value is used directly (used on picker pick and clear).
 */
export function seedCaptionInput(hiddenInput: HTMLInputElement, captionOverride?: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const captionInput = field.querySelector<HTMLInputElement>('[data-image-caption-for]');
  if (!captionInput) return;
  if (captionOverride !== undefined) {
    captionInput.value = captionOverride;
  } else {
    const current = parseImageValue(hiddenInput.value);
    captionInput.value = current.caption ?? '';
  }
}
