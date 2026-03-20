/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { RedirectRule, RedirectsData } from '../../../types/index.js';
import { normalizeRedirectPath } from '../../../utils/redirects.js';
import { authHeaders, closeDialog, escapeHtml, fetchJson, fetchOk, openDialog, showAlert, showConfirm, showToast } from './common.js';

const pencilSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const trashSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

export function initRedirectsEditor(): void {
  const dialog = document.getElementById('redirect-detail-modal') as HTMLDialogElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const idInput = document.getElementById('redirect-detail-id') as HTMLInputElement | null;
  const fromInput = document.getElementById('redirect-detail-from') as HTMLInputElement | null;
  const toInput = document.getElementById('redirect-detail-to') as HTMLInputElement | null;
  const statusCodeInput = document.getElementById('redirect-detail-status-code') as HTMLSelectElement | null;
  const enabledInput = document.getElementById('redirect-detail-enabled') as HTMLInputElement | null;
  const submitBtn = document.getElementById('redirect-detail-submit') as HTMLButtonElement | null;
  const form = document.getElementById('redirect-detail-form') as HTMLFormElement | null;
  const errorEl = document.getElementById('redirect-detail-error') as HTMLElement | null;
  const redirectsTbody = document.getElementById('cms-redirects-tbody') as HTMLTableSectionElement | null;
  const redirectsSearch = document.getElementById('cms-redirects-search') as HTMLInputElement | null;
  const redirectsCount = document.getElementById('cms-redirects-count');
  const redirectsEmpty = document.getElementById('cms-redirects-empty');
  const newBtn = document.getElementById('cms-redirect-new-btn');
  const newEmptyBtn = document.querySelector('[data-open-redirect-new]');

  if (!dialog || !redirectsTbody || !form || !idInput || !fromInput || !toInput || !statusCodeInput || !enabledInput) return;

  const idField = idInput;
  const fromField = fromInput;
  const toField = toInput;
  const statusCodeField = statusCodeInput;
  const enabledField = enabledInput;
  const redirectsTableBody = redirectsTbody;

  let redirectsState: RedirectRule[] = [];

  function setError(message = ''): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.toggle('cms-hidden', !message);
  }

  function setFormTitle(title: string, submitLabel: string): void {
    if (titleEl) titleEl.textContent = title;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function normalizePathInput(raw: string): string {
    return normalizeRedirectPath(raw || '/');
  }

  function validatePath(raw: string, fieldLabel: 'origen' | 'destino'): string | null {
    const value = raw.trim();
    if (!value) return `La ruta de ${fieldLabel} es obligatoria.`;
    if (/^https?:\/\//i.test(value)) return `La ruta de ${fieldLabel} debe ser interna (no se permiten URLs absolutas).`;
    if (!value.startsWith('/')) return `La ruta de ${fieldLabel} debe comenzar con "/".`;
    if (value.includes('?') || value.includes('#')) return `La ruta de ${fieldLabel} no puede incluir query ni fragmento.`;
    return null;
  }

  function clientValidation(fromValue: string, toValue: string): string | null {
    const fromError = validatePath(fromValue, 'origen');
    if (fromError) return fromError;

    const toError = validatePath(toValue, 'destino');
    if (toError) return toError;

    const normalizedFrom = normalizePathInput(fromValue);
    const normalizedTo = normalizePathInput(toValue);
    if (normalizedFrom === normalizedTo) return 'La ruta de origen y la de destino no pueden ser iguales.';
    return null;
  }

  function resetForm(): void {
    idField.value = '';
    fromField.value = '';
    toField.value = '';
    statusCodeField.value = '301';
    enabledField.checked = true;
    setError('');
  }

  function openNew(): void {
    resetForm();
    setFormTitle('Nueva redirección', 'Crear');
    openDialog(dialog);
    fromField.focus();
  }

  async function openEdit(id: string): Promise<void> {
    if (redirectsState.length === 0) await refreshRedirects();
    const entry = redirectsState.find((item) => item.id === id);
    if (!entry) return;

    idField.value = entry.id;
    fromField.value = entry.from || '/';
    toField.value = entry.to || '/';
    statusCodeField.value = String(entry.statusCode || 301);
    enabledField.checked = entry.enabled !== false;
    setError('');
    setFormTitle('Editar redirección', 'Guardar');
    openDialog(dialog);
    fromField.focus();
  }

  function filteredRedirects(): RedirectRule[] {
    const query = redirectsSearch?.value.trim().toLowerCase() || '';
    if (!query) return redirectsState;
    return redirectsState.filter((entry) => {
      return entry.from.toLowerCase().includes(query) || entry.to.toLowerCase().includes(query);
    });
  }

  function bindRows(): void {
    redirectsTableBody.querySelectorAll<HTMLElement>('.cms-redirect-edit').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.id || '';
        if (!id) return;
        openEdit(id).catch((error) => showAlert(error instanceof Error ? error.message : String(error)));
      });
    });

    redirectsTableBody.querySelectorAll<HTMLElement>('.cms-redirect-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.id || '';
        if (!id) return;

        const entry = redirectsState.find((item) => item.id === id);
        const confirmed = await showConfirm(
          `¿Eliminar la redirección ${entry?.from || ''} → ${entry?.to || ''}?`,
          'Eliminar'
        );
        if (!confirmed) return;

        try {
          await fetchOk(`/cms/api/redirects/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders(false),
          });
          showToast('Redirección eliminada.', 'success');
          await refreshRedirects();
        } catch (error) {
          await showAlert(error instanceof Error ? error.message : String(error));
        }
      });
    });
  }

  function renderTable(): void {
    const list = filteredRedirects();
    redirectsTableBody.innerHTML = list
      .map((entry) => (
        `<tr data-id="${escapeHtml(entry.id)}">` +
        `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-redirect-edit" data-id="${escapeHtml(entry.id)}" aria-label="Editar">${pencilSvg}</button></td>` +
        `<td class="cms-table-cell-monospace">${escapeHtml(entry.from)}</td>` +
        `<td class="cms-table-cell-monospace">${escapeHtml(entry.to)}</td>` +
        `<td><span class="cms-badge cms-badge-neutral">${entry.statusCode}</span></td>` +
        `<td><span class="cms-badge ${entry.enabled !== false ? 'cms-badge-success' : 'cms-badge-neutral'}">${entry.enabled !== false ? 'Activa' : 'Inactiva'}</span></td>` +
        `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-redirect-delete" data-id="${escapeHtml(entry.id)}" aria-label="Eliminar">${trashSvg}</button></td>` +
        '</tr>'
      ))
      .join('');

    if (redirectsCount) redirectsCount.textContent = `${list.length} redirecciones`;
    redirectsEmpty?.classList.toggle('cms-hidden', list.length > 0);
    bindRows();
  }

  async function refreshRedirects(): Promise<void> {
    const data = await fetchJson<RedirectsData>('/cms/api/redirects', {
      headers: authHeaders(false),
    });
    redirectsState = Array.isArray(data.redirects) ? data.redirects : [];
    renderTable();
  }

  async function saveCurrent(): Promise<void> {
    const id = idField.value.trim();
    const fromRaw = fromField.value;
    const toRaw = toField.value;
    const validationError = clientValidation(fromRaw, toRaw);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    const payload = {
      from: normalizePathInput(fromRaw),
      to: normalizePathInput(toRaw),
      statusCode: statusCodeField.value === '302' ? 302 : 301,
      enabled: enabledField.checked,
    };

    await fetchOk(id ? `/cms/api/redirects/${encodeURIComponent(id)}` : '/cms/api/redirects', {
      method: id ? 'PUT' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    closeDialog(dialog);
    showToast(id ? 'Redirección actualizada.' : 'Redirección creada.', 'success');
    await refreshRedirects();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCurrent().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      await showAlert(message);
    });
  });

  submitBtn?.addEventListener('click', () => {
    form.requestSubmit();
  });

  newBtn?.addEventListener('click', openNew);
  newEmptyBtn?.addEventListener('click', openNew);
  redirectsSearch?.addEventListener('input', renderTable);

  window.addEventListener('cms:content-locale-change', () => {
    refreshRedirects().catch(() => {});
  });

  refreshRedirects().catch(async (error) => {
    await showAlert(error instanceof Error ? error.message : String(error));
  });
}
