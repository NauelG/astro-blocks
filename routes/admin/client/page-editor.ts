/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import Sortable, { type SortableEvent } from 'sortablejs';
import type { BlockInstance, SchemaMap, SeoData } from '../../../types/index.js';
import { isSchemaPropLocalizable } from '../../../utils/localization.js';
import { authHeaders, closeDialog, escapeHtml, fetchJson, fetchOk, getActiveContentLocale, openDialog, showAlert, showConfirm, showToast } from './common.js';

const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const pencilIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const copyIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const chevronDownSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

type CmsPage = {
  id: string;
  locale: string;
  title: string;
  slug: string | string[];
  status: 'published' | 'draft' | 'archived';
  indexable?: boolean;
  seo?: SeoData;
  blocks: BlockInstance[];
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

interface PagesResponse {
  pages: CmsPage[];
}

export function initPageEditor(): void {
  const dialog = document.getElementById('page-detail-modal') as HTMLDialogElement | null;
  const form = document.getElementById('page-detail-form') as HTMLFormElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const idInput = document.getElementById('page-detail-id') as HTMLInputElement | null;
  const submitBtn = document.getElementById('page-detail-submit') as HTMLButtonElement | null;
  const newBtn = document.getElementById('cms-page-new-btn') as HTMLButtonElement | null;
  const statusInput = document.getElementById('page-detail-status') as HTMLInputElement | null;
  const titleInput = document.getElementById('page-detail-title') as HTMLInputElement | null;
  const slugInput = document.getElementById('page-detail-slug') as HTMLInputElement | null;
  const pagesTbody = document.getElementById('cms-pages-tbody') as HTMLTableSectionElement | null;
  const pagesCount = document.getElementById('cms-pages-count');
  const pagesEmpty = document.getElementById('cms-pages-empty');
  const pagesSearch = document.getElementById('cms-pages-search') as HTMLInputElement | null;
  const pagesStatusFilter = document.getElementById('cms-pages-status-filter') as HTMLSelectElement | null;
  const indexableInput = document.getElementById('page-detail-indexable') as HTMLInputElement | null;
  const seoTitleInput = document.getElementById('page-detail-seo-title') as HTMLInputElement | null;
  const seoDescriptionInput = document.getElementById('page-detail-seo-description') as HTMLTextAreaElement | null;
  const seoCanonicalInput = document.getElementById('page-detail-seo-canonical') as HTMLInputElement | null;
  const seoNofollowInput = document.getElementById('page-detail-seo-nofollow') as HTMLInputElement | null;
  const seoImageInput = document.getElementById('page-detail-seo-image') as HTMLInputElement | null;
  const imageThumb = document.getElementById('page-detail-seo-image-thumb') as HTMLImageElement | null;
  const imageEmpty = document.getElementById('page-detail-seo-image-empty') as HTMLElement | null;
  const imageUploadBtn = document.getElementById('page-detail-seo-image-upload') as HTMLButtonElement | null;
  const imageFileInput = document.getElementById('page-detail-seo-image-file') as HTMLInputElement | null;
  const imageRemoveBtn = document.getElementById('page-detail-seo-image-remove') as HTMLButtonElement | null;
  const publishBtn = document.getElementById('page-detail-publish-btn') as HTMLButtonElement | null;
  const unpublishBtn = document.getElementById('page-detail-unpublish-btn') as HTMLButtonElement | null;
  const seoFields = document.getElementById('page-detail-seo-fields');
  const seoHiddenHint = document.getElementById('page-detail-seo-hidden-hint');
  const tabInfo = document.getElementById('page-detail-tab-info') as HTMLButtonElement | null;
  const tabSeo = document.getElementById('page-detail-tab-seo') as HTMLButtonElement | null;
  const panelInfo = document.getElementById('page-detail-panel-info');
  const panelSeo = document.getElementById('page-detail-panel-seo');
  const blocksListEl = document.getElementById('page-detail-blocks-list') as HTMLUListElement | null;
  const blocksEmptyEl = document.getElementById('page-detail-blocks-empty');
  const addBlockBtn = document.getElementById('page-detail-blocks-add') as HTMLButtonElement | null;
  const blockSelectModal = document.getElementById('page-detail-block-select-modal') as HTMLDialogElement | null;
  const blockSelectList = document.getElementById('page-detail-block-select-list') as HTMLUListElement | null;

  if (!dialog || !form || !blocksListEl) return;
  const blockList = blocksListEl;

  let schemaMap: SchemaMap | null = null;
  let blocksList: BlockInstance[] = [];
  let sortableBlocks: Sortable | null = null;
  let pagesState: CmsPage[] = [];

  function withLocaleHint(label: string, localizable = true): string {
    if (!localizable) return escapeHtml(label);
    return `${escapeHtml(label)} <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`;
  }

  function annotateStaticLocalizedLabels(): void {
    const localizedForIds = [
      'page-detail-title',
      'page-detail-slug',
      'page-detail-indexable',
      'page-detail-seo-title',
      'page-detail-seo-description',
      'page-detail-seo-canonical',
      'page-detail-seo-nofollow',
    ];

    localizedForIds.forEach((forId) => {
      const label = document.querySelector<HTMLLabelElement>(`#page-detail-form label[for="${forId}"]`);
      if (!label) return;
      if (!label.dataset.baseLabel) label.dataset.baseLabel = (label.textContent || '').trim();
      label.innerHTML = withLocaleHint(label.dataset.baseLabel || '', true);
    });

    const imageLabel = document.querySelector<HTMLLabelElement>('#page-detail-seo-fields .cms-field label:not([for])');
    if (imageLabel) {
      if (!imageLabel.dataset.baseLabel) imageLabel.dataset.baseLabel = (imageLabel.textContent || '').trim();
      imageLabel.innerHTML = withLocaleHint(imageLabel.dataset.baseLabel || '', true);
    }
  }

  function setFormTitle(label: string, submitLabel = 'Guardar'): void {
    if (titleEl) titleEl.textContent = label;
    if (submitBtn) submitBtn.textContent = submitLabel;
  }

  function switchToInfoTab(): void {
    tabInfo?.classList.add('cms-page-detail-tab--active');
    tabInfo?.setAttribute('aria-selected', 'true');
    tabSeo?.classList.remove('cms-page-detail-tab--active');
    tabSeo?.setAttribute('aria-selected', 'false');
    panelInfo?.classList.add('cms-page-detail-tabpanel--active');
    panelSeo?.classList.remove('cms-page-detail-tabpanel--active');
  }

  function switchToSeoTab(): void {
    tabSeo?.classList.add('cms-page-detail-tab--active');
    tabSeo?.setAttribute('aria-selected', 'true');
    tabInfo?.classList.remove('cms-page-detail-tab--active');
    tabInfo?.setAttribute('aria-selected', 'false');
    panelSeo?.classList.add('cms-page-detail-tabpanel--active');
    panelInfo?.classList.remove('cms-page-detail-tabpanel--active');
  }

  function toggleSeoVisibility(visible: boolean): void {
    seoFields?.classList.toggle('cms-hidden', !visible);
    seoHiddenHint?.classList.toggle('cms-hidden', visible);
    tabSeo?.classList.toggle('cms-hidden', !visible);
    if (!visible && tabSeo?.classList.contains('cms-page-detail-tab--active')) switchToInfoTab();
  }

  function updateStatusButtons(): void {
    const isPublished = statusInput?.value === 'published';
    publishBtn?.classList.toggle('cms-hidden', Boolean(isPublished));
    unpublishBtn?.classList.toggle('cms-hidden', !isPublished);
  }

  function updateSeoImagePreview(url = ''): void {
    if (seoImageInput) seoImageInput.value = url;

    const hasImage = Boolean(url.trim());
    imageThumb?.classList.toggle('cms-hidden', !hasImage);
    if (imageThumb && hasImage) {
      imageThumb.src = url;
      imageThumb.alt = 'Imagen SEO';
    }

    imageEmpty?.classList.toggle('cms-hidden', hasImage);
    imageRemoveBtn?.classList.toggle('cms-hidden', !hasImage);
    if (imageUploadBtn) imageUploadBtn.textContent = hasImage ? 'Cambiar' : 'Subir imagen';
  }

  function parseFieldValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
    if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
    if (input instanceof HTMLInputElement && input.type === 'number') return input.value === '' ? '' : Number(input.value);
    return input.value;
  }

  function pageSlugToText(page: Pick<CmsPage, 'slug'>): string {
    return page.slug === '/' || (Array.isArray(page.slug) && page.slug.length === 0)
      ? '/'
      : Array.isArray(page.slug)
        ? `/${page.slug.join('/')}`
        : page.slug;
  }

  function blockSummary(block: BlockInstance): string {
    const values = Object.values(block.props || {})
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
      .filter(Boolean)
      .slice(0, 2);
    return values.length > 0 ? values.join(' · ') : 'Configura las propiedades de este bloque';
  }

  function filteredPages(): CmsPage[] {
    const query = pagesSearch?.value.trim().toLowerCase() || '';
    const status = pagesStatusFilter?.value || 'all';
    return pagesState.filter((page) => {
      const matchesQuery =
        !query ||
        page.title.toLowerCase().includes(query) ||
        pageSlugToText(page).toLowerCase().includes(query);
      const matchesStatus = status === 'all' || page.status === status;
      return matchesQuery && matchesStatus;
    });
  }

  function localeQuery(): string {
    const locale = getActiveContentLocale('es');
    return locale ? `?locale=${encodeURIComponent(locale)}` : '';
  }

  function bindPageRowEvents(): void {
    pagesTbody?.querySelectorAll<HTMLElement>('.cms-page-edit').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-id');
        if (id) void openEdit(id);
      });
    });
    pagesTbody?.querySelectorAll<HTMLElement>('.cms-page-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-id');
        if (id) void deletePage(id);
      });
    });
  }

  function renderPagesTable(): void {
    if (!pagesTbody) return;
    const list = filteredPages();
    pagesTbody.innerHTML = list
      .map((page) => {
        const isPublished = page.status === 'published';
        const slug = pageSlugToText(page);
        return (
          '<tr>' +
          `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-page-edit" data-id="${escapeHtml(page.id)}" aria-label="Editar">${pencilIconSvg}</button></td>` +
          `<td>${escapeHtml(page.title || '(sin título)')}</td>` +
          `<td class="cms-table-cell-monospace">${escapeHtml(slug)}</td>` +
          `<td><span class="cms-badge ${isPublished ? 'cms-badge-success' : 'cms-badge-neutral'}">${escapeHtml(isPublished ? 'Publicada' : 'Borrador')}</span></td>` +
          `<td><span class="cms-indexable-dot cms-indexable-dot--${page.indexable !== false ? 'yes' : 'no'}" role="img" aria-label="${page.indexable !== false ? 'Indexable' : 'No indexable'}"></span></td>` +
          `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-page-delete" data-id="${escapeHtml(page.id)}" aria-label="Eliminar">${trashIconSvg}</button></td>` +
          '</tr>'
        );
      })
      .join('');

    const publishedCount = pagesState.filter((page) => page.status === 'published').length;
    if (pagesCount) pagesCount.textContent = `${list.length} páginas · ${publishedCount} publicadas`;
    pagesEmpty?.classList.toggle('cms-hidden', list.length > 0);
    bindPageRowEvents();
  }

  async function refreshPages(): Promise<void> {
    const data = await fetchJson<PagesResponse>(`/cms/api/pages${localeQuery()}`, {
      headers: authHeaders(false),
    });
    pagesState = data.pages || [];
    renderPagesTable();
  }

  function renderBlocksList(): void {
    blockList.innerHTML = '';

    if (blocksList.length === 0) {
      blocksEmptyEl?.classList.remove('cms-hidden');
      blockList.classList.add('cms-hidden');
      sortableBlocks?.destroy();
      sortableBlocks = null;
      return;
    }

    blocksEmptyEl?.classList.add('cms-hidden');
    blockList.classList.remove('cms-hidden');

    blocksList.forEach((block, index) => {
      const schema = schemaMap?.[block.type];
      const name = schema?.name || block.type;
      const summary = blockSummary(block);
      const li = document.createElement('li');
      li.className = 'cms-block-item';
      li.dataset.index = String(index);
      li.innerHTML =
        '<div class="cms-block-item-header">' +
        '<span class="cms-drag-handle" aria-label="Arrastrar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>' +
        '<div class="cms-block-item-meta">' +
        `<span class="cms-block-item-name">${escapeHtml(name)}</span>` +
        `<span class="cms-block-item-summary">${escapeHtml(summary)}</span>` +
        '</div>' +
        `<button type="button" class="cms-block-item-toggle" aria-expanded="false" aria-label="Expandir" data-index="${index}">${chevronDownSvg}</button>` +
        `<button type="button" class="cms-block-item-duplicate" aria-label="Duplicar bloque" data-index="${index}">${copyIconSvg}</button>` +
        `<button type="button" class="cms-table-btn-delete cms-block-item-delete" aria-label="Eliminar bloque" data-index="${index}">${trashIconSvg}</button>` +
        '</div>' +
        '<div class="cms-block-item-body cms-hidden"></div>';

      blockList.appendChild(li);
      const body = li.querySelector('.cms-block-item-body');
      if (!schema || !body) return;

      let fieldsHtml = '<div class="cms-stack cms-block-item-fields">';
      for (const [propName, def] of Object.entries(schema.items || {})) {
        const value = block.props?.[propName] ?? '';
        const fieldId = `page-block-${index}-${propName}`;

        if (def.type === 'text') {
          fieldsHtml += `<div class="cms-field"><label for="${fieldId}">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label><textarea id="${fieldId}" data-idx="${index}" data-prop="${escapeHtml(propName)}" class="cms-input" rows="2">${escapeHtml(String(value))}</textarea></div>`;
          continue;
        }

        if (def.type === 'number') {
          const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : '';
          fieldsHtml += `<div class="cms-field"><label for="${fieldId}">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label><input type="number" id="${fieldId}" data-idx="${index}" data-prop="${escapeHtml(propName)}" class="cms-input" value="${numericValue}"></div>`;
          continue;
        }

        if (def.type === 'boolean') {
          fieldsHtml += `<div class="cms-field" style="display:flex;align-items:center;gap:0.5rem"><input type="checkbox" id="${fieldId}" data-idx="${index}" data-prop="${escapeHtml(propName)}" class="cms-input" ${(value === true || value === 'true') ? 'checked' : ''}><label for="${fieldId}" style="margin-bottom:0">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label></div>`;
          continue;
        }

        if (def.type === 'select') {
          const options = (def.options || [])
            .map((option) => `<option value="${escapeHtml(option)}"${value === option ? ' selected' : ''}>${escapeHtml(option)}</option>`)
            .join('');
          fieldsHtml += `<div class="cms-field"><label for="${fieldId}">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label><select id="${fieldId}" data-idx="${index}" data-prop="${escapeHtml(propName)}" class="cms-input">${options}</select></div>`;
          continue;
        }

        fieldsHtml += `<div class="cms-field"><label for="${fieldId}">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label><input type="text" id="${fieldId}" data-idx="${index}" data-prop="${escapeHtml(propName)}" class="cms-input" value="${escapeHtml(String(value))}"></div>`;
      }

      fieldsHtml += '</div>';
      body.innerHTML = fieldsHtml;
    });

    blockList.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.cms-block-item-fields [data-idx][data-prop]').forEach((input) => {
      const syncValue = (): void => {
        const index = Number.parseInt(input.dataset.idx || '', 10);
        const propName = input.dataset.prop;
        if (Number.isNaN(index) || !propName || !blocksList[index]) return;
        blocksList[index].props ||= {};
        blocksList[index].props[propName] = parseFieldValue(input);
        const summaryEl = blockList.querySelector<HTMLElement>(`.cms-block-item[data-index="${index}"] .cms-block-item-summary`);
        if (summaryEl) summaryEl.textContent = blockSummary(blocksList[index]);
      };

      input.addEventListener('input', syncValue);
      input.addEventListener('change', syncValue);
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const li = button.closest('.cms-block-item');
        const body = li?.querySelector('.cms-block-item-body');
        const isOpen = body ? !body.classList.contains('cms-hidden') : false;

        blockList.querySelectorAll('.cms-block-item-body').forEach((entry) => entry.classList.add('cms-hidden'));
        blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-toggle').forEach((entry) => {
          entry.setAttribute('aria-expanded', 'false');
          entry.innerHTML = chevronDownSvg;
        });

        if (!isOpen && body) {
          body.classList.remove('cms-hidden');
          button.setAttribute('aria-expanded', 'true');
          button.innerHTML = chevronUpSvg;
        }
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-duplicate').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index || '', 10);
        if (index < 0 || !blocksList[index]) return;
        const copy = JSON.parse(JSON.stringify(blocksList[index])) as BlockInstance;
        blocksList.splice(index + 1, 0, copy);
        renderBlocksList();
        showToast('Bloque duplicado.', 'info', 'Editor');
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index || '', 10);
        if (index >= 0) {
          blocksList.splice(index, 1);
          renderBlocksList();
          showToast('Bloque eliminado.', 'info', 'Editor');
        }
      });
    });

    sortableBlocks?.destroy();
    sortableBlocks = Sortable.create(blockList, {
      handle: '.cms-drag-handle',
      ghostClass: 'cms-dragging',
      onEnd(event: SortableEvent) {
        if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return;
        const block = blocksList[event.oldIndex];
        blocksList.splice(event.oldIndex, 1);
        blocksList.splice(event.newIndex, 0, block);
      },
    });
  }

  async function loadSchemaMap(): Promise<void> {
    if (schemaMap) return;

    try {
      schemaMap = await fetchJson<SchemaMap>('/cms/api/block-schemas', {
        headers: authHeaders(false),
      });
    } catch {
      if (addBlockBtn) addBlockBtn.disabled = true;
      schemaMap = {};
    }
  }

  function resetFormForNew(): void {
    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = 'Untitled';
    if (slugInput) slugInput.value = '/';
    if (statusInput) statusInput.value = 'draft';
    if (indexableInput) indexableInput.checked = true;
    if (seoTitleInput) seoTitleInput.value = '';
    if (seoDescriptionInput) seoDescriptionInput.value = '';
    if (seoCanonicalInput) seoCanonicalInput.value = '';
    if (seoNofollowInput) seoNofollowInput.checked = false;
    updateSeoImagePreview('');
    toggleSeoVisibility(true);
    blocksList = [];
  }

  async function openNew(): Promise<void> {
    resetFormForNew();
    annotateStaticLocalizedLabels();
    await loadSchemaMap();
    renderBlocksList();
    setFormTitle('Nueva página', 'Guardar');
    updateStatusButtons();
    openDialog(dialog);
  }

  async function openEdit(id: string): Promise<void> {
    if (pagesState.length === 0) await refreshPages();
    const page = pagesState.find((entry) => entry.id === id);
    if (!page) return;

    if (idInput) idInput.value = page.id;
    if (titleInput) titleInput.value = page.title || '';
    if (slugInput) {
      slugInput.value =
        page.slug === '/' || (Array.isArray(page.slug) && page.slug.length === 0)
          ? '/'
          : Array.isArray(page.slug)
            ? `/${page.slug.join('/')}`
            : page.slug;
    }
    if (statusInput) statusInput.value = page.status || 'draft';
    if (indexableInput) indexableInput.checked = page.indexable !== false;

    const seo = page.seo || {};
    if (seoTitleInput) seoTitleInput.value = seo.title || '';
    if (seoDescriptionInput) seoDescriptionInput.value = seo.description || '';
    if (seoCanonicalInput) seoCanonicalInput.value = seo.canonical || '';
    if (seoNofollowInput) seoNofollowInput.checked = Boolean(seo.nofollow);
    updateSeoImagePreview(seo.image || '');
    toggleSeoVisibility(page.indexable !== false);

    blocksList = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : [];
    annotateStaticLocalizedLabels();
    await loadSchemaMap();
    renderBlocksList();
    setFormTitle('Editar página', 'Guardar');
    updateStatusButtons();
    openDialog(dialog);
  }

  async function deletePage(id: string): Promise<void> {
    const ok = await showConfirm('¿Eliminar esta página?', 'Eliminar');
    if (!ok) return;

    try {
      const response = await fetch(`/cms/api/pages/${id}`, {
        method: 'DELETE',
        headers: authHeaders(false),
      });
      if (response.status !== 204) throw new Error('Error al eliminar');
      await refreshPages();
      showToast('Página eliminada correctamente.', 'success', 'Páginas');
    } catch {
      await showAlert('Error al eliminar', 'Error');
    }
  }

  async function uploadSeoImage(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const data = await fetchJson<{ url?: string }>('/cms/api/upload', {
      method: 'POST',
      headers: authHeaders(false),
      body: formData,
    });

    if (data.url) updateSeoImagePreview(data.url);
  }

  async function removeSeoImage(): Promise<void> {
    const currentUrl = seoImageInput?.value?.trim() || '';
    const isOwnUpload = currentUrl.startsWith('/uploads/');

    const clearImage = (): void => updateSeoImagePreview('');

    if (!isOwnUpload || !currentUrl) {
      clearImage();
      return;
    }

    try {
      const response = await fetch('/cms/api/upload', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ url: currentUrl }),
      });

      if (response.status === 204 || response.status === 404) clearImage();
    } catch {
      clearImage();
    }
  }

  function validateCurrentBlocks(): string | null {
    if (!schemaMap || blocksList.length === 0) return null;

    for (const block of blocksList) {
      const schema = schemaMap[block.type];
      if (!schema || !schema.items) return `Bloque de tipo desconocido: ${block.type}.`;

      for (const [propName, def] of Object.entries(schema.items)) {
        if (!def.required) continue;

        const value = block.props?.[propName];
        if (value === undefined || value === null) {
          return `El bloque "${schema.name || block.type}" requiere el campo "${def.label || propName}".`;
        }

        if ((def.type === 'string' || def.type === 'text') && (typeof value !== 'string' || value.trim() === '')) {
          return `El bloque "${schema.name || block.type}" requiere el campo "${def.label || propName}" (no vacío).`;
        }
      }
    }

    return null;
  }

  function buildSeoPayload(): SeoData {
    return {
      title: seoTitleInput?.value || undefined,
      description: seoDescriptionInput?.value || undefined,
      canonical: seoCanonicalInput?.value || undefined,
      image: seoImageInput?.value || undefined,
      nofollow: Boolean(seoNofollowInput?.checked),
    };
  }

  async function submitForm(): Promise<void> {
    const validationError = validateCurrentBlocks();
    if (validationError) {
      await showAlert(validationError, 'No se puede guardar');
      return;
    }

    const id = idInput?.value?.trim() || '';
    const payload = {
      locale: getActiveContentLocale('es') || undefined,
      title: titleInput?.value || 'Untitled',
      slug: slugInput?.value || '/',
      status: statusInput?.value || 'draft',
      indexable: indexableInput?.checked ?? true,
      blocks: blocksList,
      seo: buildSeoPayload(),
    };

    try {
      await fetchOk(id ? `/cms/api/pages/${id}` : '/cms/api/pages', {
        method: id ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      closeDialog(dialog);
      await refreshPages();
      showToast(id ? 'Página actualizada correctamente.' : 'Página creada correctamente.', 'success', 'Páginas');
    } catch {
      await showAlert('Error al guardar', 'Error');
    }
  }

  newBtn?.addEventListener('click', () => void openNew());
  document.querySelector<HTMLElement>('[data-open-page-new]')?.addEventListener('click', () => void openNew());
  bindPageRowEvents();
  pagesSearch?.addEventListener('input', renderPagesTable);
  pagesStatusFilter?.addEventListener('change', renderPagesTable);

  indexableInput?.addEventListener('change', () => toggleSeoVisibility(indexableInput.checked));
  tabInfo?.addEventListener('click', switchToInfoTab);
  tabSeo?.addEventListener('click', switchToSeoTab);

  imageUploadBtn?.addEventListener('click', () => imageFileInput?.click());
  imageFileInput?.addEventListener('change', () => {
    const file = imageFileInput.files?.[0];
    if (!file) return;
    void uploadSeoImage(file);
    imageFileInput.value = '';
  });
  imageRemoveBtn?.addEventListener('click', () => void removeSeoImage());

  publishBtn?.addEventListener('click', () => {
    if (statusInput) {
      statusInput.value = 'published';
      form.requestSubmit();
    }
  });
  unpublishBtn?.addEventListener('click', () => {
    if (statusInput) {
      statusInput.value = 'draft';
      form.requestSubmit();
    }
  });

  addBlockBtn?.addEventListener('click', async () => {
    await loadSchemaMap();
    if (!schemaMap || !blockSelectList) return;

    blockSelectList.innerHTML = '';
    for (const [type, schema] of Object.entries(schemaMap)) {
      const li = document.createElement('li');
      li.className = 'cms-blocks-select-item';
      li.dataset.type = type;
      const fieldsCount = Object.keys(schema.items || {}).length;
      li.innerHTML =
        `<span class="cms-blocks-select-item-title">${escapeHtml(schema.name || type)}</span>` +
        `<p class="cms-blocks-select-item-text">${fieldsCount} campo${fieldsCount === 1 ? '' : 's'} configurables</p>`;
      li.addEventListener('click', () => {
        blocksList.push({ type, props: {} });
        renderBlocksList();
        closeDialog(blockSelectModal);
        showToast(`Bloque "${schema.name || type}" añadido.`, 'success', 'Editor');
      });
      blockSelectList.appendChild(li);
    }

    openDialog(blockSelectModal);
  });

  blockSelectModal?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('data-close-modal') === 'page-detail-block-select-modal' || target === blockSelectModal) {
      closeDialog(blockSelectModal);
    }
  });
  blockSelectModal?.addEventListener('cancel', () => closeDialog(blockSelectModal));

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('data-close-modal') === 'page-detail-modal' || target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener('cancel', () => closeDialog(dialog));

  annotateStaticLocalizedLabels();
  window.addEventListener('cms:content-locale-change', () => {
    annotateStaticLocalizedLabels();
    renderBlocksList();
    void refreshPages();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitForm();
  });

  void refreshPages();
}
