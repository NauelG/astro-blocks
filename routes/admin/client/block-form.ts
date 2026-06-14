/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * block-form.ts — Pure single-block field renderer for the admin UI.
 *
 * Interface contract:
 *   mountBlockForm(options) → { destroy() }
 *
 *   options.container   — HTMLElement where fields will be rendered
 *   options.schemaItems — Record<string, PropDef> from the block schema
 *   options.values      — mutable values object (mutated in place on change)
 *   options.onChange    — called whenever any field value changes
 *   options.inlineErrors— Map<errorKey, message> — read once on (re)mount; call remount to reflect changes
 *   options.fieldPrefix — string prefix for generated field IDs (default: 'gb-field')
 *
 * Sortable (for array fields) is initialized inside mountBlockForm and
 * destroyed on destroy(). Sortable lifecycle does NOT leave this module.
 *
 * What this module does NOT do:
 *   - Block-list management (add/remove/reorder blocks)
 *   - Block-level validation orchestration
 *   - Dialog open/close
 *   - Fetch / save operations
 *
 * Security note: user-controlled string values use TWO escapers depending on context:
 *   - escapeHtml()       — element TEXT CONTENT only (encodes & < >; safe between > and <)
 *   - escapePickerHtml() — HTML ATTRIBUTE VALUES (encodes & < > " '; safe inside ="...")
 * Using escapeHtml() inside an attribute is wrong: a " in the value terminates the attribute.
 */

import Sortable, { type SortableEvent } from 'sortablejs';
import type { ArrayPropDef, ImageFieldValue, ObjectArrayItemDef, PrimitivePropDef, PropDef } from '../../../types/index.js';
import {
  isObjectArrayItemDef,
  isPrimitivePropDef,
} from '../../../utils/block-validation.js';
import { isSchemaPropLocalizable } from '../../../utils/localization.js';
import { escapeHtml, getActiveContentLocale, getCmsToken } from './common.js';
import { toImageValue, parseImageValue, mediaEntryToImageValue, serializeImageValueAttr } from '../../../utils/image-value.js';
import { fetchMedia, formatBytes, formatDimensions, formatMediaDate } from './media-fetch.js';
import type { MediaEntry as MediaFetchEntry } from './media-fetch.js';

// SVG icons (same as page-editor.ts and global-blocks-editor.ts)
const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const imagePickerIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
const xIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ─── Singleton media picker dialog ───────────────────────────────────────────
// Mounted ONCE on document.body at module load (never inside the re-rendered form subtree).
// Pattern mirrors cmsConfirm/ConfirmDialog singleton.

let pickerDialog: HTMLDialogElement | null = null;
let activePickerInputId: string | null = null;

// Re-alias the imported type so existing picker code can use 'MediaEntry' name unchanged
type MediaEntry = MediaFetchEntry;

function escapePickerHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mountPickerDialog(): void {
  if (pickerDialog || typeof document === 'undefined') return;
  pickerDialog = document.createElement('dialog');
  pickerDialog.id = 'cms-media-picker';
  pickerDialog.className = 'cms-media-picker-dialog';
  pickerDialog.setAttribute('aria-label', 'Choose image');
  pickerDialog.innerHTML = `
    <div class="cms-media-picker-panel">
      <div class="cms-media-picker-header">
        <h2 class="cms-media-picker-title">Choose image</h2>
        <button type="button" class="cms-media-picker-close" id="cms-media-picker-close" aria-label="Close image picker">${xIconSvg}</button>
      </div>
      <div class="cms-media-picker-body" id="cms-media-picker-body">
        <p class="cms-muted">Loading images…</p>
      </div>
    </div>
    <style>
      /* Picker modal mirrors the DetailModal layout contract: the <dialog>
         element is a full-bleed transparent stage (UA-centered, no card chrome),
         and the visible card lives on the inner .cms-media-picker-panel. This
         avoids the full-viewport-white / narrow-column failure that happens when
         the dialog element itself is forced to width:100%. */
      #cms-media-picker {
        max-width: 100%;
        max-height: 100%;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 1rem;
        border: none;
        background: transparent;
      }
      #cms-media-picker::backdrop {
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .cms-media-picker-panel {
        display: flex;
        flex-direction: column;
        width: min(92vw, 820px);
        max-height: min(85vh, calc(100vh - 2rem));
        margin: 0 auto;
        overflow: hidden;
        background: var(--cms-surface, #fff);
        border: 1px solid var(--cms-border, #e3e8f0);
        border-radius: var(--cms-radius-base, 0.5rem);
        box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,0.09), 0 3px 8px rgba(0,0,0,0.06));
      }
      .cms-media-picker-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 1rem 1.5rem 0.875rem;
        border-bottom: 1px solid var(--cms-border, #e3e8f0);
        flex-shrink: 0;
      }
      .cms-media-picker-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--cms-text-strong, #111827);
      }
      .cms-media-picker-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.6rem;
        height: 1.6rem;
        min-width: 24px;
        min-height: 24px;
        padding: 0;
        border-radius: var(--cms-radius-base, 0.5rem);
        border: 1px solid var(--cms-border, #e3e8f0);
        background: var(--cms-surface-alt, #f7f8fc);
        color: var(--cms-text-muted, #6b7280);
        cursor: pointer;
        transition: background var(--cms-transition, 120ms ease),
          border-color var(--cms-transition, 120ms ease),
          color var(--cms-transition, 120ms ease);
      }
      .cms-media-picker-close:hover {
        background: color-mix(in srgb, var(--cms-primary, #2C53B8) 8%, var(--cms-surface-alt, #f7f8fc));
        border-color: var(--cms-border-strong, #c5cedd);
        color: var(--cms-text-strong, #111827);
      }
      .cms-media-picker-close:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--cms-primary, #2C53B8) 50%, transparent);
        outline-offset: 1px;
      }
      .cms-media-picker-body {
        padding: 1rem 1.5rem;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .cms-media-picker-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.625rem;
        margin-top: 0.75rem;
      }
      .cms-media-picker-item {
        display: flex;
        flex-direction: column;
        cursor: pointer;
        border: 2px solid var(--cms-border, #e3e8f0);
        border-radius: var(--cms-radius-base, 0.5rem);
        overflow: hidden;
        background: var(--cms-surface-alt, #f7f8fc);
        transition: border-color var(--cms-transition, 120ms ease),
          box-shadow var(--cms-transition, 120ms ease);
        padding: 0;
        text-align: left;
      }
      .cms-media-picker-item:hover,
      .cms-media-picker-item:focus-visible {
        border-color: var(--cms-primary, #2C53B8);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--cms-primary, #2C53B8) 18%, transparent);
        outline: none;
      }
      .cms-media-picker-img {
        width: 100%;
        aspect-ratio: 1/1;
        object-fit: cover;
        display: block;
        background: var(--cms-surface-alt, #f7f8fc);
        border-bottom: 1px solid var(--cms-border, #e3e8f0);
      }
      .cms-media-picker-name {
        font-size: 0.7rem;
        padding: 0.3rem 0.4rem;
        color: var(--cms-text-strong, #111827);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
      }
      .cms-media-picker-upload {
        margin-top: 1rem;
        padding-top: 0.875rem;
        border-top: 1px solid var(--cms-border, #e3e8f0);
      }
      .cms-media-picker-upload-label {
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--cms-text-strong, #111827);
        display: block;
        margin-bottom: 0.5rem;
      }
      .cms-media-picker-upload-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      /* Visually hidden native file input — triggered by the styled "Choose file" button. */
      .cms-media-picker-file-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .cms-media-picker-filename {
        font-size: 0.78rem;
        color: var(--cms-text-muted, #6b7280);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 14rem;
      }
    </style>
  `;

  document.body.appendChild(pickerDialog);

  // Close button
  pickerDialog.querySelector('#cms-media-picker-close')?.addEventListener('click', () => {
    closePickerDialog();
  });

  // Click on backdrop closes dialog
  pickerDialog.addEventListener('click', (e) => {
    if (e.target === pickerDialog) closePickerDialog();
  });

  // ESC closes dialog and returns focus (native dialog handles focus trap)
  pickerDialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closePickerDialog();
  });
}

function closePickerDialog(): void {
  if (!pickerDialog) return;
  pickerDialog.close();
  // Return focus to trigger button
  if (activePickerInputId) {
    const container = document.getElementById(activePickerInputId)?.closest('[data-block-form]') ?? document.body;
    const triggerBtn = container.querySelector<HTMLButtonElement>(`[data-picker-for="${CSS.escape(activePickerInputId)}"]`);
    triggerBtn?.focus();
  }
  activePickerInputId = null;
}

/**
 * Update an image field's visible DOM IN PLACE to reflect `url` (empty string =
 * cleared). Fields are not re-rendered on value change, so the preview, filename,
 * "selected" state, and Choose/Clear labels must be mutated directly here.
 *
 * Pure presentation: it does NOT touch the hidden input value, dispatch events,
 * or alter the value contract — callers own that.
 */
function updateImageFieldDom(hiddenInput: HTMLInputElement, url: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const hasValue = url.length > 0;
  const filename = hasValue ? imageFilenameFromUrl(url) : '';
  field.classList.toggle('cms-image-field--has-value', hasValue);

  const previewWrap = field.querySelector<HTMLElement>('[data-image-preview]');
  if (previewWrap) {
    previewWrap.innerHTML = hasValue
      ? `<img src="${escapePickerHtml(url)}" alt="${escapePickerHtml(filename)}" class="cms-image-field-thumb" data-image-thumb>`
      : `<span class="cms-image-field-placeholder" aria-hidden="true">${imagePickerIconSvg}</span>`;
  }

  const nameEl = field.querySelector<HTMLElement>('.cms-image-field-name');
  if (nameEl) {
    nameEl.classList.toggle('cms-image-field-name--empty', !hasValue);
    nameEl.textContent = hasValue ? filename : 'No image selected';
    if (hasValue) nameEl.setAttribute('title', filename);
    else nameEl.removeAttribute('title');
  }

  const chooseLabel = field.querySelector<HTMLElement>('[data-choose-label]');
  if (chooseLabel) chooseLabel.textContent = hasValue ? 'Replace' : 'Choose image';
}

/**
 * Seed the visible alt-override input for an image field from the current hidden-input JSON.
 * Reads parseImageValue(hidden.value).alt and sets the alt input value.
 */
function seedAltInput(hiddenInput: HTMLInputElement, altOverride?: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const altInput = field.querySelector<HTMLInputElement>('[data-image-alt-for]');
  if (!altInput) return;
  if (altOverride !== undefined) {
    altInput.value = altOverride;
  } else {
    const current = parseImageValue(hiddenInput.value);
    altInput.value = current.alt ?? '';
  }
}

/**
 * Seed the visible caption input for an image field from the current hidden-input JSON.
 * Reads parseImageValue(hidden.value).caption and sets the caption input value.
 * If captionOverride is provided, that value is used directly (used on picker pick and clear).
 */
function seedCaptionInput(hiddenInput: HTMLInputElement, captionOverride?: string): void {
  const field = hiddenInput.closest<HTMLElement>('.cms-image-field');
  if (!field) return;
  const captionInput = field.querySelector<HTMLInputElement>('[data-image-caption-for]');
  if (!captionInput) return;
  if (captionOverride !== undefined) {
    captionInput.value = captionOverride;
  } else {
    const current = parseImageValue(hiddenInput.value);
    captionInput.value = current.caption ?? '';
  }
}

function selectPickerImage(value: ImageFieldValue): void {
  if (!activePickerInputId) return;
  const hiddenInput = document.getElementById(activePickerInputId) as HTMLInputElement | null;
  if (hiddenInput) {
    // Store the full ImageFieldValue as JSON in the hidden input
    hiddenInput.value = JSON.stringify(value);
    // Update the visible field DOM in place — the value-sync loop does not
    // re-render fields on change, so the preview would otherwise stay stale.
    updateImageFieldDom(hiddenInput, value.url);
    // Seed the alt-override input from the snapshot default alt
    seedAltInput(hiddenInput, value.alt ?? '');
    // Picker carries no caption default — seed empty (caption is per-component)
    seedCaptionInput(hiddenInput, '');
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closePickerDialog();
}

// ─── Picker state (per dialog open) ─────────────────────────────────────────

interface PickerState {
  q: string;
  page: number;
  items: MediaEntry[];
  total: number;
  limit: number;
}

let pickerState: PickerState = { q: '', page: 1, items: [], total: 0, limit: 24 };
let pickerReqSeq = 0;
let pickerSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Picker grid rendering ────────────────────────────────────────────────────

function renderPickerItem(entry: MediaEntry): string {
  const dims = formatDimensions(entry.width, entry.height);
  const metaDims = dims !== '—' ? `<span class="cms-media-picker-meta-dim">${escapePickerHtml(dims)}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span>` : '';
  const metaRow = `<span class="cms-media-picker-meta cms-muted">${metaDims}<span class="cms-media-picker-meta-size">${escapePickerHtml(formatBytes(entry.size))}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span><span class="cms-media-picker-meta-type">${escapePickerHtml(entry.mimeType)}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span><span class="cms-media-picker-meta-date">${escapePickerHtml(formatMediaDate(entry.createdAt))}</span></span>`;

  return `<button type="button" class="cms-media-picker-item"
    data-picker-url="${escapePickerHtml(entry.url)}"
    data-picker-alt="${escapePickerHtml(entry.alt ?? '')}"
    ${entry.width !== undefined ? `data-picker-width="${entry.width}"` : ''}
    ${entry.height !== undefined ? `data-picker-height="${entry.height}"` : ''}
    aria-label="Select ${escapePickerHtml(entry.filename)}">
    <img src="${escapePickerHtml(entry.url)}" alt="${escapePickerHtml(entry.filename)}" class="cms-media-picker-img" loading="lazy" />
    <span class="cms-media-picker-name">${escapePickerHtml(entry.filename)}</span>
    ${metaRow}
  </button>`;
}

/**
 * Renders the picker grid into the stable `gridContainer` element.
 * The search input and upload section live in separate stable containers
 * that this function does NOT touch — preventing the "search goes dead"
 * bug where innerHTML-replacement destroyed the bound event listener.
 */
function renderPickerGrid(gridContainer: HTMLElement, uploadSection: string): void {
  const { items, total } = pickerState;
  const allLoaded = items.length >= total;
  const countText = total > 0 ? `${items.length} of ${total} images` : '0 images';

  const countRegion = `<p role="status" aria-live="polite" class="cms-media-picker-count cms-muted">${escapePickerHtml(countText)}</p>`;

  if (items.length === 0) {
    gridContainer.innerHTML = `${countRegion}<p class="cms-muted cms-media-picker-empty">No images yet.</p>`;
    return;
  }

  const gridItems = items.map(renderPickerItem).join('');
  const loadMoreBtn = allLoaded
    ? ''
    : `<button type="button" id="cms-picker-load-more" class="cms-btn cms-btn-secondary cms-media-picker-load-more">Load more</button>`;

  gridContainer.innerHTML = `${countRegion}<div class="cms-media-picker-grid">${gridItems}</div>${loadMoreBtn}`;

  // Bind selection clicks
  gridContainer.querySelectorAll<HTMLButtonElement>('[data-picker-url]').forEach((item) => {
    item.addEventListener('click', () => {
      const url = item.dataset.pickerUrl ?? '';
      if (!url) return;
      const alt = item.dataset.pickerAlt ?? '';
      const w = item.dataset.pickerWidth !== undefined ? Math.floor(Number(item.dataset.pickerWidth)) : undefined;
      const h = item.dataset.pickerHeight !== undefined ? Math.floor(Number(item.dataset.pickerHeight)) : undefined;
      const value: ImageFieldValue = {
        url,
        alt,
        ...(w !== undefined && Number.isFinite(w) && w > 0 && { width: w }),
        ...(h !== undefined && Number.isFinite(h) && h > 0 && { height: h }),
      };
      selectPickerImage(value);
    });
  });

  // Bind load-more button
  const loadMoreEl = gridContainer.querySelector<HTMLButtonElement>('#cms-picker-load-more');
  if (loadMoreEl) {
    loadMoreEl.addEventListener('click', () => {
      pickerState.page++;
      pickerLoadPage(gridContainer, uploadSection, true /* append */).catch(() => { /* handled */ });
    });
  }
}

async function pickerLoadPage(gridContainer: HTMLElement, uploadSection: string, append: boolean): Promise<void> {
  const seq = ++pickerReqSeq;
  const envelope = await fetchMedia({
    q: pickerState.q || undefined,
    page: pickerState.page,
    limit: pickerState.limit,
  });
  if (seq !== pickerReqSeq) return; // stale response guard

  pickerState.total = envelope.total;
  if (append) {
    pickerState.items = [...pickerState.items, ...envelope.uploads];
  } else {
    pickerState.items = envelope.uploads;
  }

  renderPickerGrid(gridContainer, uploadSection);
}

async function openPickerDialog(triggerBtn: HTMLButtonElement, inputId: string): Promise<void> {
  if (!pickerDialog) mountPickerDialog();
  if (!pickerDialog) return;

  activePickerInputId = inputId;

  // Reset picker state for fresh open.
  // pickerReqSeq is NOT reset here — it is monotonically increasing (module-level).
  // Resetting it would allow stale responses from a previous dialog session to
  // match the new session's seq counter and clobber content.
  pickerState = { q: '', page: 1, items: [], total: 0, limit: 24 };
  if (pickerSearchDebounceTimer !== null) clearTimeout(pickerSearchDebounceTimer);

  const body = pickerDialog.querySelector<HTMLElement>('#cms-media-picker-body');
  if (!body) return;

  // Build the stable three-zone layout:
  //   [searchContainer]  — bound ONCE; never overwritten by grid renders
  //   [gridContainer]    — replaced on every pickerLoadPage call
  //   [uploadContainer]  — bound ONCE; never overwritten by grid renders
  //
  // This prevents the "search input goes dead" bug where body.innerHTML
  // replacement destroyed the already-bound input event listener.
  body.innerHTML = `
    <div id="cms-picker-search-zone"></div>
    <div id="cms-picker-grid-zone"><p class="cms-muted">Loading images…</p></div>
    <div id="cms-picker-upload-zone"></div>
  `;

  const searchContainer = body.querySelector<HTMLElement>('#cms-picker-search-zone')!;
  const gridContainer = body.querySelector<HTMLElement>('#cms-picker-grid-zone')!;
  const uploadContainer = body.querySelector<HTMLElement>('#cms-picker-upload-zone')!;

  // Render search input into its stable zone
  searchContainer.innerHTML = `
    <div class="cms-media-picker-search-row">
      <label for="cms-picker-search" class="cms-visually-hidden">Search images by filename</label>
      <input type="search" id="cms-picker-search" class="cms-input cms-media-picker-search" placeholder="Search by filename…" autocomplete="off" aria-label="Search images by filename" />
    </div>
  `;

  // Render upload section into its stable zone
  uploadContainer.innerHTML = `
    <div class="cms-media-picker-upload">
      <span class="cms-media-picker-upload-label" id="cms-picker-upload-label">Upload new image</span>
      <div class="cms-media-picker-upload-row">
        <input type="file" id="cms-picker-file-input" accept="image/*" class="cms-media-picker-file-input" aria-labelledby="cms-picker-upload-label" />
        <button type="button" id="cms-picker-choose-btn" class="cms-btn cms-btn-secondary" aria-controls="cms-picker-file-input">Choose file</button>
        <span class="cms-media-picker-filename" id="cms-picker-filename" aria-live="polite">No file selected</span>
        <button type="button" id="cms-picker-upload-btn" class="cms-btn cms-btn-primary" disabled>Upload</button>
      </div>
    </div>
  `;

  // Keep uploadSection string so renderPickerGrid callers that pass it can
  // be satisfied — now it is a no-op arg since upload lives in uploadContainer.
  const uploadSection = '';

  pickerDialog.showModal();

  try {
    // Bind search input ONCE — it lives in searchContainer which renderPickerGrid never touches
    const searchInput = searchContainer.querySelector<HTMLInputElement>('#cms-picker-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (pickerSearchDebounceTimer !== null) clearTimeout(pickerSearchDebounceTimer);
        pickerSearchDebounceTimer = setTimeout(() => {
          // New search: reset to page 1, clear accumulated items
          pickerState.q = searchInput.value.trim();
          pickerState.page = 1;
          pickerState.items = [];
          pickerState.total = 0;
          pickerLoadPage(gridContainer, uploadSection, false /* replace */).catch(() => { /* handled */ });
        }, 250);
      });
    }

    // Load first page into gridContainer
    await pickerLoadPage(gridContainer, uploadSection, false);

    // Bind upload section controls ONCE — they live in uploadContainer
    const uploadBtn = uploadContainer.querySelector<HTMLButtonElement>('#cms-picker-upload-btn');
    const fileInput = uploadContainer.querySelector<HTMLInputElement>('#cms-picker-file-input');
    const chooseBtn = uploadContainer.querySelector<HTMLButtonElement>('#cms-picker-choose-btn');
    const filenameLabel = uploadContainer.querySelector<HTMLElement>('#cms-picker-filename');

    chooseBtn?.addEventListener('click', () => { fileInput?.click(); });

    fileInput?.addEventListener('change', () => {
      const selected = fileInput.files?.[0];
      if (filenameLabel) filenameLabel.textContent = selected ? selected.name : 'No file selected';
      if (uploadBtn) uploadBtn.disabled = !selected;
    });

    uploadBtn?.addEventListener('click', async () => {
      if (!fileInput?.files?.length) return;
      const file = fileInput.files[0];
      uploadBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const token = getCmsToken();
        const uploadRes = await fetch('/cms/api/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (uploadRes.ok) {
          const uploadBody = await uploadRes.json() as { url?: string; entry?: MediaEntry };
          if (uploadBody.url) {
            const entry = uploadBody.entry;
            const value: ImageFieldValue = entry
              ? mediaEntryToImageValue(entry)
              : { url: uploadBody.url, alt: '' };
            selectPickerImage(value);
          }
        }
      } finally {
        uploadBtn.disabled = false;
      }
    });
  } catch {
    gridContainer.innerHTML = '<p class="cms-muted">Could not load images.</p>';
  }
}

// Mount the singleton picker dialog once at module load time
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mountPickerDialog(); });
  } else {
    mountPickerDialog();
  }
}
const chevronDownSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const chevronUpSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const dragHandleSvg =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';

// Field-level change context passed as second arg to onChange.
// Callers that don't need it (e.g. global-blocks-editor) may ignore the argument.
export interface FieldChangeInfo {
  propName: string;
  itemIndex?: number;
  fieldName?: string;
}

/** Info passed to onArrayLimitReached when an add/delete hits a min/max boundary. */
export interface ArrayLimitInfo {
  prop: string;
  limit: 'min' | 'max';
  value: number;
}

/**
 * Pure helper: given the current array length and its PropDef, returns limit info if the
 * array is AT or BEYOND a min/max boundary, or null if no limit applies.
 *
 * Used internally by the add/delete handlers and exported so tests can verify the logic.
 *
 * Convention:
 *   - "max" → currentLength >= maxItems (cannot add)
 *   - "min" → currentLength <= minItems (cannot delete)
 */
export function checkArrayLimitReached(
  currentLength: number,
  def: { maxItems?: number; minItems?: number }
): { limit: 'min' | 'max'; value: number } | null {
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  if (maxItems !== null && currentLength >= maxItems) return { limit: 'max', value: maxItems };
  if (minItems !== null && currentLength <= minItems) return { limit: 'min', value: minItems };
  return null;
}

export interface BlockFormOptions {
  container: HTMLElement;
  schemaItems: Record<string, PropDef>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>, change?: FieldChangeInfo) => void;
  inlineErrors?: Map<string, string>;
  fieldPrefix?: string;
  /** Restore previously saved open-array-item state across re-mounts. */
  initialOpenArrayItems?: Map<string, number | null>;
  /**
   * Called when an add or delete operation is blocked because the array has
   * reached its maxItems or minItems limit. Optional — if omitted the handler
   * silently returns (original behaviour).
   */
  onArrayLimitReached?: (info: ArrayLimitInfo) => void;
}

export interface BlockFormHandle {
  destroy(): void;
  /** Snapshot of which array item (by propName) is currently expanded. */
  getOpenArrayItems(): Map<string, number | null>;
}

// Key helpers
function errorKey(propName: string, itemIndex?: number, fieldName?: string): string {
  return [propName, itemIndex === undefined ? '' : String(itemIndex), fieldName || ''].join('::');
}

function withLocaleHint(label: string, localizable = true): string {
  if (!localizable) return escapeHtml(label);
  return `${escapeHtml(label)} <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`;
}

function parseFieldValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (input instanceof HTMLInputElement && input.type === 'number') return input.value === '' ? '' : Number(input.value);
  // Image field: hidden input carries JSON ImageFieldValue (marked with data-image-value)
  if (input instanceof HTMLInputElement && input.dataset.imageValue !== undefined) {
    return parseImageValue(input.value);
  }
  return input.value;
}

function defaultPrimitiveValue(def: PrimitivePropDef): unknown {
  if (def.type === 'boolean') return false;
  if (def.type === 'number') return '';
  if (def.type === 'select') return Array.isArray(def.options) && def.options.length > 0 ? def.options[0] : '';
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

// "File missing" icon — shown when a preview src fails to load (404 / legacy raw path).
const imageMissingIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="m2 2 20 20"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><path d="M21 15.5 16.92 11.4a2 2 0 0 0-2.83 0L8 17.5"/></svg>';

/** Derive a human-friendly filename from a stored URL/path value. */
function imageFilenameFromUrl(url: string): string {
  const last = url.split('/').pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Render the image field as a compact horizontal control.
 * Same DOM shape for both states — toggled via .cms-image-field--has-value on
 * the root — so selectPickerImage()/Clear can mutate it in place.
 *
 * The hidden input carries the full JSON-serialized ImageFieldValue.
 * A visible alt-override input below the actions lets users set per-component alt.
 *
 * Responsive seam: when srcset/webp generation is added, it will slot into
 * selectPickerImage() and BlockImage.astro without breaking the hidden-input contract.
 */
function imageFieldHtml(
  id: string,
  attrs: string,
  value: ImageFieldValue,
  localizable = false
): string {
  const urlValue = value.url;
  const altValue = value.alt ?? '';
  const captionValue = value.caption ?? '';
  const hasValue = urlValue.length > 0;
  const filename = hasValue ? imageFilenameFromUrl(urlValue) : '';
  const stateClass = hasValue ? ' cms-image-field--has-value' : '';
  // Preview slot: <img> when there is a value, placeholder icon otherwise.
  // data-image-preview marks the slot so the delegated error listener can swap
  // a failed <img> to the "file missing" state without inline JS in attributes.
  const previewInner = hasValue
    ? `<img src="${escapePickerHtml(urlValue)}" alt="${escapePickerHtml(filename)}" class="cms-image-field-thumb" data-image-thumb>`
    : `<span class="cms-image-field-placeholder" aria-hidden="true">${imagePickerIconSvg}</span>`;
  // "Selected: <filename>" vs "No image selected" — perceivable without color.
  const nameHtml = hasValue
    ? `<span class="cms-image-field-name" title="${escapePickerHtml(filename)}">${escapeHtml(filename)}</span>`
    : '<span class="cms-image-field-name cms-image-field-name--empty">No image selected</span>';
  const chooseLabel = hasValue ? 'Replace' : 'Choose image';
  const altInputId = `${id}-alt`;
  const captionInputId = `${id}-caption`;
  const altLabel = localizable
    ? `Alt text <span class="cms-locale-hint">(${escapeHtml(getActiveContentLocale('es'))})</span>`
    : 'Alt text';
  // Clear button is always present in the DOM; visibility is toggled via the
  // root modifier class so the in-place update never has to insert/remove nodes.
  // The hidden input now carries the full JSON ImageFieldValue.
  // escapePickerHtml is used for all HTML attribute value contexts (encodes " too);
  // escapeHtml is sufficient for element content (text nodes cannot break attributes).
  return (
    `<div class="cms-image-field${stateClass}" data-image-field="${escapePickerHtml(id)}">` +
    `<input type="text" id="${id}" ${attrs} class="cms-media-value cms-hidden" value="${serializeImageValueAttr(value)}" tabindex="-1" aria-hidden="true" data-image-value="1">` +
    `<div class="cms-image-field-preview-wrap" data-image-preview>${previewInner}</div>` +
    `<div class="cms-image-field-detail">` +
    nameHtml +
    `<div class="cms-image-field-actions">` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-image-field-choose" data-picker-for="${escapePickerHtml(id)}" aria-label="Choose image">${imagePickerIconSvg}<span data-choose-label>${chooseLabel}</span></button>` +
    `<button type="button" class="cms-btn cms-btn-secondary cms-image-field-clear" data-picker-clear="${escapePickerHtml(id)}" aria-label="Clear image">Clear</button>` +
    `</div>` +
    `<div class="cms-image-field-alt-row">` +
    `<label for="${altInputId}" class="cms-image-field-alt-label">${altLabel}</label>` +
    `<input type="text" id="${altInputId}" class="cms-input cms-image-field-alt-input" data-image-alt-for="${escapePickerHtml(id)}" value="${escapePickerHtml(altValue)}" placeholder="Describe this image…" autocomplete="off">` +
    `</div>` +
    `<div class="cms-image-field-caption-row">` +
    `<label for="${captionInputId}" class="cms-image-field-caption-label">Caption</label>` +
    `<input type="text" id="${captionInputId}" class="cms-input cms-image-field-caption-input" data-image-caption-for="${escapePickerHtml(id)}" value="${escapePickerHtml(captionValue)}" placeholder="Add a visible caption…" autocomplete="off">` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

function primitiveInputHtml(def: PrimitivePropDef, value: unknown, id: string, attrs: string, rows = 2): string {
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
      .map((option) => `<option value="${escapePickerHtml(option)}"${selectedValue === option ? ' selected' : ''}>${escapeHtml(option)}</option>`)
      .join('');
    return `<select id="${id}" ${attrs} class="cms-input">${options}</select>`;
  }
  if (def.type === 'image') {
    // Coerce legacy string → ImageFieldValue. Compact HORIZONTAL layout: fixed thumbnail
    // on the LEFT, state text + action buttons on the RIGHT. The DOM is the same for both
    // the empty and selected states (toggled via .cms-image-field--has-value modifier on
    // the root) so selectPickerImage / Clear can update it IN PLACE without a full re-render.
    const imageValue = toImageValue(value);
    return imageFieldHtml(id, attrs, imageValue, isSchemaPropLocalizable(def));
  }
  const textValue = typeof value === 'string' ? value : String(value ?? '');
  return `<input type="text" id="${id}" ${attrs} class="cms-input" value="${escapePickerHtml(textValue)}">`;
}

function renderPrimitiveField(
  propName: string,
  def: PrimitivePropDef,
  value: unknown,
  prefix: string,
  errorMsg: string
): string {
  const fieldId = `${prefix}-${propName}`;
  const label = withLocaleHint(def.label, isSchemaPropLocalizable(def));
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';

  if (def.type === 'boolean') {
    return (
      `<div class="cms-field cms-field-checkbox" data-error-key="${escapePickerHtml(errorKey(propName))}">` +
      `<input type="checkbox" id="${fieldId}" data-prop="${escapePickerHtml(propName)}" ${(value === true || value === 'true') ? 'checked' : ''}>` +
      `<label for="${fieldId}" class="cms-label-tight">${label}</label>` +
      errorHtml +
      '</div>'
    );
  }

  return (
    `<div class="cms-field" data-error-key="${escapePickerHtml(errorKey(propName))}">` +
    `<label for="${fieldId}">${label}</label>` +
    primitiveInputHtml(def, value, fieldId, `data-prop="${escapePickerHtml(propName)}"`) +
    errorHtml +
    '</div>'
  );
}

function renderArrayPrimitiveItem(
  propName: string,
  arrayDef: ArrayPropDef,
  itemDef: PrimitivePropDef,
  itemValue: unknown,
  itemIndex: number,
  prefix: string,
  errorMsg: string
): string {
  const inputId = `${prefix}-${propName}-${itemIndex}`;
  const attrs = `data-array-primitive="true" data-array-prop="${escapePickerHtml(propName)}" data-array-item="${itemIndex}"`;
  const errorHtml = errorMsg ? `<p class="cms-field-error">${escapeHtml(errorMsg)}</p>` : '';
  const inputControl = itemDef.type === 'boolean'
    ? `<label class="cms-array-item-checkbox"><input type="checkbox" id="${inputId}" ${attrs} ${(itemValue === true || itemValue === 'true') ? 'checked' : ''}><span>${escapeHtml(itemDef.label || arrayDef.label)}</span></label>`
    : primitiveInputHtml(itemDef, itemValue, inputId, `${attrs} placeholder="${escapePickerHtml(itemDef.label || arrayDef.label)}"`, 2);

  return (
    `<li class="cms-array-item cms-array-item--primitive" data-array-item-row="${itemIndex}" data-error-key="${escapePickerHtml(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
    `<div class="cms-array-item-input">${inputControl}</div>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapePickerHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
    '</div>' +
    errorHtml +
    '</li>'
  );
}

function renderArrayObjectItem(
  propName: string,
  objectDef: ObjectArrayItemDef,
  rawItem: unknown,
  itemIndex: number,
  prefix: string,
  openItemIndex: number | null | undefined,
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string
): string {
  const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
  const rowError = getError(propName, itemIndex);
  const rowErrorHtml = rowError ? `<p class="cms-field-error">${escapeHtml(rowError)}</p>` : '';
  const isOpen = openItemIndex === itemIndex;

  let summary = `Elemento ${itemIndex + 1}`;
  if (objectDef.summaryField) {
    const fromSummaryField = item[objectDef.summaryField];
    if (typeof fromSummaryField === 'string' && fromSummaryField.trim()) summary = fromSummaryField.trim();
  }
  if (summary === `Elemento ${itemIndex + 1}`) {
    for (const fieldName of Object.keys(objectDef.fields || {})) {
      const v = item[fieldName];
      if (typeof v === 'string' && v.trim()) { summary = v.trim(); break; }
    }
  }

  const fieldsHtml = Object.entries(objectDef.fields || {})
    .map(([fieldName, fieldDef]) => {
      const value = item[fieldName];
      const fieldId = `${prefix}-${propName}-${itemIndex}-${fieldName}`;
      const inputAttrs = `data-array-primitive="true" data-array-prop="${escapePickerHtml(propName)}" data-array-item="${itemIndex}" data-array-field="${escapePickerHtml(fieldName)}"`;
      const fieldError = getError(propName, itemIndex, fieldName);
      const fieldErrorHtml = fieldError ? `<p class="cms-field-error">${escapeHtml(fieldError)}</p>` : '';
      if (fieldDef.type === 'boolean') {
        return (
          `<div class="cms-field cms-field-checkbox" data-error-key="${escapePickerHtml(errorKey(propName, itemIndex, fieldName))}">` +
          `<input type="checkbox" id="${fieldId}" ${inputAttrs} ${(value === true || value === 'true') ? 'checked' : ''}>` +
          `<label for="${fieldId}" class="cms-label-tight">${escapeHtml(fieldDef.label)}</label>` +
          fieldErrorHtml +
          '</div>'
        );
      }
      return (
        `<div class="cms-field" data-error-key="${escapePickerHtml(errorKey(propName, itemIndex, fieldName))}">` +
        `<label for="${fieldId}">${escapeHtml(fieldDef.label)}</label>` +
        primitiveInputHtml(fieldDef, value, fieldId, inputAttrs, 2) +
        fieldErrorHtml +
        '</div>'
      );
    })
    .join('');

  return (
    `<li class="cms-array-item cms-array-item--object" data-array-item-row="${itemIndex}" data-error-key="${escapePickerHtml(errorKey(propName, itemIndex))}">` +
    '<div class="cms-array-item-inline">' +
    `<span class="cms-drag-handle cms-array-item-drag" aria-label="Arrastrar">${dragHandleSvg}</span>` +
    `<span class="cms-array-item-summary">${escapeHtml(summary)}</span>` +
    '<div class="cms-array-item-actions">' +
    `<button type="button" class="cms-array-item-toggle" data-array-toggle="true" data-array-prop="${escapePickerHtml(propName)}" data-array-item="${itemIndex}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${isOpen ? 'Contraer' : 'Expandir'}">${isOpen ? chevronUpSvg : chevronDownSvg}</button>` +
    `<button type="button" class="cms-array-item-delete" data-array-delete="true" data-array-prop="${escapePickerHtml(propName)}" data-array-item="${itemIndex}" aria-label="Eliminar elemento">${trashIconSvg}</button>` +
    '</div>' +
    '</div>' +
    `<div class="cms-array-item-body${isOpen ? '' : ' cms-hidden'}">${fieldsHtml}</div>` +
    rowErrorHtml +
    '</li>'
  );
}

function renderArrayField(
  propName: string,
  def: ArrayPropDef,
  rawValue: unknown,
  prefix: string,
  openItemIndex: number | null | undefined,
  getError: (propName: string, itemIndex?: number, fieldName?: string) => string
): string {
  const items = Array.isArray(rawValue) ? rawValue : [];
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const maxReached = maxItems !== null && items.length >= maxItems;
  const limits = [minItems !== null ? `Min ${minItems}` : '', maxItems !== null ? `Max ${maxItems}` : ''].filter(Boolean).join(' · ');
  const arrayError = getError(propName);
  const arrayErrorHtml = arrayError ? `<p class="cms-field-error cms-array-field-error">${escapeHtml(arrayError)}</p>` : '';

  const rowsHtml = items.map((itemValue, itemIndex) => {
    if (isPrimitivePropDef(def.item)) {
      return renderArrayPrimitiveItem(propName, def, def.item, itemValue, itemIndex, prefix, getError(propName, itemIndex));
    }
    return renderArrayObjectItem(propName, def.item, itemValue, itemIndex, prefix, openItemIndex, getError);
  }).join('');

  const sortableEnabled = def.sortable !== false;
  return (
    `<div class="cms-array-field" data-array-field="true" data-array-prop="${escapePickerHtml(propName)}" data-error-key="${escapePickerHtml(errorKey(propName))}">` +
    '<div class="cms-array-field-head">' +
    `<label class="cms-array-field-label">${withLocaleHint(def.label, isSchemaPropLocalizable(def))}</label>` +
    '<div class="cms-array-field-meta">' +
    `<span class="cms-array-field-counter">${items.length} elemento${items.length === 1 ? '' : 's'}</span>` +
    (limits ? `<span class="cms-array-field-hint">${escapeHtml(limits)}</span>` : '') +
    `<button type="button" class="cms-btn cms-btn-secondary cms-array-field-add" data-array-add="true" data-array-prop="${escapePickerHtml(propName)}" ${maxReached ? 'disabled' : ''}>Añadir</button>` +
    '</div>' +
    '</div>' +
    `<ul class="cms-array-list" data-array-list="true" data-array-prop="${escapePickerHtml(propName)}" data-array-sortable="${sortableEnabled ? 'true' : 'false'}">${rowsHtml}</ul>` +
    (maxReached ? `<p class="cms-muted cms-array-field-hint">Has alcanzado el máximo de ${maxItems} elementos.</p>` : '') +
    arrayErrorHtml +
    '</div>'
  );
}

/**
 * Mount a single-block form into `container`.
 * Renders all fields from `schemaItems`, wires up value sync + array sortable.
 * Returns a handle with `destroy()` to clean up sortables and event listeners.
 */
export function mountBlockForm(options: BlockFormOptions): BlockFormHandle {
  const {
    container,
    schemaItems,
    values,
    onChange,
    inlineErrors = new Map(),
    fieldPrefix = 'gb-field',
    initialOpenArrayItems,
    onArrayLimitReached,
  } = options;

  const sortables: Sortable[] = [];
  const openArrayItemByKey: Map<string, number | null> = initialOpenArrayItems
    ? new Map(initialOpenArrayItems)
    : new Map();

  function getError(propName: string, itemIndex?: number, fieldName?: string): string {
    const key = errorKey(propName, itemIndex, fieldName);
    const exact = inlineErrors.get(key);
    if (exact) return exact;
    if (fieldName !== undefined) {
      const itemLevel = inlineErrors.get(errorKey(propName, itemIndex));
      if (itemLevel) return itemLevel;
    }
    return '';
  }

  function getArrayValue(propName: string): unknown[] {
    const v = values[propName];
    if (Array.isArray(v)) return v;
    const next: unknown[] = [];
    values[propName] = next;
    return next;
  }

  function render(): void {
    sortables.forEach((s) => s.destroy());
    sortables.length = 0;

    let html = '<div class="cms-stack cms-block-item-fields">';
    for (const [propName, def] of Object.entries(schemaItems)) {
      const value = values[propName];
      if (def.type === 'array') {
        html += renderArrayField(propName, def, value, fieldPrefix, openArrayItemByKey.get(propName) ?? null, getError);
      } else {
        html += renderPrimitiveField(propName, def as PrimitivePropDef, value ?? '', fieldPrefix, getError(propName));
      }
    }
    html += '</div>';
    // All values passed to escapeHtml() before insertion — consistent with admin UI pattern
    container.innerHTML = html;
    bindEvents();
  }

  function bindEvents(): void {
    // Primitive field inputs (not inside arrays)
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-prop]:not([data-array-primitive])').forEach((input) => {
      const sync = (): void => {
        const propName = input.dataset.prop;
        if (!propName) return;
        values[propName] = parseFieldValue(input);
        onChange(values, { propName });
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });

    // Array primitive / object field inputs
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-array-primitive="true"]').forEach((input) => {
      const sync = (): void => {
        const propName = input.dataset.arrayProp;
        const itemIndex = Number.parseInt(input.dataset.arrayItem || '', 10);
        const fieldName = input.dataset.arrayField;
        if (!propName || Number.isNaN(itemIndex)) return;
        const arr = getArrayValue(propName);
        while (arr.length <= itemIndex) arr.push('');
        if (fieldName) {
          const current = arr[itemIndex];
          const obj = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
          obj[fieldName] = parseFieldValue(input);
          arr[itemIndex] = obj;
        } else {
          arr[itemIndex] = parseFieldValue(input);
        }
        onChange(values, { propName, itemIndex, fieldName: fieldName || undefined });
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });

    // Array add buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-add="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        if (!propName) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo) {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.push(defaultArrayItemValue(def));
        if (isObjectArrayItemDef(def.item)) openArrayItemByKey.set(propName, arr.length - 1);
        onChange(values, { propName });
        render();
      });
    });

    // Array delete buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-delete="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo?.limit === 'min') {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.splice(itemIndex, 1);
        const current = openArrayItemByKey.get(propName);
        if (current !== undefined && current !== null) {
          if (current === itemIndex) openArrayItemByKey.set(propName, null);
          if (current > itemIndex) openArrayItemByKey.set(propName, current - 1);
        }
        onChange(values, { propName, itemIndex });
        render();
      });
    });

    // Array object item toggle
    container.querySelectorAll<HTMLButtonElement>('[data-array-toggle="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const current = openArrayItemByKey.get(propName);
        openArrayItemByKey.set(propName, current === itemIndex ? null : itemIndex);
        render();
      });
    });

    // Image field — alt override input: wires changes to update only the alt
    // field in the hidden JSON, leaving url/width/height unchanged.
    container.querySelectorAll<HTMLInputElement>('[data-image-alt-for]').forEach((altInput) => {
      const sync = (): void => {
        const inputId = altInput.dataset.imageAltFor;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (!hiddenInput) return;
        const current = parseImageValue(hiddenInput.value);
        current.alt = altInput.value;
        hiddenInput.value = JSON.stringify(current);
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      };
      altInput.addEventListener('input', sync);
      altInput.addEventListener('change', sync);
    });

    // Image field — caption input: wires changes to update only the caption
    // field in the hidden JSON, leaving url/alt/width/height unchanged.
    container.querySelectorAll<HTMLInputElement>('[data-image-caption-for]').forEach((captionInput) => {
      const sync = (): void => {
        const inputId = captionInput.dataset.imageCaptionFor;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (!hiddenInput) return;
        const current = parseImageValue(hiddenInput.value);
        current.caption = captionInput.value;
        hiddenInput.value = JSON.stringify(current);
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      };
      captionInput.addEventListener('input', sync);
      captionInput.addEventListener('change', sync);
    });

    // Image field — "Choose image" button opens the picker dialog
    container.querySelectorAll<HTMLButtonElement>('[data-picker-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.pickerFor;
        if (!inputId) return;
        openPickerDialog(btn, inputId).catch(() => { /* no-op */ });
      });
    });

    // Image field — "Clear" button resets value and restores the empty state in place
    container.querySelectorAll<HTMLButtonElement>('[data-picker-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.pickerClear;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (hiddenInput) {
          // Set hidden input to empty JSON sentinel; clear alt and caption inputs
          hiddenInput.value = JSON.stringify({ url: '', alt: '', caption: '' });
          updateImageFieldDom(hiddenInput, '');
          seedAltInput(hiddenInput, '');
          seedCaptionInput(hiddenInput, '');
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // Image field — graceful fallback for a failed preview (404 / legacy raw path).
    // Delegated capture-phase 'error' listener (img error events do not bubble):
    // swaps the broken <img> for a "file missing" state so the user never sees
    // the browser's broken-image glyph. No inline JS in HTML attributes.
    container.addEventListener(
      'error',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (!target || !(target instanceof HTMLImageElement)) return;
        if (!target.matches('[data-image-thumb]')) return;
        const wrap = target.closest<HTMLElement>('[data-image-preview]');
        if (!wrap) return;
        wrap.innerHTML = `<span class="cms-image-field-placeholder cms-image-field-placeholder--missing" role="img" aria-label="File missing">${imageMissingIconSvg}</span>`;
      },
      true
    );

    // Array sortable for reordering items within each array field
    container.querySelectorAll<HTMLElement>('[data-array-list="true"]').forEach((listEl) => {
      if (listEl.dataset.arraySortable === 'false') return;
      const propName = listEl.dataset.arrayProp;
      if (!propName) return;
      const arr = getArrayValue(propName);
      if (arr.length < 2) return;
      const sortable = Sortable.create(listEl, {
        handle: '.cms-array-item-drag',
        ghostClass: 'cms-dragging',
        onEnd(event: SortableEvent) {
          if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return;
          const row = arr[event.oldIndex];
          arr.splice(event.oldIndex, 1);
          arr.splice(event.newIndex, 0, row);
          const openRow = openArrayItemByKey.get(propName);
          if (openRow !== undefined && openRow !== null) {
            if (openRow === event.oldIndex) openArrayItemByKey.set(propName, event.newIndex);
            else if (event.oldIndex < openRow && event.newIndex >= openRow) openArrayItemByKey.set(propName, openRow - 1);
            else if (event.oldIndex > openRow && event.newIndex <= openRow) openArrayItemByKey.set(propName, openRow + 1);
          }
          onChange(values, { propName });
          render();
        },
      });
      sortables.push(sortable);
    });
  }

  // Re-render on locale change (updates locale hints in labels)
  const localeChangeHandler = (): void => { render(); };
  window.addEventListener('cms:content-locale-change', localeChangeHandler);

  render();

  return {
    destroy(): void {
      sortables.forEach((s) => s.destroy());
      sortables.length = 0;
      window.removeEventListener('cms:content-locale-change', localeChangeHandler);
      container.innerHTML = '';
    },
    getOpenArrayItems(): Map<string, number | null> {
      return new Map(openArrayItemByKey);
    },
  };
}
