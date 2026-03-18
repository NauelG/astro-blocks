/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import Sortable from 'sortablejs';
import type { MenuItem, MenusData } from '../../../types/index.js';
import { authHeaders, closeDialog, escapeHtml, fetchJson, fetchOk, getCmsToken, openDialog, showAlert, showConfirm } from './common.js';

const SELECTOR_REGEX = /^[a-zA-Z0-9_-]+$/;

interface EditableMenu {
  name: string;
  selector: string;
  items: MenuItem[];
}

export function initMenusEditor(): void {
  const dialog = document.getElementById('menu-detail-modal') as HTMLDialogElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const idInput = document.getElementById('menu-detail-id') as HTMLInputElement | null;
  const nameInput = document.getElementById('menu-detail-name') as HTMLInputElement | null;
  const selectorInput = document.getElementById('menu-detail-selector') as HTMLInputElement | null;
  const selectorHint = document.getElementById('menu-detail-selector-hint') as HTMLElement | null;
  const addItemBtn = document.getElementById('menu-detail-add-item') as HTMLButtonElement | null;
  const tbody = document.getElementById('menu-detail-items-tbody') as HTMLTableSectionElement | null;
  const submitBtn = document.getElementById('menu-detail-submit') as HTMLButtonElement | null;
  const errorEl = document.getElementById('menu-detail-error') as HTMLElement | null;

  if (!dialog || !tbody) return;
  const itemsTableBody = tbody;

  let currentMenu: EditableMenu = { name: '', selector: '', items: [] };
  let sortableMain: Sortable | null = null;
  const sortableChildren: Sortable[] = [];

  function setError(message = ''): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.toggle('cms-hidden', !message);
  }

  function setSelectorHint(valid: boolean, message = ''): void {
    if (!selectorHint) return;
    selectorHint.textContent = message;
    selectorHint.classList.toggle('cms-hidden', !message);
    selectorHint.style.color = valid ? '' : 'var(--pico-del-color)';
  }

  function destroySortables(): void {
    sortableMain?.destroy();
    sortableMain = null;
    sortableChildren.forEach((sortable) => sortable.destroy());
    sortableChildren.length = 0;
  }

  function validatePaths(items: MenuItem[]): string | null {
    for (const item of items) {
      if (!item.path?.trim()) return 'La ruta es obligatoria en todos los elementos.';
      if (Array.isArray(item.children)) {
        const childError = validatePaths(item.children);
        if (childError) return childError;
      }
    }
    return null;
  }

  function renderChildRow(itemIndex: number, childIndex: number, child: MenuItem): string {
    return (
      `<div class="menu-child-row cms-stack" data-item-index="${itemIndex}" data-child-index="${childIndex}">` +
      '<div class="cms-cluster" style="align-items: center; gap: 0.25rem;">' +
      '<span class="cms-drag-handle" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>' +
      `<input type="text" class="menu-child-name cms-input" placeholder="Nombre" value="${escapeHtml(child.name ?? '')}" data-field="name"/>` +
      `<input type="text" class="menu-child-path cms-input" placeholder="/ruta" value="${escapeHtml(child.path ?? '')}" data-field="path"/>` +
      '<button type="button" class="cms-table-btn-delete menu-child-delete" aria-label="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</div></div>'
    );
  }

  function renderItemRow(itemIndex: number, item: MenuItem): string {
    const childrenHtml = (item.children || []).map((child, childIndex) => renderChildRow(itemIndex, childIndex, child)).join('');
    return (
      `<tr data-item-index="${itemIndex}">` +
      '<td class="cms-table-actions"><span class="cms-drag-handle" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span></td>' +
      `<td><input type="text" class="cms-input menu-item-name" placeholder="Nombre" value="${escapeHtml(item.name ?? '')}" data-field="name"/></td>` +
      `<td><input type="text" class="cms-input menu-item-path" placeholder="/ruta" value="${escapeHtml(item.path ?? '')}" data-field="path"/></td>` +
      `<td><div class="menu-children-wrap"><div class="menu-children-list" id="menu-children-${itemIndex}">${childrenHtml}</div><button type="button" class="cms-btn cms-btn-secondary menu-add-child-btn" data-item-index="${itemIndex}">Añadir submenú</button></div></td>` +
      `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete menu-item-delete" data-item-index="${itemIndex}" aria-label="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>` +
      '</tr>'
    );
  }

  function syncItemsFromDom(): void {
    const rows = itemsTableBody.querySelectorAll<HTMLTableRowElement>('tr[data-item-index]');
    if (rows.length === 0) {
      currentMenu.items = [];
      return;
    }

    currentMenu.items = Array.from(rows).map((row) => {
      const name = (row.querySelector('.menu-item-name') as HTMLInputElement | null)?.value || '';
      const itemPath = (row.querySelector('.menu-item-path') as HTMLInputElement | null)?.value || '';
      const childRows = row.querySelectorAll<HTMLElement>('.menu-child-row');
      const children = Array.from(childRows).map((childRow) => ({
        name: (childRow.querySelector('.menu-child-name') as HTMLInputElement | null)?.value || '',
        path: (childRow.querySelector('.menu-child-path') as HTMLInputElement | null)?.value || '',
      }));

      return {
        name,
        path: itemPath,
        ...(children.length > 0 ? { children } : {}),
      };
    });
  }

  function syncChildrenOrderFromDom(itemIndex: number): void {
    const row = itemsTableBody.querySelector<HTMLTableRowElement>(`tr[data-item-index="${itemIndex}"]`);
    if (!row) return;

    const list = row.querySelector('.menu-children-list');
    if (!list || !currentMenu.items[itemIndex]) return;

    currentMenu.items[itemIndex].children = Array.from(list.querySelectorAll<HTMLElement>('.menu-child-row')).map((childRow) => ({
      name: (childRow.querySelector('.menu-child-name') as HTMLInputElement | null)?.value || '',
      path: (childRow.querySelector('.menu-child-path') as HTMLInputElement | null)?.value || '',
    }));
  }

  function reRenderItems(): void {
    destroySortables();
    itemsTableBody.innerHTML = currentMenu.items.map((item, index) => renderItemRow(index, item)).join('');

    currentMenu.items.forEach((_, itemIndex) => {
      const row = itemsTableBody.querySelector<HTMLTableRowElement>(`tr[data-item-index="${itemIndex}"]`);
      const list = row?.querySelector<HTMLElement>('.menu-children-list');
      if (!list) return;

      sortableChildren.push(
        Sortable.create(list, {
          handle: '.cms-drag-handle',
          ghostClass: 'cms-dragging',
          onEnd() {
            syncChildrenOrderFromDom(itemIndex);
          },
        })
      );
    });

    sortableMain = Sortable.create(itemsTableBody, {
      handle: '.cms-drag-handle',
      ghostClass: 'cms-dragging',
      onEnd() {
        syncItemsFromDom();
      },
    });

    itemsTableBody.querySelectorAll<HTMLInputElement>('.menu-item-name, .menu-item-path').forEach((input) => {
      input.addEventListener('input', syncItemsFromDom);
      input.addEventListener('change', syncItemsFromDom);
    });

    itemsTableBody.querySelectorAll<HTMLInputElement>('.menu-child-name, .menu-child-path').forEach((input) => {
      input.addEventListener('input', () => {
        const row = input.closest<HTMLElement>('.menu-child-row');
        if (!row) return;
        syncChildrenOrderFromDom(Number.parseInt(row.dataset.itemIndex || '', 10));
      });
    });

    itemsTableBody.querySelectorAll<HTMLButtonElement>('.menu-item-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.itemIndex || '', 10);
        if (Number.isNaN(index)) return;
        currentMenu.items.splice(index, 1);
        reRenderItems();
      });
    });

    itemsTableBody.querySelectorAll<HTMLButtonElement>('.menu-add-child-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.itemIndex || '', 10);
        if (Number.isNaN(index) || !currentMenu.items[index]) return;
        currentMenu.items[index].children ||= [];
        currentMenu.items[index].children?.push({ name: '', path: '' });
        reRenderItems();
      });
    });

    itemsTableBody.querySelectorAll<HTMLButtonElement>('.menu-child-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest<HTMLElement>('.menu-child-row');
        if (!row) return;
        const itemIndex = Number.parseInt(row.dataset.itemIndex || '', 10);
        const childIndex = Number.parseInt(row.dataset.childIndex || '', 10);
        const item = currentMenu.items[itemIndex];
        if (!item?.children) return;
        item.children.splice(childIndex, 1);
        reRenderItems();
      });
    });
  }

  function openNew(): void {
    currentMenu = { name: '', selector: '', items: [] };
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (selectorInput) selectorInput.value = '';
    setSelectorHint(false, '');
    setError('');
    reRenderItems();
    if (titleEl) titleEl.textContent = 'Nuevo menú';
    if (submitBtn) submitBtn.textContent = 'Crear';
    openDialog(dialog);
  }

  async function openEdit(id: string): Promise<void> {
    try {
      const data = await fetchJson<MenusData>('/cms/api/menus', {
        headers: { Authorization: `Bearer ${getCmsToken()}` },
      });
      const menu = data.menus.find((entry) => entry.id === id);
      if (!menu) return;

      currentMenu = {
        name: menu.name || '',
        selector: menu.selector || '',
        items: Array.isArray(menu.items) ? JSON.parse(JSON.stringify(menu.items)) : [],
      };

      if (idInput) idInput.value = menu.id;
      if (nameInput) nameInput.value = currentMenu.name;
      if (selectorInput) selectorInput.value = currentMenu.selector;
      setSelectorHint(false, '');
      setError('');
      reRenderItems();
      if (titleEl) titleEl.textContent = 'Editar menú';
      if (submitBtn) submitBtn.textContent = 'Guardar';
      openDialog(dialog);
    } catch {
      setError('Error al cargar el menú.');
    }
  }

  async function doSubmit(): Promise<void> {
    syncItemsFromDom();

    const name = nameInput?.value.trim() || '';
    const selector = selectorInput?.value.trim() || '';

    setError('');
    if (!selector) {
      setSelectorHint(false, 'El selector es obligatorio.');
      return;
    }
    if (!SELECTOR_REGEX.test(selector)) {
      setSelectorHint(false, 'Solo letras, números, guiones y guiones bajos (sin espacios).');
      return;
    }

    setSelectorHint(true, '');
    const pathError = validatePaths(currentMenu.items);
    if (pathError) {
      setError(pathError);
      return;
    }

    const id = idInput?.value.trim() || '';
    const payload = { name: name || 'Menú', selector, items: currentMenu.items };

    try {
      await fetchOk(id ? `/cms/api/menus/${encodeURIComponent(id)}` : '/cms/api/menus', {
        method: id ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      closeDialog(dialog);
      location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error al guardar.');
    }
  }

  async function deleteMenu(id: string): Promise<void> {
    const ok = await showConfirm('¿Eliminar este menú?', 'Eliminar');
    if (!ok) return;

    try {
      const response = await fetch(`/cms/api/menus/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getCmsToken()}` },
      });
      if (response.status !== 204) throw new Error('Error al eliminar');
      location.reload();
    } catch {
      await showAlert('Error al eliminar', 'Error');
    }
  }

  selectorInput?.addEventListener('input', () => {
    const value = selectorInput.value.trim();
    if (!value) {
      setSelectorHint(false, '');
      return;
    }
    setSelectorHint(SELECTOR_REGEX.test(value), SELECTOR_REGEX.test(value) ? '' : 'Solo letras, números, guiones y guiones bajos (sin espacios).');
  });

  addItemBtn?.addEventListener('click', () => {
    currentMenu.items.push({ name: '', path: '' });
    reRenderItems();
  });

  submitBtn?.addEventListener('click', () => void doSubmit());
  document.getElementById('cms-menu-new-btn')?.addEventListener('click', openNew);
  document.querySelectorAll<HTMLElement>('.cms-menu-edit').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id');
      if (id) void openEdit(id);
    });
  });
  document.querySelectorAll<HTMLElement>('.cms-menu-delete').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id');
      if (id) void deleteMenu(id);
    });
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('data-close-modal') === 'menu-detail-modal' || target === dialog) {
      closeDialog(dialog);
    }
  });
  dialog.addEventListener('cancel', () => closeDialog(dialog));
}
