/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { RedirectRule } from '../../../types/index.js';
import { normalizeRedirectPath } from '../../../utils/redirects.js';
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
import { escapeHtml } from '../../../utils/html-escape.js';
import { createListEditor, raw } from './list-editor.js';

/** Trusted badge markup: the class is a closed choice and the text is escaped inside raw(). */
function badge(tone: 'success' | 'neutral', text: string): ReturnType<typeof raw> {
  return raw(`<span class="cms-badge cms-badge-${tone}">${escapeHtml(text)}</span>`);
}

export function initRedirectsEditor(): void {
  const dialog = document.getElementById('redirect-detail-modal') as HTMLDialogElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const idInput = document.getElementById('redirect-detail-id') as HTMLInputElement | null;
  const fromInput = document.getElementById('redirect-detail-from') as HTMLInputElement | null;
  const toInput = document.getElementById('redirect-detail-to') as HTMLInputElement | null;
  const statusCodeInput = document.getElementById(
    'redirect-detail-status-code',
  ) as HTMLSelectElement | null;
  const enabledInput = document.getElementById(
    'redirect-detail-enabled',
  ) as HTMLInputElement | null;
  const submitBtn = document.getElementById('redirect-detail-submit') as HTMLButtonElement | null;
  const form = document.getElementById('redirect-detail-form') as HTMLFormElement | null;
  const errorEl = document.getElementById('redirect-detail-error') as HTMLElement | null;
  const redirectsTbody = document.getElementById(
    'cms-redirects-tbody',
  ) as HTMLTableSectionElement | null;
  const redirectsSearch = document.getElementById(
    'cms-redirects-search',
  ) as HTMLInputElement | null;
  const redirectsCount = document.getElementById('cms-redirects-count');
  const redirectsEmpty = document.getElementById('cms-redirects-empty');
  const newBtn = document.getElementById('cms-redirect-new-btn');
  const newEmptyBtn = document.querySelector('[data-open-redirect-new]');

  if (
    !dialog ||
    !redirectsTbody ||
    !form ||
    !idInput ||
    !fromInput ||
    !toInput ||
    !statusCodeInput ||
    !enabledInput
  )
    return;

  const idField = idInput;
  const fromField = fromInput;
  const toField = toInput;
  const statusCodeField = statusCodeInput;
  const enabledField = enabledInput;

  const list = createListEditor<RedirectRule>({
    endpoint: '/cms/api/redirects',
    responseKey: 'redirects',
    tbody: redirectsTbody,
    rowId: (entry) => entry.id,
    editLabel: ct('common.edit'),
    deleteLabel: ct('common.delete'),
    columns: [
      { cellClass: 'cms-table-cell-monospace', cell: (entry) => ({ text: entry.from }) },
      { cellClass: 'cms-table-cell-monospace', cell: (entry) => ({ text: entry.to }) },
      { cell: (entry) => ({ html: badge('neutral', String(entry.statusCode)) }) },
      {
        cell: (entry) => ({
          html: badge(
            entry.enabled !== false ? 'success' : 'neutral',
            entry.enabled !== false ? ct('redirects.statusActive') : ct('redirects.statusInactive'),
          ),
        }),
      },
    ],
    onEdit: (entry) => openEdit(entry.id),
    confirmDelete: (entry) => ({
      message: ct('redirects.deleteConfirm', { from: entry.from || '', to: entry.to || '' }),
      confirmLabel: ct('common.delete'),
    }),
    deletedToast: ct('redirects.deleted'),
    countLabel: (count) => ct('redirects.count', { count }),
    countEl: redirectsCount,
    emptyEl: redirectsEmpty,
    searchEl: redirectsSearch,
    filter: (entry, query) =>
      entry.from.toLowerCase().includes(query) || entry.to.toLowerCase().includes(query),
    localeAware: true,
  });

  function setFormTitle(title: string, submitLabel: string): void {
    if (titleEl) titleEl.textContent = title;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function normalizePathInput(rawPath: string): string {
    return normalizeRedirectPath(rawPath || '/');
  }

  function validatePath(
    rawPath: string,
    fieldKey: 'redirects.labelFrom' | 'redirects.labelTo',
  ): string | null {
    const value = rawPath.trim();
    const field = ct(fieldKey);
    if (!value) return ct('redirects.pathRequired', { field });
    if (/^https?:\/\//i.test(value)) return ct('redirects.pathMustBeInternal', { field });
    if (!value.startsWith('/')) return ct('redirects.pathMustStartSlash', { field });
    if (value.includes('?') || value.includes('#'))
      return ct('redirects.pathNoQueryFragment', { field });
    return null;
  }

  function clientValidation(fromValue: string, toValue: string): string | null {
    const fromError = validatePath(fromValue, 'redirects.labelFrom');
    if (fromError) return fromError;

    const toError = validatePath(toValue, 'redirects.labelTo');
    if (toError) return toError;

    if (normalizePathInput(fromValue) === normalizePathInput(toValue))
      return ct('errors.redirectSameFromTo');
    return null;
  }

  function resetForm(): void {
    idField.value = '';
    fromField.value = '';
    toField.value = '';
    statusCodeField.value = '301';
    enabledField.checked = true;
    setInlineError(errorEl);
  }

  function openNew(): void {
    resetForm();
    setFormTitle(ct('redirects.newRedirect'), ct('common.create'));
    openDialog(dialog);
    fromField.focus();
  }

  async function openEdit(id: string): Promise<void> {
    if (list.getState().length === 0) await list.refresh();
    const entry = list.getState().find((item) => item.id === id);
    if (!entry) return;

    idField.value = entry.id;
    fromField.value = entry.from || '/';
    toField.value = entry.to || '/';
    statusCodeField.value = String(entry.statusCode || 301);
    enabledField.checked = entry.enabled !== false;
    setInlineError(errorEl);
    setFormTitle(ct('redirects.modalTitle'), ct('common.save'));
    openDialog(dialog);
    fromField.focus();
  }

  async function saveCurrent(): Promise<void> {
    const id = idField.value.trim();
    const validationError = clientValidation(fromField.value, toField.value);
    if (validationError) {
      setInlineError(errorEl, validationError);
      return;
    }

    setInlineError(errorEl);
    const payload = {
      from: normalizePathInput(fromField.value),
      to: normalizePathInput(toField.value),
      statusCode: statusCodeField.value === '302' ? 302 : 301,
      enabled: enabledField.checked,
    };

    await fetchOk(id ? `/cms/api/redirects/${encodeURIComponent(id)}` : '/cms/api/redirects', {
      method: id ? 'PUT' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    closeDialog(dialog);
    showToast(id ? ct('redirects.updated') : ct('redirects.created'), 'success');
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

  newBtn?.addEventListener('click', openNew);
  newEmptyBtn?.addEventListener('click', openNew);

  list.refresh().catch(async (error) => {
    await showAlert(error instanceof Error ? error.message : String(error));
  });
}
