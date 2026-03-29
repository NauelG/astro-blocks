/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ConfigEntry, ConfigsData } from '../../../types/index.js';
import { authHeaders, closeDialog, escapeHtml, fetchJson, fetchOk, openDialog, showAlert, showConfirm, showToast } from './common.js';

const pencilSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const trashSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
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
  const descriptionInput = document.getElementById('config-detail-description') as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById('config-detail-submit') as HTMLButtonElement | null;
  const errorEl = document.getElementById('config-detail-error') as HTMLElement | null;
  const tableBody = document.getElementById('cms-configs-tbody') as HTMLTableSectionElement | null;
  const searchInput = document.getElementById('cms-configs-search') as HTMLInputElement | null;
  const countEl = document.getElementById('cms-configs-count');
  const emptyEl = document.getElementById('cms-configs-empty');
  const newBtn = document.getElementById('cms-config-new-btn');
  const newEmptyBtn = document.querySelector('[data-open-config-new]');

  if (!dialog || !form || !idInput || !keyInput || !valueInput || !descriptionInput || !tableBody) return;

  const idField = idInput;
  const keyField = keyInput;
  const valueField = valueInput;
  const descriptionField = descriptionInput;
  const configsTableBody = tableBody;

  let configsState: ConfigEntry[] = [];

  function setError(message = ''): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.toggle('cms-hidden', !message);
  }

  function setFormTitle(title: string, submitLabel: string): void {
    if (titleEl) titleEl.textContent = title;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function resetForm(): void {
    idField.value = '';
    keyField.value = '';
    valueField.value = '';
    descriptionField.value = '';
    setError('');
  }

  function openNew(): void {
    resetForm();
    setFormTitle('Nuevo parámetro', 'Crear');
    openDialog(dialog);
    keyField.focus();
  }

  async function openEdit(id: string): Promise<void> {
    if (configsState.length === 0) await refreshConfigs();
    const entry = configsState.find((item) => item.id === id);
    if (!entry) return;

    idField.value = entry.id;
    keyField.value = entry.key || '';
    valueField.value = entry.value || '';
    descriptionField.value = entry.description || '';
    setError('');
    setFormTitle('Editar parámetro', 'Guardar');
    openDialog(dialog);
    keyField.focus();
  }

  function validateForm(): string | null {
    const keyValue = keyField.value.trim();
    if (!keyValue) return 'La clave es obligatoria.';
    if (!configKeyRegex.test(keyValue)) {
      return 'La clave debe empezar por una letra y solo puede contener letras, números, punto, guion y guion bajo.';
    }
    return null;
  }

  function filteredConfigs(): ConfigEntry[] {
    const query = searchInput?.value.trim().toLowerCase() || '';
    if (!query) return configsState;

    return configsState.filter((entry) => {
      return (
        entry.key.toLowerCase().includes(query) ||
        entry.value.toLowerCase().includes(query) ||
        (entry.description || '').toLowerCase().includes(query)
      );
    });
  }

  function bindRows(): void {
    configsTableBody.querySelectorAll<HTMLElement>('.cms-config-edit').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.id || '';
        if (!id) return;
        openEdit(id).catch((error) => showAlert(error instanceof Error ? error.message : String(error)));
      });
    });

    configsTableBody.querySelectorAll<HTMLElement>('.cms-config-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.id || '';
        if (!id) return;

        const entry = configsState.find((item) => item.id === id);
        const confirmed = await showConfirm(`¿Eliminar el parámetro ${entry?.key || ''}?`, 'Eliminar');
        if (!confirmed) return;

        try {
          await fetchOk(`/cms/api/configs/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders(false),
          });
          showToast('Parámetro eliminado.', 'success');
          await refreshConfigs();
        } catch (error) {
          await showAlert(error instanceof Error ? error.message : String(error));
        }
      });
    });
  }

  function renderTable(): void {
    const list = filteredConfigs();
    configsTableBody.innerHTML = list
      .map((entry) => (
        `<tr data-id="${escapeHtml(entry.id)}">` +
        `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-config-edit" data-id="${escapeHtml(entry.id)}" aria-label="Editar">${pencilSvg}</button></td>` +
        `<td class="cms-table-cell-monospace">${escapeHtml(entry.key)}</td>` +
        `<td class="cms-table-cell-monospace cms-configs-value-cell">${escapeHtml(maskConfigValue(entry.value || ''))}</td>` +
        `<td class="cms-configs-description-cell" title="${escapeHtml(entry.description || '')}">${escapeHtml(entry.description || '—')}</td>` +
        `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-config-delete" data-id="${escapeHtml(entry.id)}" aria-label="Eliminar">${trashSvg}</button></td>` +
        '</tr>'
      ))
      .join('');

    if (countEl) countEl.textContent = `${list.length} parámetros`;
    emptyEl?.classList.toggle('cms-hidden', list.length > 0);
    bindRows();
  }

  async function refreshConfigs(): Promise<void> {
    const data = await fetchJson<ConfigsData>('/cms/api/configs', {
      headers: authHeaders(false),
    });

    configsState = Array.isArray(data.configs)
      ? [...data.configs].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }))
      : [];

    renderTable();
  }

  async function saveCurrent(): Promise<void> {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const id = idField.value.trim();
    const payload = {
      key: keyField.value.trim(),
      value: valueField.value,
      description: descriptionField.value.trim(),
    };

    setError('');

    await fetchOk(id ? `/cms/api/configs/${encodeURIComponent(id)}` : '/cms/api/configs', {
      method: id ? 'PUT' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    closeDialog(dialog);
    showToast(id ? 'Parámetro actualizado.' : 'Parámetro creado.', 'success');
    await refreshConfigs();
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

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target === dialog || target.getAttribute('data-close-modal') === 'config-detail-modal') {
      closeDialog(dialog);
      setError('');
    }
  });

  newBtn?.addEventListener('click', openNew);
  newEmptyBtn?.addEventListener('click', openNew);
  searchInput?.addEventListener('input', renderTable);

  refreshConfigs().catch(async (error) => {
    await showAlert(error instanceof Error ? error.message : String(error));
  });
}
