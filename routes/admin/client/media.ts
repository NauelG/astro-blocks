/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media.ts — Client-side script for the /cms/media admin page.
 * Handles dropzone-based and button-based upload, grid re-render, delete,
 * search (debounced), Prev/Next pagination, and metadata display.
 */

import { getCmsToken, getCmsWindow } from './common.js';
import { fetchMedia, formatBytes, formatDimensions, formatMediaDate } from './media-fetch.js';
import type { MediaListEnvelope, MediaEntry } from './media-fetch.js';

const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

// ─── Page state ───────────────────────────────────────────────────────────────

interface MediaPageState {
  q: string;
  page: number;
  limit: number;
}

const state: MediaPageState = { q: '', page: 1, limit: 24 };

// Monotonic request sequence counter for stale-response guard
let reqSeq = 0;

// Debounce timer handle
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Grid rendering ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderCard(entry: MediaEntry): string {
  const dims = formatDimensions(entry.width, entry.height);
  const metaDims = dims !== '—' ? `<span class="cms-media-card-meta-dim">${escapeHtml(dims)}</span><span class="cms-media-card-meta-sep" aria-hidden="true">·</span>` : '';
  const metaRow = `
    <div class="cms-media-card-meta cms-muted" aria-label="Image metadata">
      ${metaDims}<span class="cms-media-card-meta-size">${escapeHtml(formatBytes(entry.size))}</span><span class="cms-media-card-meta-sep" aria-hidden="true">·</span><span class="cms-media-card-meta-type">${escapeHtml(entry.mimeType)}</span><span class="cms-media-card-meta-sep" aria-hidden="true">·</span><span class="cms-media-card-meta-date">${escapeHtml(formatMediaDate(entry.createdAt))}</span>
    </div>`;

  return `
    <div class="cms-media-card" role="listitem" data-media-url="${escapeAttr(entry.url)}" data-media-id="${escapeAttr(entry.id)}">
      <div class="cms-media-card-thumb">
        <img src="${escapeAttr(entry.url)}" alt="${escapeAttr(entry.filename)}" class="cms-media-card-img" loading="lazy" />
      </div>
      <div class="cms-media-card-info">
        <span class="cms-media-card-name" title="${escapeAttr(entry.filename)}">${escapeHtml(entry.filename)}</span>
        ${metaRow}
        <label class="cms-visually-hidden" for="alt-${escapeAttr(entry.id)}">Alt text for ${escapeAttr(entry.filename)}</label>
        <input
          id="alt-${escapeAttr(entry.id)}"
          type="text"
          class="cms-input cms-media-card-alt"
          data-alt-id="${escapeAttr(entry.id)}"
          value="${escapeAttr(entry.alt ?? '')}"
          placeholder="Describe this image…"
          autocomplete="off"
          aria-label="Alt text for ${escapeAttr(entry.filename)}"
        />
      </div>
      <button
        type="button"
        class="cms-media-card-delete"
        aria-label="Delete ${escapeAttr(entry.filename)}"
        data-delete-url="${escapeAttr(entry.url)}"
        data-delete-filename="${escapeAttr(entry.filename)}"
      >${trashIconSvg}</button>
    </div>`;
}

function renderGrid(envelope: MediaListEnvelope): void {
  const gridCard = document.getElementById('cms-media-grid-card');
  const countEl = document.getElementById('cms-media-count');
  const pageIndicator = document.getElementById('cms-media-page-indicator');
  const prevBtn = document.getElementById('cms-media-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('cms-media-next') as HTMLButtonElement | null;
  const toolbar = document.getElementById('cms-media-toolbar');

  if (!gridCard) return;

  const { uploads, total, page, limit } = envelope;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Clamp state.page to valid range so rapid clicks cannot push it past totalPages.
  // The server returns the authoritative page number; sync state to it.
  state.page = Math.min(Math.max(1, page), totalPages);

  // Show toolbar once we have data
  if (toolbar) toolbar.classList.remove('cms-hidden');

  // Empty state
  if (total === 0 && !state.q) {
    gridCard.innerHTML = `
      <div id="cms-media-empty-state" class="cms-media-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.3"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        <p class="cms-media-empty-title">No images uploaded yet</p>
        <p class="cms-muted">Upload your first image using the area above.</p>
      </div>
    `;
    if (countEl) countEl.textContent = '';
    if (pageIndicator) pageIndicator.textContent = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  if (uploads.length === 0) {
    // Search returned no results
    gridCard.innerHTML = `
      <div id="cms-media-empty-state" class="cms-media-empty-state">
        <p class="cms-media-empty-title">No matching images</p>
        <p class="cms-muted">Try a different search term.</p>
      </div>
    `;
    if (countEl) countEl.textContent = `0 of ${total} images`;
    if (pageIndicator) pageIndicator.textContent = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  // Render grid items
  const items = uploads.map(renderCard).join('');
  gridCard.innerHTML = `<div id="cms-media-grid" class="cms-media-grid" aria-label="Image library" role="list">${items}</div>`;

  // Update count region (aria-live polite)
  if (countEl) countEl.textContent = `${total} image${total !== 1 ? 's' : ''}`;

  // Update page indicator
  if (pageIndicator) pageIndicator.textContent = `Page ${page} of ${totalPages}`;

  // Update pagination button states
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;

  bindDeleteButtons();
  bindAltEditors();
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadMedia(): Promise<void> {
  const seq = ++reqSeq;
  const envelope = await fetchMedia({ q: state.q || undefined, page: state.page, limit: state.limit });
  // Stale response guard: discard if a newer request has already been issued
  if (seq !== reqSeq) return;
  renderGrid(envelope);
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<void> {
  const cmsWindow = getCmsWindow();
  const fd = new FormData();
  fd.append('file', file);

  const token = getCmsToken();
  const res = await fetch('/cms/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });

  if (res.ok) {
    cmsWindow.cmsToast?.({ title: 'Upload successful', message: `${file.name} uploaded.`, tone: 'success' });
    // Reset to page 1 to show newly uploaded file
    state.page = 1;
    await loadMedia();
  } else {
    let errorMsg = 'Upload failed.';
    try {
      const body = await res.json() as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch { /* ignore */ }
    cmsWindow.cmsToast?.({ title: 'Upload error', message: errorMsg, tone: 'error' });
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteMedia(url: string, filename: string, triggerBtn: HTMLButtonElement): Promise<void> {
  const cmsWindow = getCmsWindow();
  const confirmed = await cmsWindow.cmsConfirm?.({ message: `Delete "${filename}"?`, confirmLabel: 'Delete' });
  if (!confirmed) return;

  const token = getCmsToken();
  const res = await fetch('/cms/api/upload', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (res.ok || res.status === 204) {
    cmsWindow.cmsToast?.({ title: 'Deleted', message: `${filename} removed.`, tone: 'success' });
    await loadMedia();
    // Return focus to prev/next if possible, else search
    const searchInput = document.getElementById('cms-media-search') as HTMLInputElement | null;
    searchInput?.focus();
  } else {
    cmsWindow.cmsToast?.({ title: 'Delete failed', message: 'Could not remove the image.', tone: 'error' });
    triggerBtn.focus();
  }
}

function bindDeleteButtons(): void {
  const gridCard = document.getElementById('cms-media-grid-card');
  if (!gridCard) return;
  gridCard.querySelectorAll<HTMLButtonElement>('[data-delete-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.deleteUrl ?? '';
      const filename = btn.dataset.deleteFilename ?? url;
      deleteMedia(url, filename, btn).catch(() => { /* handled in fn */ });
    });
  });
}

// ─── Alt text editor ──────────────────────────────────────────────────────────

async function patchMediaAlt(id: string, alt: string): Promise<void> {
  const cmsWindow = getCmsWindow();
  const token = getCmsToken();
  const res = await fetch(`/cms/api/media/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ alt }),
  });

  if (res.ok) {
    cmsWindow.cmsToast?.({ title: 'Alt text saved', message: 'Default alt text updated.', tone: 'success' });
  } else {
    cmsWindow.cmsToast?.({ title: 'Save failed', message: 'Could not save alt text.', tone: 'error' });
  }
}

function bindAltEditors(): void {
  const gridCard = document.getElementById('cms-media-grid-card');
  if (!gridCard) return;

  gridCard.querySelectorAll<HTMLInputElement>('[data-alt-id]').forEach((input) => {
    const saveAlt = (): void => {
      const id = input.dataset.altId ?? '';
      if (!id) return;
      patchMediaAlt(id, input.value).catch(() => { /* handled in fn */ });
    };

    input.addEventListener('blur', saveAlt);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });
}

// ─── Search input ─────────────────────────────────────────────────────────────

function bindSearchInput(): void {
  const searchInput = document.getElementById('cms-media-search') as HTMLInputElement | null;
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      state.page = 1; // reset to first page on new search
      loadMedia().catch(() => { /* handled in fn */ });
    }, 250);
  });
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function bindPaginationButtons(): void {
  const prevBtn = document.getElementById('cms-media-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('cms-media-next') as HTMLButtonElement | null;

  prevBtn?.addEventListener('click', () => {
    // Guard: do nothing if already in-flight (button is disabled while loading)
    if (prevBtn.disabled) return;
    state.page = Math.max(1, state.page - 1);
    // Disable both buttons immediately to prevent rapid-click page drift
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    loadMedia()
      .then(() => {
        // Retain focus on Prev (may be disabled now; browser handles it)
        prevBtn.focus();
      })
      .catch(() => { /* handled in fn */ });
  });

  nextBtn?.addEventListener('click', () => {
    // Guard: do nothing if already in-flight (button is disabled while loading)
    if (nextBtn.disabled) return;
    state.page++;
    // Disable both buttons immediately to prevent rapid-click page drift
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    loadMedia()
      .then(() => {
        nextBtn.focus();
      })
      .catch(() => { /* handled in fn */ });
  });
}

// ─── Dropzone ─────────────────────────────────────────────────────────────────

function initDropzone(): void {
  const dropzone = document.getElementById('cms-media-dropzone');
  const fileInput = document.getElementById('cms-media-file-input') as HTMLInputElement | null;
  const uploadBtn = document.getElementById('cms-media-upload-btn');

  if (!dropzone || !fileInput) return;

  uploadBtn?.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      uploadFile(file).catch(() => { /* handled in fn */ });
    });
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('cms-dropzone--active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('cms-dropzone--active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('cms-dropzone--active');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      uploadFile(file).catch(() => { /* handled in fn */ });
    });
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function initMediaPage(): void {
  initDropzone();
  bindSearchInput();
  bindPaginationButtons();
  // Initial load: replace SSR grid with client-rendered paginated grid
  loadMedia().catch(() => { /* fetchMedia already returns safe default on error */ });
}
