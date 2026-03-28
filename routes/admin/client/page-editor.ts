/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import Sortable, { type SortableEvent } from 'sortablejs';
import type { ArrayPropDef, BlockInstance, ObjectArrayItemDef, PrimitivePropDef, SchemaMap, SeoData } from '../../../types/index.js';
import {
  isObjectArrayItemDef,
  isPrimitivePropDef,
  validateBlockPropsAgainstSchema,
  type BlockValidationIssue,
} from '../../../utils/block-validation.js';
import { isSchemaPropLocalizable } from '../../../utils/localization.js';
import {
  authHeaders,
  closeDialog,
  escapeHtml,
  fetchJson,
  fetchOk,
  getActiveContentLocale,
  openDialog,
  showAlert,
  showConfirm,
  showToast,
} from './common.js';

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
const dragHandleSvg =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';

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

function isInputElement(
  element: Element | null
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return Boolean(
    element && (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  );
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
  const sortableArrays: Sortable[] = [];
  let pagesState: CmsPage[] = [];
  let openBlockIndex: number | null = null;
  const openArrayItemByKey = new Map<string, number | null>();
  const inlineErrors = new Map<string, string>();

  function arrayStateKey(blockIndex: number, propName: string): string {
    return `${blockIndex}::${propName}`;
  }

  function errorKey(blockIndex: number, propName: string, itemIndex?: number, fieldName?: string): string {
    const parts = [String(blockIndex), propName, itemIndex === undefined ? '' : String(itemIndex), fieldName || ''];
    return parts.join('::');
  }

  function errorPrefix(blockIndex: number, propName: string): string {
    return `${blockIndex}::${propName}::`;
  }

  function clearArraySortables(): void {
    sortableArrays.forEach((sortable) => sortable.destroy());
    sortableArrays.length = 0;
  }

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

  function defaultPrimitiveValue(def: PrimitivePropDef): unknown {
    if (def.type === 'boolean') return false;
    if (def.type === 'number') return '';
    if (def.type === 'select') {
      return Array.isArray(def.options) && def.options.length > 0 ? def.options[0] : '';
    }
    return '';
  }

  function defaultArrayItemValue(def: ArrayPropDef): unknown {
    if (isPrimitivePropDef(def.item)) return defaultPrimitiveValue(def.item);

    const output: Record<string, unknown> = {};
    for (const [fieldName, fieldDef] of Object.entries(def.item.fields || {})) {
      output[fieldName] = defaultPrimitiveValue(fieldDef);
    }
    return output;
  }

  function ensureArrayValue(blockIndex: number, propName: string): unknown[] {
    if (!blocksList[blockIndex]) blocksList[blockIndex] = { type: '', props: {} };
    blocksList[blockIndex].props ||= {};

    const value = blocksList[blockIndex].props[propName];
    if (Array.isArray(value)) return value;

    const next: unknown[] = [];
    blocksList[blockIndex].props[propName] = next;
    return next;
  }

  function summaryValue(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && !Number.isNaN(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return '';
  }

  function objectArrayItemSummary(def: ObjectArrayItemDef, rawItem: unknown, itemIndex: number): string {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return `Elemento ${itemIndex + 1}`;

    const item = rawItem as Record<string, unknown>;

    if (def.summaryField) {
      const fromSummaryField = summaryValue(item[def.summaryField]);
      if (fromSummaryField) return fromSummaryField;
    }

    for (const fieldName of Object.keys(def.fields || {})) {
      const candidate = summaryValue(item[fieldName]);
      if (candidate) return candidate;
    }

    return `Elemento ${itemIndex + 1}`;
  }

  function arraySummary(def: ArrayPropDef, rawValue: unknown): string {
    if (!Array.isArray(rawValue)) return '';
    if (rawValue.length === 0) return `${def.label}: 0 elementos`;

    if (isPrimitivePropDef(def.item)) {
      const first = summaryValue(rawValue[0]);
      return first ? `${rawValue.length} elementos · ${first}` : `${rawValue.length} elementos`;
    }

    const firstObjectSummary = objectArrayItemSummary(def.item, rawValue[0], 0);
    return `${rawValue.length} elementos · ${firstObjectSummary}`;
  }

  function blockSummary(block: BlockInstance): string {
    const schema = schemaMap?.[block.type];
    const values: string[] = [];

    for (const [propName, rawValue] of Object.entries(block.props || {})) {
      const def = schema?.items?.[propName];
      const candidate = def?.type === 'array' ? arraySummary(def, rawValue) : summaryValue(rawValue);
      if (candidate) values.push(candidate);
      if (values.length >= 2) break;
    }

    return values.length > 0 ? values.join(' · ') : 'Configura las propiedades de este bloque';
  }

  function pageSlugToText(page: Pick<CmsPage, 'slug'>): string {
    return page.slug === '/' || (Array.isArray(page.slug) && page.slug.length === 0)
      ? '/'
      : Array.isArray(page.slug)
        ? `/${page.slug.join('/')}`
        : page.slug;
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

  function clearInlineError(blockIndex: number, propName: string, itemIndex?: number, fieldName?: string): boolean {
    let changed = false;

    const exact = errorKey(blockIndex, propName, itemIndex, fieldName);
    if (inlineErrors.delete(exact)) changed = true;

    if (fieldName !== undefined) {
      const itemLevel = errorKey(blockIndex, propName, itemIndex);
      if (inlineErrors.delete(itemLevel)) changed = true;
    }

    return changed;
  }

  function clearInlineErrorsForProp(blockIndex: number, propName: string): void {
    const prefix = errorPrefix(blockIndex, propName);
    for (const key of Array.from(inlineErrors.keys())) {
      if (key.startsWith(prefix)) inlineErrors.delete(key);
    }
  }

  function getInlineError(blockIndex: number, propName: string, itemIndex?: number, fieldName?: string): string {
    const exact = inlineErrors.get(errorKey(blockIndex, propName, itemIndex, fieldName));
    if (exact) return exact;
    if (fieldName !== undefined) {
      const itemLevel = inlineErrors.get(errorKey(blockIndex, propName, itemIndex));
      if (itemLevel) return itemLevel;
    }
    return '';
  }

  function remapOpenArrayStateForBlockMove(oldIndex: number, newIndex: number): void {
    if (openArrayItemByKey.size === 0) return;

    const next = new Map<string, number | null>();

    for (const [key, openIndex] of openArrayItemByKey.entries()) {
      const [rawBlockIndex, propName] = key.split('::');
      const parsedIndex = Number.parseInt(rawBlockIndex || '', 10);
      if (Number.isNaN(parsedIndex) || !propName) continue;

      let mappedIndex = parsedIndex;

      if (parsedIndex === oldIndex) {
        mappedIndex = newIndex;
      } else if (oldIndex < newIndex && parsedIndex > oldIndex && parsedIndex <= newIndex) {
        mappedIndex = parsedIndex - 1;
      } else if (oldIndex > newIndex && parsedIndex >= newIndex && parsedIndex < oldIndex) {
        mappedIndex = parsedIndex + 1;
      }

      next.set(arrayStateKey(mappedIndex, propName), openIndex);
    }

    openArrayItemByKey.clear();
    next.forEach((value, key) => openArrayItemByKey.set(key, value));
  }

  function adjustOpenBlockIndexAfterMove(oldIndex: number, newIndex: number): void {
    if (openBlockIndex === null) return;

    if (openBlockIndex === oldIndex) {
      openBlockIndex = newIndex;
      return;
    }

    if (oldIndex < newIndex && openBlockIndex > oldIndex && openBlockIndex <= newIndex) {
      openBlockIndex -= 1;
      return;
    }

    if (oldIndex > newIndex && openBlockIndex >= newIndex && openBlockIndex < oldIndex) {
      openBlockIndex += 1;
    }
  }

  function primitiveInputHtml(
    def: PrimitivePropDef,
    value: unknown,
    id: string,
    attrs: string,
    rows = 2
  ): string {
    if (def.type === 'text') {
      return `<textarea id="${id}" ${attrs} class="cms-input" rows="${rows}">${escapeHtml(String(value ?? ''))}</textarea>`;
    }

    if (def.type === 'number') {
      const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : '';
      return `<input type="number" id="${id}" ${attrs} class="cms-input" value="${numericValue}">`;
    }

    if (def.type === 'select') {
      const selectedValue = typeof value === 'string' ? value : '';
      const options = (def.options || [])
        .map((option) => `<option value="${escapeHtml(option)}"${selectedValue === option ? ' selected' : ''}>${escapeHtml(option)}</option>`)
        .join('');
      return `<select id="${id}" ${attrs} class="cms-input">${options}</select>`;
    }

    const textValue = typeof value === 'string' ? value : String(value ?? '');
    return `<input type="text" id="${id}" ${attrs} class="cms-input" value="${escapeHtml(textValue)}">`;
  }

  function renderPrimitiveField(blockIndex: number, propName: string, def: PrimitivePropDef, value: unknown): string {
    const fieldId = `page-block-${blockIndex}-${propName}`;
    const label = withLocaleHint(def.label, isSchemaPropLocalizable(def));
    const error = getInlineError(blockIndex, propName);
    const errorHtml = error ? `<p class="cms-field-error">${escapeHtml(error)}</p>` : '';

    if (def.type === 'boolean') {
      return (
        `<div class="cms-field cms-field-checkbox" data-error-key="${escapeHtml(errorKey(blockIndex, propName))}">` +
        `<input type="checkbox" id="${fieldId}" data-idx="${blockIndex}" data-prop="${escapeHtml(propName)}" class="cms-input" ${(value === true || value === 'true') ? 'checked' : ''}>` +
        `<label for="${fieldId}" class="cms-label-tight">${label}</label>` +
        errorHtml +
        '</div>'
      );
    }

    return (
      `<div class="cms-field" data-error-key="${escapeHtml(errorKey(blockIndex, propName))}">` +
      `<label for="${fieldId}">${label}</label>` +
      primitiveInputHtml(def, value, fieldId, `data-idx="${blockIndex}" data-prop="${escapeHtml(propName)}"`) +
      errorHtml +
      '</div>'
    );
  }

  function renderArrayPrimitiveItem(
    blockIndex: number,
    propName: string,
    arrayDef: ArrayPropDef,
    itemDef: PrimitivePropDef,
    itemValue: unknown,
    itemIndex: number
  ): string {
    const inputId = `page-block-${blockIndex}-${propName}-${itemIndex}`;
    const attrs = `data-array-primitive="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}"`;
    const error = getInlineError(blockIndex, propName, itemIndex);
    const errorHtml = error ? `<p class="cms-field-error">${escapeHtml(error)}</p>` : '';

    const inputControl = itemDef.type === 'boolean'
      ? `<label class="cms-array-item-checkbox"><input type="checkbox" id="${inputId}" ${attrs} class="cms-input" ${(itemValue === true || itemValue === 'true') ? 'checked' : ''}><span>${escapeHtml(itemDef.label || arrayDef.label)}</span></label>`
      : primitiveInputHtml(itemDef, itemValue, inputId, `${attrs} placeholder="${escapeHtml(itemDef.label || arrayDef.label)}"`, 2);

    return (
      `<li class="cms-array-item cms-array-item--primitive" data-array-item-row="${itemIndex}" data-error-key="${escapeHtml(errorKey(blockIndex, propName, itemIndex))}">` +
      '<div class="cms-array-item-inline">' +
      `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
      `<div class="cms-array-item-input">${inputControl}</div>` +
      `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
      '</div>' +
      errorHtml +
      '</li>'
    );
  }

  function renderArrayObjectItem(
    blockIndex: number,
    propName: string,
    objectDef: ObjectArrayItemDef,
    rawItem: unknown,
    itemIndex: number
  ): string {
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)
      ? rawItem as Record<string, unknown>
      : {};

    const rowKey = errorKey(blockIndex, propName, itemIndex);
    const rowError = getInlineError(blockIndex, propName, itemIndex);
    const rowErrorHtml = rowError ? `<p class="cms-field-error">${escapeHtml(rowError)}</p>` : '';

    const stateKey = arrayStateKey(blockIndex, propName);
    const openItemIndex = openArrayItemByKey.get(stateKey);
    const isOpen = openItemIndex === itemIndex;

    const summary = objectArrayItemSummary(objectDef, item, itemIndex);

    const fieldsHtml = Object.entries(objectDef.fields || {})
      .map(([fieldName, fieldDef]) => {
        const value = item[fieldName];
        const fieldId = `page-block-${blockIndex}-${propName}-${itemIndex}-${fieldName}`;
        const inputAttrs = `data-array-primitive="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" data-array-field="${escapeHtml(fieldName)}"`;
        const fieldError = getInlineError(blockIndex, propName, itemIndex, fieldName);
        const fieldErrorHtml = fieldError ? `<p class="cms-field-error">${escapeHtml(fieldError)}</p>` : '';

        if (fieldDef.type === 'boolean') {
          return (
            `<div class="cms-field cms-field-checkbox" data-error-key="${escapeHtml(errorKey(blockIndex, propName, itemIndex, fieldName))}">` +
            `<input type="checkbox" id="${fieldId}" ${inputAttrs} class="cms-input" ${(value === true || value === 'true') ? 'checked' : ''}>` +
            `<label for="${fieldId}" class="cms-label-tight">${escapeHtml(fieldDef.label)}</label>` +
            fieldErrorHtml +
            '</div>'
          );
        }

        return (
          `<div class="cms-field" data-error-key="${escapeHtml(errorKey(blockIndex, propName, itemIndex, fieldName))}">` +
          `<label for="${fieldId}">${escapeHtml(fieldDef.label)}</label>` +
          primitiveInputHtml(fieldDef, value, fieldId, inputAttrs, 2) +
          fieldErrorHtml +
          '</div>'
        );
      })
      .join('');

    return (
      `<li class="cms-array-item cms-array-item--object" data-array-item-row="${itemIndex}" data-error-key="${escapeHtml(rowKey)}">` +
      '<div class="cms-array-item-inline">' +
      `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
      `<span class="cms-array-item-summary">${escapeHtml(summary)}</span>` +
      '<div class="cms-array-item-actions">' +
      `<button type="button" class="cms-array-item-toggle" data-array-toggle="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? 'Contraer' : 'Expandir'}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
      `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
      '</div>' +
      '</div>' +
      `<div class="cms-array-item-body${isOpen ? '' : ' cms-hidden'}">${fieldsHtml}</div>` +
      rowErrorHtml +
      '</li>'
    );
  }

  function renderArrayField(blockIndex: number, propName: string, def: ArrayPropDef, rawValue: unknown): string {
    const items = Array.isArray(rawValue) ? rawValue : [];
    const minItems = typeof def.minItems === 'number' ? def.minItems : null;
    const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
    const maxReached = maxItems !== null && items.length >= maxItems;

    const limits = [
      minItems !== null ? `Min ${minItems}` : '',
      maxItems !== null ? `Max ${maxItems}` : '',
    ].filter(Boolean).join(' · ');

    const arrayError = getInlineError(blockIndex, propName);
    const arrayErrorHtml = arrayError ? `<p class="cms-field-error cms-array-field-error">${escapeHtml(arrayError)}</p>` : '';

    const rowsHtml = items
      .map((itemValue, itemIndex) => {
        if (isPrimitivePropDef(def.item)) {
          return renderArrayPrimitiveItem(blockIndex, propName, def, def.item, itemValue, itemIndex);
        }

        return renderArrayObjectItem(blockIndex, propName, def.item, itemValue, itemIndex);
      })
      .join('');

    const sortableEnabled = def.sortable !== false;

    return (
      `<div class="cms-array-field" data-array-field="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-error-key="${escapeHtml(errorKey(blockIndex, propName))}">` +
      '<div class="cms-array-field-head">' +
      `<label class="cms-array-field-label">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label>` +
      '<div class="cms-array-field-meta">' +
      `<span class="cms-array-field-counter">${items.length} elemento${items.length === 1 ? '' : 's'}</span>` +
      (limits ? `<span class="cms-array-field-hint">${escapeHtml(limits)}</span>` : '') +
      `<button type="button" class="cms-btn cms-btn-secondary cms-array-field-add" data-array-add="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" ${maxReached ? 'disabled' : ''}>Añadir</button>` +
      '</div>' +
      '</div>' +
      `<ul class="cms-array-list" data-array-list="true" data-array-block="${blockIndex}" data-array-prop="${escapeHtml(propName)}" data-array-sortable="${sortableEnabled ? 'true' : 'false'}">${rowsHtml}</ul>` +
      (maxReached ? `<p class="cms-muted cms-array-field-hint">Has alcanzado el máximo de ${maxItems} elementos.</p>` : '') +
      arrayErrorHtml +
      '</div>'
    );
  }

  function updateBlockSummary(blockIndex: number): void {
    const summaryEl = blockList.querySelector<HTMLElement>(`.cms-block-item[data-index="${blockIndex}"] .cms-block-item-summary`);
    if (!summaryEl || !blocksList[blockIndex]) return;
    summaryEl.textContent = blockSummary(blocksList[blockIndex]);
  }

  function focusIssue(issue: BlockValidationIssue): void {
    if (issue.blockIndex === undefined) return;

    let target: Element | null = null;

    if (issue.propName) {
      if (issue.itemIndex !== undefined) {
        const candidates = Array.from(blockList.querySelectorAll<HTMLElement>('[data-array-block][data-array-prop][data-array-item]'));
        target = candidates.find((element) => {
          const parsedBlock = Number.parseInt(element.dataset.arrayBlock || '', 10);
          const parsedItem = Number.parseInt(element.dataset.arrayItem || '', 10);
          if (parsedBlock !== issue.blockIndex) return false;
          if (element.dataset.arrayProp !== issue.propName) return false;
          if (parsedItem !== issue.itemIndex) return false;
          if (issue.fieldName) return element.dataset.arrayField === issue.fieldName;
          return true;
        }) || null;
      } else {
        const primitiveCandidates = Array.from(blockList.querySelectorAll<HTMLElement>('[data-idx][data-prop]'));
        target = primitiveCandidates.find((element) => {
          const parsedBlock = Number.parseInt(element.dataset.idx || '', 10);
          return parsedBlock === issue.blockIndex && element.dataset.prop === issue.propName;
        }) || blockList.querySelector(`[data-array-field="true"][data-array-block="${issue.blockIndex}"][data-array-prop="${issue.propName}"]`);
      }
    }

    if (!target) {
      target = blockList.querySelector<HTMLElement>(`.cms-block-item[data-index="${issue.blockIndex}"]`);
    }

    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (isInputElement(target)) target.focus();
  }

  function applyValidationIssue(issue: BlockValidationIssue): void {
    inlineErrors.clear();

    if (issue.blockIndex !== undefined && issue.propName) {
      inlineErrors.set(errorKey(issue.blockIndex, issue.propName, issue.itemIndex, issue.fieldName), issue.message);
      openBlockIndex = issue.blockIndex;

      if (issue.itemIndex !== undefined) {
        openArrayItemByKey.set(arrayStateKey(issue.blockIndex, issue.propName), issue.itemIndex);
      }
    }

    renderBlocksList();
    requestAnimationFrame(() => focusIssue(issue));
  }

  function renderBlocksList(): void {
    clearArraySortables();
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
      const isOpen = openBlockIndex === index;

      const li = document.createElement('li');
      li.className = 'cms-block-item';
      li.dataset.index = String(index);
      li.innerHTML =
        '<div class="cms-block-item-header">' +
        `<span class="cms-drag-handle" aria-label="Arrastrar">${dragHandleSvg}</span>` +
        '<div class="cms-block-item-meta">' +
        `<span class="cms-block-item-name">${escapeHtml(name)}</span>` +
        `<span class="cms-block-item-summary">${escapeHtml(summary)}</span>` +
        '</div>' +
        `<button type="button" class="cms-block-item-toggle" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="Expandir" data-index="${index}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
        `<button type="button" class="cms-block-item-duplicate" aria-label="Duplicar bloque" data-index="${index}">${copyIconSvg}</button>` +
        `<button type="button" class="cms-table-btn-delete cms-block-item-delete" aria-label="Eliminar bloque" data-index="${index}">${trashIconSvg}</button>` +
        '</div>' +
        `<div class="cms-block-item-body${isOpen ? '' : ' cms-hidden'}"></div>`;

      blockList.appendChild(li);

      const body = li.querySelector('.cms-block-item-body');
      if (!schema || !body) return;

      let fieldsHtml = '<div class="cms-stack cms-block-item-fields">';

      for (const [propName, def] of Object.entries(schema.items || {})) {
        const value = block.props?.[propName];

        if (def.type === 'array') {
          fieldsHtml += renderArrayField(index, propName, def, value);
          continue;
        }

        fieldsHtml += renderPrimitiveField(index, propName, def, value ?? '');
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

        if (clearInlineError(index, propName)) {
          renderBlocksList();
          return;
        }

        updateBlockSummary(index);
      };

      input.addEventListener('input', syncValue);
      input.addEventListener('change', syncValue);
    });

    blockList.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.cms-block-item-fields [data-array-primitive="true"]').forEach((input) => {
      const syncValue = (): void => {
        const blockIndex = Number.parseInt(input.dataset.arrayBlock || '', 10);
        const propName = input.dataset.arrayProp;
        const itemIndex = Number.parseInt(input.dataset.arrayItem || '', 10);
        const fieldName = input.dataset.arrayField;

        if (Number.isNaN(blockIndex) || !propName || Number.isNaN(itemIndex) || !blocksList[blockIndex]) return;

        const values = ensureArrayValue(blockIndex, propName);
        while (values.length <= itemIndex) values.push('');

        if (fieldName) {
          const current = values[itemIndex];
          const objectValue = current && typeof current === 'object' && !Array.isArray(current)
            ? { ...(current as Record<string, unknown>) }
            : {};
          objectValue[fieldName] = parseFieldValue(input);
          values[itemIndex] = objectValue;
        } else {
          values[itemIndex] = parseFieldValue(input);
        }

        if (clearInlineError(blockIndex, propName, itemIndex, fieldName)) {
          renderBlocksList();
          return;
        }

        updateBlockSummary(blockIndex);
      };

      input.addEventListener('input', syncValue);
      input.addEventListener('change', syncValue);
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index || '', 10);
        if (Number.isNaN(index)) return;

        openBlockIndex = openBlockIndex === index ? null : index;
        renderBlocksList();
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-duplicate').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index || '', 10);
        if (index < 0 || !blocksList[index]) return;

        const copy = JSON.parse(JSON.stringify(blocksList[index])) as BlockInstance;
        blocksList.splice(index + 1, 0, copy);
        openBlockIndex = index + 1;
        inlineErrors.clear();
        renderBlocksList();
        showToast('Bloque duplicado.', 'info', 'Editor');
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-block-item-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.index || '', 10);
        if (index < 0 || !blocksList[index]) return;

        blocksList.splice(index, 1);

        const currentOpenIndex = openBlockIndex;
        if (currentOpenIndex !== null) {
          if (currentOpenIndex === index) openBlockIndex = null;
          if (currentOpenIndex > index) openBlockIndex = currentOpenIndex - 1;
        }

        const nextMap = new Map<string, number | null>();
        for (const [key, openRow] of openArrayItemByKey.entries()) {
          const [rawIndex, propName] = key.split('::');
          const parsed = Number.parseInt(rawIndex || '', 10);
          if (Number.isNaN(parsed) || !propName) continue;
          if (parsed === index) continue;
          const nextIndex = parsed > index ? parsed - 1 : parsed;
          nextMap.set(arrayStateKey(nextIndex, propName), openRow);
        }
        openArrayItemByKey.clear();
        nextMap.forEach((value, key) => openArrayItemByKey.set(key, value));

        inlineErrors.clear();
        renderBlocksList();
        showToast('Bloque eliminado.', 'info', 'Editor');
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-array-field-add').forEach((button) => {
      button.addEventListener('click', async () => {
        const blockIndex = Number.parseInt(button.dataset.arrayBlock || '', 10);
        const propName = button.dataset.arrayProp;
        if (Number.isNaN(blockIndex) || !propName || !blocksList[blockIndex]) return;

        const schema = schemaMap?.[blocksList[blockIndex].type];
        const def = schema?.items?.[propName];
        if (!def || def.type !== 'array') return;

        const values = ensureArrayValue(blockIndex, propName);
        const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;

        if (maxItems !== null && values.length >= maxItems) {
          await showAlert(`Has alcanzado el máximo permitido (${maxItems}).`, 'Límite alcanzado');
          return;
        }

        values.push(defaultArrayItemValue(def));

        if (isObjectArrayItemDef(def.item)) {
          openArrayItemByKey.set(arrayStateKey(blockIndex, propName), values.length - 1);
        }

        clearInlineErrorsForProp(blockIndex, propName);
        renderBlocksList();
        updateBlockSummary(blockIndex);
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-array-item-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const blockIndex = Number.parseInt(button.dataset.arrayBlock || '', 10);
        const propName = button.dataset.arrayProp;
        const itemIndex = Number.parseInt(button.dataset.arrayItem || '', 10);

        if (Number.isNaN(blockIndex) || Number.isNaN(itemIndex) || !propName || !blocksList[blockIndex]) return;

        const schema = schemaMap?.[blocksList[blockIndex].type];
        const def = schema?.items?.[propName];
        if (!def || def.type !== 'array') return;

        const values = ensureArrayValue(blockIndex, propName);
        const minItems = typeof def.minItems === 'number' ? def.minItems : null;

        if (minItems !== null && values.length <= minItems) {
          await showAlert(`Este campo requiere al menos ${minItems} elemento(s).`, 'No se puede eliminar');
          return;
        }

        values.splice(itemIndex, 1);

        const stateKey = arrayStateKey(blockIndex, propName);
        const openRow = openArrayItemByKey.get(stateKey);
        if (openRow !== undefined && openRow !== null) {
          if (openRow === itemIndex) openArrayItemByKey.set(stateKey, null);
          if (openRow > itemIndex) openArrayItemByKey.set(stateKey, openRow - 1);
        }

        clearInlineErrorsForProp(blockIndex, propName);
        renderBlocksList();
        updateBlockSummary(blockIndex);
      });
    });

    blockList.querySelectorAll<HTMLButtonElement>('.cms-array-item-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const blockIndex = Number.parseInt(button.dataset.arrayBlock || '', 10);
        const propName = button.dataset.arrayProp;
        const itemIndex = Number.parseInt(button.dataset.arrayItem || '', 10);

        if (Number.isNaN(blockIndex) || Number.isNaN(itemIndex) || !propName) return;

        const stateKey = arrayStateKey(blockIndex, propName);
        const current = openArrayItemByKey.get(stateKey);
        openArrayItemByKey.set(stateKey, current === itemIndex ? null : itemIndex);
        renderBlocksList();
      });
    });

    clearArraySortables();
    blockList.querySelectorAll<HTMLElement>('[data-array-list="true"]').forEach((listEl) => {
      const sortableEnabled = listEl.dataset.arraySortable !== 'false';
      if (!sortableEnabled) return;

      const blockIndex = Number.parseInt(listEl.dataset.arrayBlock || '', 10);
      const propName = listEl.dataset.arrayProp;
      if (Number.isNaN(blockIndex) || !propName || !blocksList[blockIndex]) return;

      const values = ensureArrayValue(blockIndex, propName);
      if (values.length < 2) return;

      const sortable = Sortable.create(listEl, {
        handle: '.cms-array-item-drag',
        ghostClass: 'cms-dragging',
        onEnd(event: SortableEvent) {
          if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return;

          const row = values[event.oldIndex];
          values.splice(event.oldIndex, 1);
          values.splice(event.newIndex, 0, row);

          const stateKey = arrayStateKey(blockIndex, propName);
          const openRow = openArrayItemByKey.get(stateKey);
          if (openRow !== undefined && openRow !== null) {
            if (openRow === event.oldIndex) {
              openArrayItemByKey.set(stateKey, event.newIndex);
            } else if (event.oldIndex < openRow && event.newIndex >= openRow) {
              openArrayItemByKey.set(stateKey, openRow - 1);
            } else if (event.oldIndex > openRow && event.newIndex <= openRow) {
              openArrayItemByKey.set(stateKey, openRow + 1);
            }
          }

          clearInlineErrorsForProp(blockIndex, propName);
          renderBlocksList();
          updateBlockSummary(blockIndex);
        },
      });

      sortableArrays.push(sortable);
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

        adjustOpenBlockIndexAfterMove(event.oldIndex, event.newIndex);
        remapOpenArrayStateForBlockMove(event.oldIndex, event.newIndex);
        inlineErrors.clear();
        renderBlocksList();
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
    openBlockIndex = null;
    openArrayItemByKey.clear();
    inlineErrors.clear();
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
    openBlockIndex = null;
    openArrayItemByKey.clear();
    inlineErrors.clear();
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

  function validateCurrentBlocks(): BlockValidationIssue | null {
    if (!schemaMap || blocksList.length === 0) return null;

    for (let index = 0; index < blocksList.length; index += 1) {
      const block = blocksList[index];
      const schema = schemaMap[block.type];

      if (!schema || !schema.items) {
        return {
          message: `Bloque de tipo desconocido: ${block.type}.`,
          blockIndex: index,
        };
      }

      const props = block.props && typeof block.props === 'object' && !Array.isArray(block.props)
        ? block.props as Record<string, unknown>
        : {};

      const issue = validateBlockPropsAgainstSchema(schema.name || block.type, index, schema.items, props);
      if (issue) return issue;
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
    const validationIssue = validateCurrentBlocks();
    if (validationIssue) {
      applyValidationIssue(validationIssue);
      await showAlert(validationIssue.message, 'No se puede guardar');
      return;
    }

    inlineErrors.clear();

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
        openBlockIndex = blocksList.length - 1;
        inlineErrors.clear();
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
