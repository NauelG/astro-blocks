/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { authHeaders, showAlert, showToast } from './common.js';
import { ct } from '../i18n/client.js';

const DEFAULT_PRIMARY = '#2C53B8';
const DEFAULT_SECONDARY = '#0DB8DB';

/** Normalize a #RGB or #RRGGBB string to full #RRGGBB, or null if invalid. */
function toFullHex(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('#')) return null;
  const hex = value.slice(1).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length === 6) return '#' + hex;
  if (hex.length === 3) {
    return (
      '#' +
      hex
        .split('')
        .map((c) => c + c)
        .join('')
    );
  }
  return null;
}

/** Mirror a native color picker's value into its paired text input. */
function syncPickerToText(pickerId: string, textId: string): void {
  const picker = document.getElementById(pickerId) as HTMLInputElement | null;
  const text = document.getElementById(textId) as HTMLInputElement | null;
  if (!picker || !text) return;
  picker.addEventListener('input', () => {
    text.value = picker.value;
  });
}

/** Mirror a text input's value into its paired native color picker. */
function syncTextToPicker(textId: string, pickerId: string): void {
  const text = document.getElementById(textId) as HTMLInputElement | null;
  const picker = document.getElementById(pickerId) as HTMLInputElement | null;
  if (!text || !picker) return;
  text.addEventListener('input', () => {
    const hex = toFullHex(text.value);
    if (hex) picker.value = hex;
  });
}

/** Repaint the live theme preview from the current color field values. */
function updateThemePreview(): void {
  const primaryInput = document.getElementById('primaryColor') as HTMLInputElement | null;
  const secondaryInput = document.getElementById('secondaryColor') as HTMLInputElement | null;
  const preview = document.getElementById('cms-theme-preview');
  const primarySwatch = document.getElementById('cms-preview-primary-swatch');
  const secondarySwatch = document.getElementById('cms-preview-secondary-swatch');
  const primaryText = document.getElementById('cms-preview-primary-text');
  const secondaryText = document.getElementById('cms-preview-secondary-text');
  const primaryHex = toFullHex(primaryInput?.value || '') || DEFAULT_PRIMARY;
  const secondaryHex = toFullHex(secondaryInput?.value || '') || DEFAULT_SECONDARY;
  if (preview) {
    preview.style.setProperty('--cms-primary', primaryHex);
    preview.style.setProperty('--cms-secondary', secondaryHex);
  }
  if (primarySwatch) primarySwatch.setAttribute('style', 'background: ' + primaryHex + ';');
  if (secondarySwatch) secondarySwatch.setAttribute('style', 'background: ' + secondaryHex + ';');
  if (primaryText) primaryText.textContent = primaryInput?.value || primaryHex;
  if (secondaryText) secondaryText.textContent = secondaryInput?.value || secondaryHex;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name) as HTMLInputElement | null;
  return el ? el.value : '';
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.target as HTMLFormElement | null;
  if (!form) return;

  const body = {
    siteName: fieldValue(form, 'siteName'),
    baseUrl: fieldValue(form, 'baseUrl'),
    favicon: fieldValue(form, 'favicon'),
    logo: fieldValue(form, 'logo'),
    primaryColor: fieldValue(form, 'primaryColor'),
    secondaryColor: fieldValue(form, 'secondaryColor'),
  };

  const res = await fetch('/cms/api/site', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await showAlert(
      ct('settings.saveError', { detail: await res.text() }),
      ct('settings.saveTitle'),
    );
    return;
  }

  document.body.style.setProperty('--cms-primary', body.primaryColor || DEFAULT_PRIMARY);
  document.body.style.setProperty(
    '--cms-secondary',
    body.secondaryColor || body.primaryColor || DEFAULT_SECONDARY,
  );
  showToast(ct('settings.saved'), 'success', ct('settings.saveTitle'));
}

/** Wire up the settings page: color pickers, live preview, and PUT-on-submit. */
export function initSettingsEditor(): void {
  syncPickerToText('primaryColor-picker', 'primaryColor');
  syncTextToPicker('primaryColor', 'primaryColor-picker');
  syncPickerToText('secondaryColor-picker', 'secondaryColor');
  syncTextToPicker('secondaryColor', 'secondaryColor-picker');

  const previewInputs = [
    'primaryColor-picker',
    'secondaryColor-picker',
    'primaryColor',
    'secondaryColor',
  ];
  for (const id of previewInputs) {
    document.getElementById(id)?.addEventListener('input', updateThemePreview);
  }
  updateThemePreview();

  const form = document.getElementById('settings-form') as HTMLFormElement | null;
  form?.addEventListener('submit', handleSubmit);
}
