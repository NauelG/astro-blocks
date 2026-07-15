/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * picker-title.ts — pure mapping from picker mode to its i18n title keys.
 *
 * The media picker is opened for a prop whose type is 'image' or 'file'. In
 * 'image' mode it presents as an image chooser (it acts on an image prop, so it
 * keeps "image" wording per the §3 boundary); in 'file' mode it presents as a
 * generic media chooser. This module holds NO browser dependency so it can be
 * unit-tested under node:test without importing the picker DOM code.
 */

export type PickerMode = 'image' | 'file';

export interface PickerTitleKeys {
  /** i18n key for the dialog <h2> title. */
  title: string;
  /** i18n key for the dialog aria-label. */
  aria: string;
  /** i18n key for the close-button aria-label. */
  close: string;
}

/**
 * Resolve the title/aria/close i18n keys for a picker opened in the given mode.
 * File mode reads as "media" (it holds any asset); image mode keeps "image".
 */
export function pickerTitleKeyForMode(mode: PickerMode): PickerTitleKeys {
  return mode === 'file'
    ? {
        title: 'blockForm.pickerTitleFile',
        aria: 'blockForm.pickerAriaLabelFile',
        close: 'blockForm.pickerCloseFile',
      }
    : {
        title: 'blockForm.pickerTitleImage',
        aria: 'blockForm.pickerAriaLabelImage',
        close: 'blockForm.pickerCloseImage',
      };
}
