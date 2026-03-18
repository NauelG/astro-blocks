/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import Sortable from 'sortablejs';
import type { Menu, MenuItem, MenusData } from '../../../types/index.js';
import { authHeaders, closeDialog, escapeHtml, fetchJson, fetchOk, getCmsToken, openDialog, showAlert, showConfirm, showToast } from './common.js';

const SELECTOR_REGEX = /^[a-zA-Z0-9_-]+$/;
const dragHandleSvg =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
const trashSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const pencilSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const chevronDownSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

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
  const itemsList = document.getElementById('menu-detail-items-list') as HTMLElement | null;
  const emptyList = document.getElementById('menu-detail-empty');
  const submitBtn = document.getElementById('menu-detail-submit') as HTMLButtonElement | null;
  const errorEl = document.getElementById('menu-detail-error') as HTMLElement | null;
  const menusTbody = document.getElementById('cms-menus-tbody') as HTMLTableSectionElement | null;
  const menusSearch = document.getElementById('cms-menus-search') as HTMLInputElement | null;
  const menusCount = document.getElementById('cms-menus-count');
  const menusEmpty = document.getElementById('cms-menus-empty');

  if (!dialog || !itemsList || !menusTbody) return;
  const menuItemsList = itemsList;
  const menusTableBody = menusTbody;

  let currentMenu: EditableMenu = { name: '', selector: '', items: [] };
  let menusState: Menu[] = [];
  let expandedItemIndex: number | null = null;
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

  function syncItemsFromDom(): void {
    const cards = menuItemsList.querySelectorAll<HTMLElement>('.cms-menu-card[data-item-index]');
    currentMenu.items = Array.from(cards).map((card) => {
      const name = (card.querySelector('.menu-item-name') as HTMLInputElement | null)?.value || '';
      const path = (card.querySelector('.menu-item-path') as HTMLInputElement | null)?.value || '';
      const children = Array.from(card.querySelectorAll<HTMLElement>('.menu-child-row')).map((childRow) => ({
        name: (childRow.querySelector('.menu-child-name') as HTMLInputElement | null)?.value || '',
        path: (childRow.querySelector('.menu-child-path') as HTMLInputElement | null)?.value || '',
      }));
      return { name, path, ...(children.length > 0 ? { children } : {}) };
    });
  }

  function syncChildrenOrderFromDom(itemIndex: number): void {
    const card = menuItemsList.querySelector<HTMLElement>(`[data-item-index="${itemIndex}"]`);
    if (!card || !currentMenu.items[itemIndex]) return;
    const list = card.querySelector('.menu-children-list');
    if (!list) return;
    currentMenu.items[itemIndex].children = Array.from(list.querySelectorAll<HTMLElement>('.menu-child-row')).map((childRow) => ({
      name: (childRow.querySelector('.menu-child-name') as HTMLInputElement | null)?.value || '',
      path: (childRow.querySelector('.menu-child-path') as HTMLInputElement | null)?.value || '',
    }));
  }

  function renderMenuDragHandle(): string {
    return `<span class="cms-drag-handle" aria-hidden="true">${dragHandleSvg}</span>`;
  }

  function renderMenuDeleteButton(className: string, ariaLabel: string, dataAttr?: string, dataValue?: number): string {
    const dataAttribute = dataAttr && dataValue !== undefined ? ` ${dataAttr}="${dataValue}"` : '';
    return `<button type="button" class="cms-table-btn-delete ${className}"${dataAttribute} aria-label="${ariaLabel}">${trashSvg}</button>`;
  }

  function renderMenuTextInput(className: string, ariaLabel: string, placeholder: string, value: string): string {
    return `<input type="text" class="cms-input ${className}" aria-label="${ariaLabel}" placeholder="${placeholder}" value="${escapeHtml(value)}" />`;
  }

  function renderMenuSummary(name: string, path: string, emptyLabel: string): string {
    return `<div class="cms-menu-card-copy"><strong>${escapeHtml(name || emptyLabel)}</strong><span>${escapeHtml(path || 'Define una ruta')}</span></div>`;
  }

  function renderChildRow(itemIndex: number, childIndex: number, child: MenuItem): string {
    return (
      `<div class="menu-child-row" data-item-index="${itemIndex}" data-child-index="${childIndex}">` +
      renderMenuDragHandle() +
      renderMenuTextInput('menu-child-name', 'Nombre del submenú', 'Nombre del submenú', child.name ?? '') +
      renderMenuTextInput('menu-child-path', 'Ruta del submenú', '/ruta', child.path ?? '') +
      renderMenuDeleteButton('menu-child-delete', 'Eliminar') +
      '</div>'
    );
  }

  function renderItemCard(item: MenuItem, itemIndex: number): string {
    const isOpen = expandedItemIndex === itemIndex;
    const childrenCount = item.children?.length || 0;
    const childrenHtml = (item.children || []).map((child, childIndex) => renderChildRow(itemIndex, childIndex, child)).join('');
    return (
      `<div class="cms-menu-card${isOpen ? ' cms-menu-card--open' : ''}" data-item-index="${itemIndex}">` +
      '<div class="cms-menu-card-header">' +
      '<div class="cms-menu-card-title">' +
      renderMenuDragHandle() +
      renderMenuSummary(item.name ?? '', item.path ?? '', 'Elemento de menú') +
      `<span class="cms-menu-card-summary-badge">${childrenCount} sub${childrenCount === 1 ? 'menú' : 'menús'}</span>` +
      '</div>' +
      '<div class="cms-menu-card-actions">' +
      `<button type="button" class="cms-menu-card-toggle" data-item-index="${itemIndex}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? 'Contraer' : 'Expandir'}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
      renderMenuDeleteButton('menu-item-delete', 'Eliminar', 'data-item-index', itemIndex) +
      '</div>' +
      '</div>' +
      `<div class="cms-menu-card-body${isOpen ? '' : ' cms-hidden'}">` +
      '<div class="cms-menu-card-inline-fields">' +
      renderMenuTextInput('menu-item-name', 'Nombre del elemento', 'Nombre del elemento', item.name ?? '') +
      renderMenuTextInput('menu-item-path', 'Ruta del elemento', '/ruta', item.path ?? '') +
      '</div>' +
      '<div class="cms-menu-card-children">' +
      '<div class="cms-menu-card-children-head">' +
      '<span class="cms-menu-card-children-title">Submenús</span>' +
      `<button type="button" class="cms-btn cms-btn-secondary menu-add-child-btn" data-item-index="${itemIndex}">Añadir submenú</button>` +
      '</div>' +
      `<div class="menu-children-list" id="menu-children-${itemIndex}">${childrenHtml}</div>` +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function bindBuilderEvents(): void {
    menuItemsList.querySelectorAll<HTMLInputElement>('.menu-item-name, .menu-item-path').forEach((input) => {
      input.addEventListener('input', syncItemsFromDom);
      input.addEventListener('change', syncItemsFromDom);
    });

    menuItemsList.querySelectorAll<HTMLInputElement>('.menu-child-name, .menu-child-path').forEach((input) => {
      input.addEventListener('input', () => {
        const row = input.closest<HTMLElement>('.menu-child-row');
        if (!row) return;
        syncChildrenOrderFromDom(Number.parseInt(row.dataset.itemIndex || '', 10));
      });
      input.addEventListener('change', () => {
        const row = input.closest<HTMLElement>('.menu-child-row');
        if (!row) return;
        syncChildrenOrderFromDom(Number.parseInt(row.dataset.itemIndex || '', 10));
      });
    });

    menuItemsList.querySelectorAll<HTMLButtonElement>('.menu-item-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.itemIndex || '', 10);
        if (Number.isNaN(index)) return;
        currentMenu.items.splice(index, 1);
        renderBuilder();
      });
    });

    menuItemsList.querySelectorAll<HTMLButtonElement>('.cms-menu-card-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.itemIndex || '', 10);
        if (Number.isNaN(index)) return;
        expandedItemIndex = expandedItemIndex === index ? null : index;
        renderBuilder();
      });
    });

    menuItemsList.querySelectorAll<HTMLButtonElement>('.menu-add-child-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.itemIndex || '', 10);
        if (Number.isNaN(index) || !currentMenu.items[index]) return;
        currentMenu.items[index].children ||= [];
        currentMenu.items[index].children?.push({ name: '', path: '' });
        expandedItemIndex = index;
        renderBuilder();
      });
    });

    menuItemsList.querySelectorAll<HTMLButtonElement>('.menu-child-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest<HTMLElement>('.menu-child-row');
        if (!row) return;
        const itemIndex = Number.parseInt(row.dataset.itemIndex || '', 10);
        const childIndex = Number.parseInt(row.dataset.childIndex || '', 10);
        const item = currentMenu.items[itemIndex];
        if (!item?.children) return;
        item.children.splice(childIndex, 1);
        renderBuilder();
      });
    });
  }

  function setupSortables(): void {
    destroySortables();

    sortableMain = Sortable.create(menuItemsList, {
      handle: '.cms-drag-handle',
      ghostClass: 'cms-dragging',
      onEnd() {
        syncItemsFromDom();
        renderBuilder();
      },
    });

    currentMenu.items.forEach((_, itemIndex) => {
      const list = menuItemsList.querySelector<HTMLElement>(`#menu-children-${itemIndex}`);
      if (!list) return;
      sortableChildren.push(
        Sortable.create(list, {
          handle: '.cms-drag-handle',
          ghostClass: 'cms-dragging',
          onEnd() {
            syncChildrenOrderFromDom(itemIndex);
            renderBuilder();
          },
        })
      );
    });
  }

  function renderBuilder(): void {
    if (expandedItemIndex !== null && !currentMenu.items[expandedItemIndex]) expandedItemIndex = null;
    menuItemsList.innerHTML = currentMenu.items.map((item, index) => renderItemCard(item, index)).join('');
    emptyList?.classList.toggle('cms-hidden', currentMenu.items.length > 0);
    bindBuilderEvents();
    setupSortables();
  }

  function setFormTitle(label: string, submitLabel: string): void {
    if (titleEl) titleEl.textContent = label;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function openNew(): void {
    currentMenu = { name: '', selector: '', items: [] };
    expandedItemIndex = null;
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (selectorInput) selectorInput.value = '';
    setSelectorHint(false, '');
    setError('');
    renderBuilder();
    setFormTitle('Nuevo menú', 'Crear');
    openDialog(dialog);
  }

  async function openEdit(id: string): Promise<void> {
    if (menusState.length === 0) await refreshMenus();
    const menu = menusState.find((entry) => entry.id === id);
    if (!menu) return;

    currentMenu = {
      name: menu.name || '',
      selector: menu.selector || '',
      items: Array.isArray(menu.items) ? JSON.parse(JSON.stringify(menu.items)) : [],
    };
    expandedItemIndex = currentMenu.items.length > 0 ? 0 : null;

    if (idInput) idInput.value = menu.id;
    if (nameInput) nameInput.value = currentMenu.name;
    if (selectorInput) selectorInput.value = currentMenu.selector;
    setSelectorHint(false, '');
    setError('');
    renderBuilder();
    setFormTitle('Editar menú', 'Guardar');
    openDialog(dialog);
  }

  function filteredMenus(): Menu[] {
    const query = menusSearch?.value.trim().toLowerCase() || '';
    return menusState.filter((menu) => {
      if (!query) return true;
      return menu.name.toLowerCase().includes(query) || menu.selector.toLowerCase().includes(query);
    });
  }

  function renderMenusTable(): void {
    const list = filteredMenus();
    menusTableBody.innerHTML = list
      .map((menu) => (
        `<tr class="cms-menu-row" data-id="${escapeHtml(menu.id)}">` +
        `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-menu-edit" data-id="${escapeHtml(menu.id)}" aria-label="Editar">${pencilSvg}</button></td>` +
        `<td><button type="button" class="cms-table-link cms-menu-open" data-id="${escapeHtml(menu.id)}">${escapeHtml(menu.name || 'Menú')}</button></td>` +
        `<td class="cms-table-cell-monospace">${escapeHtml(menu.selector)}</td>` +
        `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-menu-delete" data-id="${escapeHtml(menu.id)}" aria-label="Eliminar">${trashSvg}</button></td>` +
        '</tr>'
      ))
      .join('');
    if (menusCount) menusCount.textContent = `${list.length} menús`;
    menusEmpty?.classList.toggle('cms-hidden', list.length > 0);
  }

  async function refreshMenus(): Promise<void> {
    const data = await fetchJson<MenusData>('/cms/api/menus', {
      headers: { Authorization: `Bearer ${getCmsToken()}` },
    });
    menusState = data.menus || [];
    renderMenusTable();
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
      setSelectorHint(false, 'Solo letras, numeros, guiones y guiones bajos (sin espacios).');
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
      await refreshMenus();
      showToast(id ? 'Menú actualizado correctamente.' : 'Menú creado correctamente.', 'success', 'Menús');
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
      await refreshMenus();
      showToast('Menú eliminado correctamente.', 'success', 'Menús');
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
    setSelectorHint(SELECTOR_REGEX.test(value), SELECTOR_REGEX.test(value) ? '' : 'Solo letras, numeros, guiones y guiones bajos (sin espacios).');
  });

  addItemBtn?.addEventListener('click', () => {
    currentMenu.items.push({ name: '', path: '' });
    expandedItemIndex = currentMenu.items.length - 1;
    renderBuilder();
  });

  submitBtn?.addEventListener('click', () => void doSubmit());
  document.getElementById('cms-menu-new-btn')?.addEventListener('click', openNew);
  document.querySelector<HTMLElement>('[data-open-menu-new]')?.addEventListener('click', openNew);
  menusSearch?.addEventListener('input', renderMenusTable);
  menusTableBody.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const deleteButton = target.closest<HTMLElement>('.cms-menu-delete');
    if (deleteButton) {
      const id = deleteButton.getAttribute('data-id');
      if (id) void deleteMenu(id);
      return;
    }

    const editTrigger = target.closest<HTMLElement>('.cms-menu-edit, .cms-menu-open, .cms-menu-row');
    const id = editTrigger?.getAttribute('data-id');
    if (id) void openEdit(id);
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('data-close-modal') === 'menu-detail-modal' || target === dialog) {
      closeDialog(dialog);
    }
  });
  dialog.addEventListener('cancel', () => closeDialog(dialog));

  renderBuilder();
  void refreshMenus();
}
