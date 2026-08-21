/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Client module for the Import / Export admin page.
 *
 * Export flow:
 *   1. Collect checked units from the export fieldset.
 *   2. Build GET /cms/api/export?units=… with Authorization header.
 *   3. Receive the response as a Blob and trigger an <a download> click.
 *      (Auth header auth rules out a bare anchor navigation; fetch+blob is required.)
 *
 * Import flow:
 *   1. Read the selected .zip file.
 *   2. Parse manifest.json from the archive (client-side, using fflate via dynamic import
 *      or a lightweight manual read) to show unit counts to the user.
 *   3. Show the manifest preview panel.
 *   4. On "Import" click, open the ConfirmDialog (window.cmsConfirm).
 *   5. POST the raw file body with Content-Type: application/zip + Authorization header.
 *   6. If response has usersReplaced === true → session close (ADR-7).
 *
 * Aria-live status announcements are made via the #ie-status region.
 * Client-side strings resolve through ct(), against the same UI locale that the
 * layout resolved for SSR.
 */

import { getCmsToken, showToast } from './common.js';
import { ct } from '../i18n/client.js';

type CmsWindow = Window &
  typeof globalThis & {
    cmsConfirm?: (opts: {
      message: string;
      title?: string;
      confirmLabel?: string;
    }) => Promise<boolean>;
    cmsToast?: (opts: {
      title?: string;
      message: string;
      tone?: 'success' | 'error' | 'info';
    }) => void;
  };

// ─── Status region ────────────────────────────────────────────────────────────

function setStatus(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;
}

function clearStatus(el: HTMLElement | null): void {
  if (!el) return;
  el.textContent = '';
}

// ─── Export ───────────────────────────────────────────────────────────────────

function getCheckedUnits(fieldset: HTMLFieldSetElement | null): string[] {
  if (!fieldset) return [];
  return Array.from(
    fieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
  ).map((cb) => cb.value);
}

async function handleExport(
  exportFieldset: HTMLFieldSetElement | null,
  exportBtn: HTMLButtonElement | null,
  statusEl: HTMLElement | null,
): Promise<void> {
  const units = getCheckedUnits(exportFieldset);
  if (units.length === 0) {
    setStatus(statusEl, ct('importExport.noUnitsSelected'));
    return;
  }

  if (exportBtn) exportBtn.disabled = true;
  setStatus(statusEl, ct('importExport.status.exporting'));

  try {
    const token = getCmsToken();
    const url = '/cms/api/export?units=' + encodeURIComponent(units.join(','));
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: String(res.status) }));
      const detail = (errData as { error?: string }).error || String(res.status);
      setStatus(statusEl, ct('importExport.status.error', { detail }));
      return;
    }

    // Extract filename from Content-Disposition header if available.
    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = /filename="?([^";]+)"?/.exec(disposition);
    const filename = filenameMatch ? filenameMatch[1] : 'astro-blocks-export.zip';

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke after a short delay to let the browser initiate the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

    setStatus(statusEl, ct('importExport.status.done'));
    showToast(ct('importExport.status.done'), 'success', ct('importExport.download'));
  } catch (_err) {
    setStatus(statusEl, ct('importExport.exportNetworkError'));
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}

// ─── Manifest preview ─────────────────────────────────────────────────────────

interface BackupManifest {
  schemaVersion: number;
  astroBlocksVersion?: string;
  exportedAt?: string;
  units: string[];
  counts?: Partial<Record<string, number>>;
}

async function parseManifestFromZip(file: File): Promise<BackupManifest | null> {
  // Read the zip file as an ArrayBuffer and extract manifest.json.
  // We use the fflate library (bundled with the integration) via dynamic import
  // to parse the zip without a server round-trip.
  try {
    const { unzipSync, strFromU8 } = await import('fflate');
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const files = unzipSync(uint8, { filter: (f) => f.name === 'manifest.json' });
    const manifestBytes = files['manifest.json'];
    if (!manifestBytes) return null;
    return JSON.parse(strFromU8(manifestBytes)) as BackupManifest;
  } catch {
    return null;
  }
}

function renderManifestPreview(
  manifest: BackupManifest | null,
  previewEl: HTMLElement | null,
  importUnitFieldset: HTMLFieldSetElement | null,
): void {
  if (!previewEl) return;

  if (!manifest) {
    previewEl.hidden = true;
    return;
  }

  // Render summary.
  const versionText = ct('importExport.manifestVersion', {
    version: manifest.schemaVersion,
  });
  const dateText = manifest.exportedAt
    ? ct('importExport.manifestExportedAt', {
        date: new Date(manifest.exportedAt).toLocaleString(),
      })
    : '';

  // Build the preview using safe DOM methods — manifest content is untrusted.
  previewEl.textContent = '';

  const titleP = document.createElement('p');
  titleP.className = 'cms-settings-section-title';
  titleP.textContent = ct('importExport.manifestTitle');
  previewEl.appendChild(titleP);

  const versionP = document.createElement('p');
  versionP.className = 'cms-muted';
  versionP.textContent = versionText;
  previewEl.appendChild(versionP);

  if (dateText) {
    const dateP = document.createElement('p');
    dateP.className = 'cms-muted';
    dateP.textContent = dateText;
    previewEl.appendChild(dateP);
  }

  const counts = manifest.counts || {};
  const ul = document.createElement('ul');
  for (const unit of manifest.units) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = unit;
    li.appendChild(strong);
    const count = counts[unit];
    if (count !== undefined) {
      const countStr = ct('importExport.manifestCount', { count });
      li.appendChild(document.createTextNode(': ' + countStr));
    }
    ul.appendChild(li);
  }
  previewEl.appendChild(ul);

  previewEl.hidden = false;

  // Sync import unit checkboxes: only enable units present in manifest.
  if (importUnitFieldset) {
    const availableUnits = new Set(manifest.units);
    importUnitFieldset
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((cb) => {
        const available = availableUnits.has(cb.value);
        cb.disabled = !available;
        cb.checked = available;
      });
  }
}

// ─── Session close (ADR-7) ────────────────────────────────────────────────────

function closeSessionAndRedirect(): void {
  try {
    sessionStorage.removeItem('cms-token');
    sessionStorage.removeItem('cms-user');
  } catch (_) {
    // ignore sessionStorage errors
  }
  location.href = '/cms';
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function handleImport(
  importUnitFieldset: HTMLFieldSetElement | null,
  fileInput: HTMLInputElement | null,
  statusEl: HTMLElement | null,
): Promise<void> {
  const file = fileInput?.files?.[0];
  if (!file) {
    setStatus(statusEl, ct('importExport.noFileSelected'));
    return;
  }

  const units = getCheckedUnits(importUnitFieldset);
  if (units.length === 0) {
    setStatus(statusEl, ct('importExport.noUnitsSelected'));
    return;
  }

  const hasUsers = units.includes('users');

  // Build confirm message — concatenate replace warning and optional session warning.
  let confirmMsg =
    ct('importExport.confirmReplace') + '\n\n' + ct('importExport.confirmReplaceWarning');
  if (hasUsers) {
    confirmMsg += '\n\n' + ct('importExport.usersSessionWarning');
  }

  const cmsConfirm = (window as CmsWindow).cmsConfirm;
  if (!cmsConfirm) {
    const msg = ct('importExport.confirmUnavailable');
    setStatus(statusEl, msg);
    showToast(msg, 'error');
    return;
  }

  const confirmed = await cmsConfirm({
    message: confirmMsg,
    title: ct('importExport.confirmTitle'),
    confirmLabel: ct('importExport.confirmBtn'),
  });

  if (!confirmed) return;

  setStatus(statusEl, ct('importExport.status.uploading'));

  try {
    const token = getCmsToken();
    const res = await fetch('/cms/api/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        Authorization: 'Bearer ' + token,
      },
      body: file,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: String(res.status) }));
      const detail = (errData as { error?: string }).error || String(res.status);
      setStatus(statusEl, ct('importExport.status.error', { detail }));
      return;
    }

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      usersReplaced?: boolean;
    };

    setStatus(statusEl, ct('importExport.status.done'));
    showToast(ct('importExport.status.done'), 'success', ct('importExport.upload'));

    // ADR-7: if users were replaced, the current session is invalid.
    // Clear sessionStorage and redirect to login immediately.
    if (data.usersReplaced) {
      closeSessionAndRedirect();
    }
  } catch (_err) {
    setStatus(statusEl, ct('importExport.importNetworkError'));
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initImportExportEditor(): void {
  const statusEl = document.getElementById('ie-status') as HTMLElement | null;
  const exportFieldset = document.getElementById('ie-export-units') as HTMLFieldSetElement | null;
  const exportBtn = document.getElementById('ie-export-btn') as HTMLButtonElement | null;
  const fileInput = document.getElementById('ie-import-file') as HTMLInputElement | null;
  const fileSelectBtn = document.getElementById('ie-import-file-btn') as HTMLButtonElement | null;
  const fileNameDisplay = document.getElementById('ie-import-file-name') as HTMLElement | null;
  const importUnitFieldset = document.getElementById(
    'ie-import-units',
  ) as HTMLFieldSetElement | null;
  const importBtn = document.getElementById('ie-import-btn') as HTMLButtonElement | null;
  const manifestPreview = document.getElementById('ie-manifest-preview') as HTMLElement | null;

  // Set initial idle status.
  setStatus(statusEl, ct('importExport.status.idle'));

  // Wire styled file select button — opens the hidden native input.
  fileSelectBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  // Wire export button.
  exportBtn?.addEventListener('click', () => {
    clearStatus(statusEl);
    void handleExport(exportFieldset, exportBtn, statusEl);
  });

  // Wire file picker — update filename display, parse manifest and show preview.
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];

    // Update the filename display.
    if (fileNameDisplay) {
      fileNameDisplay.textContent = file ? file.name : '';
    }

    if (!file) {
      if (manifestPreview) manifestPreview.hidden = true;
      return;
    }
    setStatus(statusEl, ct('importExport.status.validating'));
    const manifest = await parseManifestFromZip(file);
    renderManifestPreview(manifest, manifestPreview, importUnitFieldset);
    clearStatus(statusEl);
    setStatus(statusEl, ct('importExport.status.idle'));
  });

  // Wire import button.
  importBtn?.addEventListener('click', () => {
    clearStatus(statusEl);
    void handleImport(importUnitFieldset, fileInput, statusEl);
  });
}
