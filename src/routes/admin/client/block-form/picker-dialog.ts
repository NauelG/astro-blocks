/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * picker-dialog.ts — the singleton media picker <dialog>.
 *
 * Owns the dialog lifecycle (mount once on document.body at module load,
 * open/close), the per-open picker state (search, pagination, mode, accept
 * filter), the grid rendering and the in-picker upload flow. The only entry
 * point for callers is openPickerDialog(); selection writes back to the
 * field's hidden input via the field-dom-sync helpers and dispatches
 * input/change events.
 */

import type { FileFieldValue, ImageFieldValue } from '../../../../types/index.js';
import { escapeHtml, escapeAttr } from '../../../../utils/html-escape.js';
import { mediaEntryToImageValue } from '../../../../utils/image-value.js';
import { mediaEntryToFileValue } from '../../../../utils/file-value.js';
import { categoryIconSvg, resolveTileCategory } from '../../../../utils/media-tile.js';
import { showToast } from '../common.js';
import { ct } from '../../i18n/client.js';
import {
  fetchMedia,
  formatBytes,
  formatDimensions,
  formatMediaDate,
  uploadMedia,
} from '../media-fetch.js';
import type { MediaEntry as MediaFetchEntry } from '../media-fetch.js';
import {
  seedAltInput,
  seedCaptionInput,
  updateFileFieldDom,
  updateImageFieldDom,
} from './field-dom-sync.js';
import { pickerTitleKeyForMode } from './picker-title.js';

const xIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ─── Singleton media picker dialog ───────────────────────────────────────────
// Mounted ONCE on document.body at module load (never inside the re-rendered form subtree).
// Pattern mirrors cmsConfirm/ConfirmDialog singleton.

let pickerDialog: HTMLDialogElement | null = null;
let activePickerInputId: string | null = null;
// 'image' | 'file' — set when the picker dialog is opened so renderPickerGrid
// and the grid's selection handler know which selectPicker* to call.
let activePickerMode: 'image' | 'file' = 'image';
// When picker mode is 'file', the effective MIME types the picker grid should
// show. An empty array means "no restriction" (show all). Set on open.
let activePickerAccept: string[] = [];

// Re-alias the imported type so existing picker code can use 'MediaEntry' name unchanged
type MediaEntry = MediaFetchEntry;

function mountPickerDialog(): void {
  if (pickerDialog || typeof document === 'undefined') return;
  pickerDialog = document.createElement('dialog');
  pickerDialog.id = 'cms-media-picker';
  pickerDialog.className = 'cms-media-picker-dialog';
  // Mount with the image-mode title triple; openPickerDialog overwrites all
  // three on every open from the mode it is called with (see applyPickerTitle).
  const initial = pickerTitleKeyForMode('image');
  pickerDialog.setAttribute('aria-label', ct(initial.aria));
  pickerDialog.innerHTML = `
    <div class="cms-media-picker-panel">
      <div class="cms-media-picker-header">
        <h2 class="cms-media-picker-title">${escapeHtml(ct(initial.title))}</h2>
        <button type="button" class="cms-media-picker-close" id="cms-media-picker-close" aria-label="${escapeAttr(ct(initial.close))}">${xIconSvg}</button>
      </div>
      <div class="cms-media-picker-body" id="cms-media-picker-body">
        <p class="cms-muted">${escapeHtml(ct('blockForm.pickerLoading'))}</p>
      </div>
    </div>
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
    const container =
      document.getElementById(activePickerInputId)?.closest('[data-block-form]') ?? document.body;
    const triggerBtn = container.querySelector<HTMLButtonElement>(
      `[data-picker-for="${CSS.escape(activePickerInputId)}"]`,
    );
    triggerBtn?.focus();
  }
  activePickerInputId = null;
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

/**
 * Select a file-field entry from the picker dialog.
 * Mirror of selectPickerImage for the 'file' prop type (ADR-3).
 * Writes the serialized FileFieldValue into the hidden input and closes the dialog.
 */
function selectPickerFile(value: FileFieldValue): void {
  if (!activePickerInputId) return;
  const hiddenInput = document.getElementById(activePickerInputId) as HTMLInputElement | null;
  if (hiddenInput) {
    hiddenInput.value = JSON.stringify(value);
    updateFileFieldDom(hiddenInput, value);
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
  const metaDims =
    dims !== '—'
      ? `<span class="cms-media-picker-meta-dim">${escapeHtml(dims)}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span>`
      : '';
  const metaRow = `<span class="cms-media-picker-meta cms-muted">${metaDims}<span class="cms-media-picker-meta-size">${escapeHtml(formatBytes(entry.size))}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span><span class="cms-media-picker-meta-type">${escapeHtml(entry.mimeType)}</span><span class="cms-media-picker-meta-sep" aria-hidden="true">·</span><span class="cms-media-picker-meta-date">${escapeHtml(formatMediaDate(entry.createdAt))}</span></span>`;

  // The picker used to decide this by parsing the MIME string, ignoring fileCategory entirely —
  // so a video would have shown the PDF icon here while the media grid showed a video one. One
  // rule, one place (utils/media-tile.ts).
  const category = resolveTileCategory(entry);
  const thumbHtml =
    category !== 'image'
      ? `<div class="cms-media-picker-img cms-media-picker-doc-thumb" role="img" aria-label="${escapeAttr(entry.filename)}" aria-hidden="false">${categoryIconSvg(category)}</div>`
      : `<img src="${escapeAttr(entry.url)}" alt="${escapeAttr(entry.filename)}" class="cms-media-picker-img" loading="lazy" />`;

  return `<button type="button" class="cms-media-picker-item"
    data-picker-url="${escapeAttr(entry.url)}"
    data-picker-alt="${escapeAttr(entry.alt ?? '')}"
    data-picker-mime="${escapeAttr(entry.mimeType)}"
    data-picker-filename="${escapeAttr(entry.filename)}"
    ${entry.width !== undefined ? `data-picker-width="${entry.width}"` : ''}
    ${entry.height !== undefined ? `data-picker-height="${entry.height}"` : ''}
    aria-label="${escapeAttr(ct('blockForm.pickerSelectAriaLabel', { filename: entry.filename }))}">
    ${thumbHtml}
    <span class="cms-media-picker-name">${escapeHtml(entry.filename)}</span>
    ${metaRow}
  </button>`;
}

/**
 * Renders the picker grid into the stable `gridContainer` element.
 * The search input and upload section live in separate stable containers
 * that this function does NOT touch — preventing the "search goes dead"
 * bug where innerHTML-replacement destroyed the bound event listener.
 *
 * In 'file' picker mode, entries are filtered to those whose mimeType is in
 * activePickerAccept (the effectiveAccept for the field). In 'image' mode all
 * entries are shown (existing behavior — no change).
 */
function renderPickerGrid(gridContainer: HTMLElement, uploadSection: string): void {
  const { items, total } = pickerState;

  // Filter entries for file-mode picks: only show entries whose mimeType is in effectiveAccept.
  // Image-mode shows all entries (existing behavior unchanged).
  const visibleItems =
    activePickerMode === 'file' && activePickerAccept.length > 0
      ? items.filter((e) => activePickerAccept.includes(e.mimeType.toLowerCase()))
      : items;

  const allLoaded = items.length >= total;
  const countText =
    total > 0
      ? ct('blockForm.pickerCountOf', { shown: String(visibleItems.length), total: String(total) })
      : ct('blockForm.pickerCount0');

  const countRegion = `<p role="status" aria-live="polite" class="cms-media-picker-count cms-muted">${escapeHtml(countText)}</p>`;

  if (visibleItems.length === 0) {
    gridContainer.innerHTML = `${countRegion}<p class="cms-muted cms-media-picker-empty">${escapeHtml(ct('blockForm.pickerEmpty'))}</p>`;
    return;
  }

  const gridItems = visibleItems.map(renderPickerItem).join('');
  const loadMoreBtn = allLoaded
    ? ''
    : `<button type="button" id="cms-picker-load-more" class="cms-btn cms-btn-secondary cms-media-picker-load-more">${escapeHtml(ct('blockForm.pickerLoadMore'))}</button>`;

  gridContainer.innerHTML = `${countRegion}<div class="cms-media-picker-grid">${gridItems}</div>${loadMoreBtn}`;

  // Bind selection clicks — branch on picker mode to call the right selectPicker* handler.
  gridContainer.querySelectorAll<HTMLButtonElement>('[data-picker-url]').forEach((item) => {
    item.addEventListener('click', () => {
      const url = item.dataset.pickerUrl ?? '';
      if (!url) return;

      if (activePickerMode === 'file') {
        // File pick: build a FileFieldValue from the entry's data attributes.
        const mimeType = item.dataset.pickerMime ?? '';
        const filename = item.dataset.pickerFilename ?? '';
        // The schema-level download default is not available here — it was seeded
        // into the def at render time. We preserve whatever download flag was in
        // the hidden input (set from def.download when the field was rendered);
        // just pick the file metadata without overriding the download flag.
        const fileValue: FileFieldValue = {
          url,
          mimeType: mimeType || undefined,
          filename: filename || undefined,
        };
        selectPickerFile(fileValue);
        return;
      }

      // Image pick (unchanged behavior):
      const alt = item.dataset.pickerAlt ?? '';
      const w =
        item.dataset.pickerWidth !== undefined
          ? Math.floor(Number(item.dataset.pickerWidth))
          : undefined;
      const h =
        item.dataset.pickerHeight !== undefined
          ? Math.floor(Number(item.dataset.pickerHeight))
          : undefined;
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
      pickerLoadPage(gridContainer, uploadSection, true /* append */).catch(() => {
        /* handled */
      });
    });
  }
}

async function pickerLoadPage(
  gridContainer: HTMLElement,
  uploadSection: string,
  append: boolean,
): Promise<void> {
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

export async function openPickerDialog(
  triggerBtn: HTMLButtonElement,
  inputId: string,
  mode: 'image' | 'file' = 'image',
  effectiveAccept: string[] = [],
): Promise<void> {
  if (!pickerDialog) mountPickerDialog();
  if (!pickerDialog) return;

  activePickerInputId = inputId;
  activePickerMode = mode;
  activePickerAccept = effectiveAccept;

  // Title the dialog for the prop type it was opened for: 'image' keeps "image"
  // (it acts on an image prop, §3); 'file' reads as "media" (holds any asset).
  // textContent/setAttribute are safe sinks — no escaping needed.
  const titleKeys = pickerTitleKeyForMode(mode);
  pickerDialog.setAttribute('aria-label', ct(titleKeys.aria));
  const titleEl = pickerDialog.querySelector<HTMLElement>('.cms-media-picker-title');
  if (titleEl) titleEl.textContent = ct(titleKeys.title);
  const closeEl = pickerDialog.querySelector<HTMLElement>('#cms-media-picker-close');
  if (closeEl) closeEl.setAttribute('aria-label', ct(titleKeys.close));

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
    <div id="cms-picker-grid-zone"><p class="cms-muted">${escapeHtml(ct('blockForm.pickerLoading'))}</p></div>
    <div id="cms-picker-upload-zone"></div>
  `;

  const searchContainer = body.querySelector<HTMLElement>('#cms-picker-search-zone')!;
  const gridContainer = body.querySelector<HTMLElement>('#cms-picker-grid-zone')!;
  const uploadContainer = body.querySelector<HTMLElement>('#cms-picker-upload-zone')!;

  // Render search input into its stable zone
  searchContainer.innerHTML = `
    <div class="cms-media-picker-search-row">
      <label for="cms-picker-search" class="cms-visually-hidden">${escapeHtml(ct('blockForm.pickerSearchLabel'))}</label>
      <input type="search" id="cms-picker-search" class="cms-input cms-media-picker-search" placeholder="${escapeAttr(ct('blockForm.pickerSearchPlaceholder'))}" autocomplete="off" aria-label="${escapeAttr(ct('blockForm.pickerSearchAriaLabel'))}" />
    </div>
  `;

  // Determine the accept attribute for the upload input inside the picker.
  // Image mode: restrict to image/* (existing behavior).
  // File mode: use the effectiveAccept for this field (joined MIME list) or fall back to '*/*'.
  const pickerUploadAccept =
    mode === 'file' ? (effectiveAccept.length > 0 ? effectiveAccept.join(',') : '*/*') : 'image/*';

  // Render upload section into its stable zone
  uploadContainer.innerHTML = `
    <div class="cms-media-picker-upload">
      <span class="cms-media-picker-upload-label" id="cms-picker-upload-label">${escapeHtml(ct('blockForm.pickerUploadLabel'))}</span>
      <div class="cms-media-picker-upload-row">
        <input type="file" id="cms-picker-file-input" accept="${escapeAttr(pickerUploadAccept)}" class="cms-media-picker-file-input" aria-labelledby="cms-picker-upload-label" />
        <button type="button" id="cms-picker-choose-btn" class="cms-btn cms-btn-secondary" aria-controls="cms-picker-file-input">${escapeHtml(ct('blockForm.pickerChooseFile'))}</button>
        <span class="cms-media-picker-filename" id="cms-picker-filename" aria-live="polite">${escapeHtml(ct('blockForm.pickerNoFileSelected'))}</span>
        <button type="button" id="cms-picker-upload-btn" class="cms-btn cms-btn-primary" disabled>${escapeHtml(ct('blockForm.pickerUpload'))}</button>
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
          pickerLoadPage(gridContainer, uploadSection, false /* replace */).catch(() => {
            /* handled */
          });
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

    chooseBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
      const selected = fileInput.files?.[0];
      if (filenameLabel)
        filenameLabel.textContent = selected ? selected.name : ct('blockForm.pickerNoFileSelected');
      if (uploadBtn) uploadBtn.disabled = !selected;
    });

    uploadBtn?.addEventListener('click', async () => {
      if (!fileInput?.files?.length) return;
      const file = fileInput.files[0];
      uploadBtn.disabled = true;
      try {
        const uploadRes = await uploadMedia(file);
        if (uploadRes.ok) {
          const uploadBody = (await uploadRes.json()) as { url?: string; entry?: MediaEntry };
          if (uploadBody.url) {
            const entry = uploadBody.entry;
            if (activePickerMode === 'file') {
              // File-mode upload: produce a FileFieldValue from the entry.
              const fileValue: FileFieldValue = entry
                ? mediaEntryToFileValue(entry)
                : { url: uploadBody.url };
              selectPickerFile(fileValue);
            } else {
              // Image-mode upload (unchanged behavior):
              const value: ImageFieldValue = entry
                ? mediaEntryToImageValue(entry)
                : { url: uploadBody.url, alt: '' };
              selectPickerImage(value);
            }
          }
        } else {
          const errBody = (await uploadRes.json().catch(() => ({}))) as { error?: string };
          showToast(errBody.error || ct('media.uploadFailed'), 'error', ct('media.uploadError'));
        }
      } catch {
        showToast(ct('media.uploadFailed'), 'error', ct('media.uploadError'));
      } finally {
        uploadBtn.disabled = false;
      }
    });
  } catch {
    gridContainer.innerHTML = `<p class="cms-muted">${escapeHtml(ct('blockForm.pickerLoadError'))}</p>`;
  }
}

// Mount the singleton picker dialog once at module load time
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountPickerDialog();
    });
  } else {
    mountPickerDialog();
  }
}
