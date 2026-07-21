/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ConfigEntry } from '../../../types/index.js';
import {
  authHeaders,
  closeDialog,
  fetchOk,
  openDialog,
  setInlineError,
  showAlert,
  showToast,
} from './common.js';
import { ct } from '../i18n/client.js';
import { escapeAttr, escapeHtml } from '../../../utils/html-escape.js';
import { createListEditor, raw } from './list-editor.js';

const configKeyRegex = /^[A-Za-z][A-Za-z0-9_.-]*$/;

function maskConfigValue(value: string): string {
  return value ? '••••••••' : '—';
}

export function initConfigsEditor(): void {
  const dialog = document.getElementById('config-detail-modal') as HTMLDialogElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const form = document.getElementById('config-detail-form') as HTMLFormElement | null;
  const idInput = document.getElementById('config-detail-id') as HTMLInputElement | null;
  const keyInput = document.getElementById('config-detail-key') as HTMLInputElement | null;
  const valueInput = document.getElementById('config-detail-value') as HTMLTextAreaElement | null;
  const descriptionInput = document.getElementById(
    'config-detail-description',
  ) as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById('config-detail-submit') as HTMLButtonElement | null;
  const errorEl = document.getElementById('config-detail-error') as HTMLElement | null;
  const tableBody = document.getElementById('cms-configs-tbody') as HTMLTableSectionElement | null;
  const searchInput = document.getElementById('cms-configs-search') as HTMLInputElement | null;
  const countEl = document.getElementById('cms-configs-count');
  const emptyEl = document.getElementById('cms-configs-empty');
  const newBtn = document.getElementById('cms-config-new-btn');
  const newEmptyBtn = document.querySelector('[data-open-config-new]');

  if (!dialog || !form || !idInput || !keyInput || !valueInput || !descriptionInput || !tableBody)
    return;

  const idField = idInput;
  const keyField = keyInput;
  const valueField = valueInput;
  const descriptionField = descriptionInput;

  const list = createListEditor<ConfigEntry>({
    endpoint: '/cms/api/configs',
    responseKey: 'configs',
    tbody: tableBody,
    rowId: (entry) => entry.id,
    editLabel: ct('common.edit'),
    deleteLabel: ct('common.delete'),
    columns: [
      { cellClass: 'cms-table-cell-monospace', cell: (entry) => ({ text: entry.key }) },
      {
        cellClass: 'cms-table-cell-monospace cms-configs-value-cell',
        cell: (entry) => ({ text: maskConfigValue(entry.value || '') }),
      },
      {
        cellClass: 'cms-configs-description-cell',
        // A raw cell to keep the full-description hover tooltip (the original had title= on the td).
        // Both the title and the text are escaped INSIDE raw() — the sanctioned hand-escape surface.
        cell: (entry) => ({
          html: raw(
            `<span title="${escapeAttr(entry.description || '')}">${escapeHtml(entry.description || '—')}</span>`,
          ),
        }),
      },
    ],
    transform: (rows) =>
      [...rows].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })),
    onEdit: (entry) => openEdit(entry.id),
    confirmDelete: (entry) => ({
      message: ct('configs.deleteConfirm', { key: entry.key || '' }),
      confirmLabel: ct('common.delete'),
    }),
    deletedToast: ct('configs.deleted'),
    countLabel: (count) => ct('configs.count', { count }),
    countEl,
    emptyEl,
    searchEl: searchInput,
    filter: (entry, query) =>
      entry.key.toLowerCase().includes(query) ||
      entry.value.toLowerCase().includes(query) ||
      (entry.description || '').toLowerCase().includes(query),
  });

  function setFormTitle(title: string, submitLabel: string): void {
    if (titleEl) titleEl.textContent = title;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function resetForm(): void {
    idField.value = '';
    keyField.value = '';
    valueField.value = '';
    descriptionField.value = '';
    setInlineError(errorEl);
  }

  function openNew(): void {
    resetForm();
    setFormTitle(ct('configs.newParamForm'), ct('common.create'));
    openDialog(dialog);
    keyField.focus();
  }

  async function openEdit(id: string): Promise<void> {
    if (list.getState().length === 0) await list.refresh();
    const entry = list.getState().find((item) => item.id === id);
    if (!entry) return;

    idField.value = entry.id;
    keyField.value = entry.key || '';
    valueField.value = entry.value || '';
    descriptionField.value = entry.description || '';
    setInlineError(errorEl);
    setFormTitle(ct('configs.editParamForm'), ct('common.save'));
    openDialog(dialog);
    keyField.focus();
  }

  function validateForm(): string | null {
    const keyValue = keyField.value.trim();
    if (!keyValue) return ct('errors.configKeyRequired');
    if (!configKeyRegex.test(keyValue)) return ct('errors.invalidConfigKey');
    return null;
  }

  async function saveCurrent(): Promise<void> {
    const validationError = validateForm();
    if (validationError) {
      setInlineError(errorEl, validationError);
      return;
    }

    const id = idField.value.trim();
    const payload = {
      key: keyField.value.trim(),
      value: valueField.value,
      description: descriptionField.value.trim(),
    };

    setInlineError(errorEl);

    await fetchOk(id ? `/cms/api/configs/${encodeURIComponent(id)}` : '/cms/api/configs', {
      method: id ? 'PUT' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    closeDialog(dialog);
    showToast(id ? ct('configs.updated') : ct('configs.created'), 'success');
    await list.refresh();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCurrent().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setInlineError(errorEl, message);
      await showAlert(message);
    });
  });

  submitBtn?.addEventListener('click', () => {
    form.requestSubmit();
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target === dialog || target.getAttribute('data-close-modal') === 'config-detail-modal') {
      closeDialog(dialog);
      setInlineError(errorEl);
    }
  });

  newBtn?.addEventListener('click', openNew);
  newEmptyBtn?.addEventListener('click', openNew);

  list.refresh().catch(async (error) => {
    await showAlert(error instanceof Error ? error.message : String(error));
  });
}
