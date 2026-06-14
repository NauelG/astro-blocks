/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media.ts — Client-side script for the /cms/media admin page.
 * Handles dropzone-based and button-based upload, grid re-render, and delete.
 */

import { getCmsToken, getCmsWindow } from './common.js';

const trashIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

interface MediaEntry {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
  alt?: string;
  width?: number;
  height?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderGrid(uploads: MediaEntry[]): void {
  const gridCard = document.getElementById('cms-media-grid-card');
  if (!gridCard) return;

  if (uploads.length === 0) {
    gridCard.innerHTML = `
      <div id="cms-media-empty-state" class="cms-media-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.3"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        <p class="cms-media-empty-title">No images uploaded yet</p>
        <p class="cms-muted">Upload your first image using the area above.</p>
      </div>
    `;
    return;
  }

  const items = uploads
    .map(
      (entry) => `
    <div class="cms-media-card" role="listitem" data-media-url="${escapeAttr(entry.url)}" data-media-id="${escapeAttr(entry.id)}">
      <div class="cms-media-card-thumb">
        <img src="${escapeAttr(entry.url)}" alt="${escapeAttr(entry.filename)}" class="cms-media-card-img" loading="lazy" />
      </div>
      <div class="cms-media-card-info">
        <span class="cms-media-card-name" title="${escapeAttr(entry.filename)}">${escapeHtml(entry.filename)}</span>
        <span class="cms-media-card-size cms-muted">${escapeHtml(formatBytes(entry.size))}</span>
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
    </div>`
    )
    .join('');

  gridCard.innerHTML = `<div id="cms-media-grid" class="cms-media-grid" aria-label="Image library" role="list">${items}</div>`;
  bindDeleteButtons();
  bindAltEditors();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchMediaList(): Promise<MediaEntry[]> {
  const token = getCmsToken();
  const res = await fetch('/cms/api/media', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = await res.json() as { uploads?: MediaEntry[] };
  return body.uploads ?? [];
}

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
    const uploads = await fetchMediaList();
    renderGrid(uploads);
  } else {
    let errorMsg = 'Upload failed.';
    try {
      const body = await res.json() as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch { /* ignore */ }
    cmsWindow.cmsToast?.({ title: 'Upload error', message: errorMsg, tone: 'error' });
  }
}

async function deleteMedia(url: string, filename: string): Promise<void> {
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
    const uploads = await fetchMediaList();
    renderGrid(uploads);
  } else {
    cmsWindow.cmsToast?.({ title: 'Delete failed', message: 'Could not remove the image.', tone: 'error' });
  }
}

function bindDeleteButtons(): void {
  const gridCard = document.getElementById('cms-media-grid-card');
  if (!gridCard) return;
  gridCard.querySelectorAll<HTMLButtonElement>('[data-delete-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.deleteUrl ?? '';
      const filename = btn.dataset.deleteFilename ?? url;
      deleteMedia(url, filename).catch(() => { /* handled in fn */ });
    });
  });
}

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

    // Save on blur
    input.addEventListener('blur', saveAlt);

    // Save on Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });
}

function initDropzone(): void {
  const dropzone = document.getElementById('cms-media-dropzone');
  const fileInput = document.getElementById('cms-media-file-input') as HTMLInputElement | null;
  const uploadBtn = document.getElementById('cms-media-upload-btn');

  if (!dropzone || !fileInput) return;

  // Button fallback — opens OS file picker
  uploadBtn?.addEventListener('click', () => {
    fileInput.click();
  });

  // File input change handler
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      uploadFile(file).catch(() => { /* handled in fn */ });
    });
    fileInput.value = '';
  });

  // Drag & drop events
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

export function initMediaPage(): void {
  initDropzone();
  bindDeleteButtons();
  // Replace the SSR-rendered grid with a client-rendered grid on load so that
  // alt inputs and delete handlers are always bound, even when the page loads
  // with existing images already in the SSR markup.
  fetchMediaList()
    .then((uploads) => renderGrid(uploads))
    .catch(() => { /* fetchMediaList already returns [] on error */ });
}
