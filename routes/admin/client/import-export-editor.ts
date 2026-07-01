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
 * All strings come from the i18n bridge object (window.__cmsImportExportI18n).
 */

import { getCmsToken, showToast } from './common.js';

type ImportExportI18n = {
  statusIdle: string;
  statusExporting: string;
  statusUploading: string;
  statusValidating: string;
  statusImporting: string;
  statusDone: string;
  statusError: string;
  noUnitsSelected: string;
  noFileSelected: string;
  importNetworkError: string;
  exportNetworkError: string;
  confirmReplace: string;
  confirmReplaceWarning: string;
  usersSessionWarning: string;
  confirmTitle: string;
  confirmBtn: string;
  confirmUnavailable: string;
  download: string;
  upload: string;
  manifestTitle: string;
  manifestVersion: string;
  manifestExportedAt: string;
  manifestCount: string;
};

type CmsWindow = Window &
  typeof globalThis & {
    __cmsImportExportI18n?: ImportExportI18n;
    cmsConfirm?: (opts: { message: string; title?: string; confirmLabel?: string }) => Promise<boolean>;
    cmsToast?: (opts: { title?: string; message: string; tone?: 'success' | 'error' | 'info' }) => void;
  };

function getI18n(): ImportExportI18n {
  return (window as CmsWindow).__cmsImportExportI18n || ({} as ImportExportI18n);
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

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
  return Array.from(fieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(
    (cb) => cb.value,
  );
}

async function handleExport(
  exportFieldset: HTMLFieldSetElement | null,
  exportBtn: HTMLButtonElement | null,
  statusEl: HTMLElement | null,
): Promise<void> {
  const i18n = getI18n();
  const units = getCheckedUnits(exportFieldset);
  if (units.length === 0) {
    setStatus(statusEl, i18n.noUnitsSelected || 'Select at least one unit.');
    return;
  }

  if (exportBtn) exportBtn.disabled = true;
  setStatus(statusEl, i18n.statusExporting || 'Preparing export…');

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
      setStatus(
        statusEl,
        interpolate(i18n.statusError || 'Error: {detail}', { detail }),
      );
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

    setStatus(statusEl, i18n.statusDone || 'Done.');
    showToast(i18n.statusDone || 'Done.', 'success', i18n.download || 'Download backup');
  } catch (_err) {
    setStatus(statusEl, i18n.exportNetworkError || 'Export failed. Please try again.');
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
  const i18n = getI18n();

  if (!previewEl) return;

  if (!manifest) {
    previewEl.hidden = true;
    return;
  }

  // Render summary.
  const versionText = interpolate(i18n.manifestVersion || 'Schema version: {version}', {
    version: manifest.schemaVersion,
  });
  const dateText = manifest.exportedAt
    ? interpolate(i18n.manifestExportedAt || 'Exported: {date}', {
        date: new Date(manifest.exportedAt).toLocaleString(),
      })
    : '';

  // Build the preview using safe DOM methods — manifest content is untrusted.
  previewEl.textContent = '';

  const titleP = document.createElement('p');
  titleP.className = 'cms-settings-section-title';
  titleP.textContent = i18n.manifestTitle || 'Backup contents';
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
      const countStr = interpolate(i18n.manifestCount || '{count} item(s)', { count });
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
  const i18n = getI18n();

  const file = fileInput?.files?.[0];
  if (!file) {
    setStatus(statusEl, i18n.noFileSelected || 'Select a .zip backup file first.');
    return;
  }

  const units = getCheckedUnits(importUnitFieldset);
  if (units.length === 0) {
    setStatus(statusEl, i18n.noUnitsSelected || 'Select at least one unit.');
    return;
  }

  const hasUsers = units.includes('users');

  // Build confirm message — concatenate replace warning and optional session warning.
  let confirmMsg = (i18n.confirmReplace || 'Replace all selected data with the imported backup?') +
    '\n\n' +
    (i18n.confirmReplaceWarning || 'This action replaces existing content permanently. A backup snapshot will be created before proceeding.');
  if (hasUsers) {
    confirmMsg += '\n\n' + (i18n.usersSessionWarning || 'Importing the Users unit will replace all user accounts. Your current session will end immediately after the import completes.');
  }

  const cmsConfirm = (window as CmsWindow).cmsConfirm;
  if (!cmsConfirm) {
    const msg = i18n.confirmUnavailable || 'Confirm dialog is not available. Please reload the page.';
    setStatus(statusEl, msg);
    showToast(msg, 'error');
    return;
  }

  const confirmed = await cmsConfirm({
    message: confirmMsg,
    title: i18n.confirmTitle || 'Confirm data replacement',
    confirmLabel: i18n.confirmBtn || 'Replace data',
  });

  if (!confirmed) return;

  setStatus(statusEl, i18n.statusUploading || 'Uploading…');

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
      setStatus(
        statusEl,
        interpolate(i18n.statusError || 'Error: {detail}', { detail }),
      );
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { success?: boolean; usersReplaced?: boolean };

    setStatus(statusEl, i18n.statusDone || 'Done.');
    showToast(i18n.statusDone || 'Done.', 'success', i18n.upload || 'Import backup');

    // ADR-7: if users were replaced, the current session is invalid.
    // Clear sessionStorage and redirect to login immediately.
    if (data.usersReplaced) {
      closeSessionAndRedirect();
    }
  } catch (_err) {
    setStatus(statusEl, i18n.importNetworkError || 'Network error. Please try again.');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initImportExportEditor(): void {
  const statusEl = document.getElementById('ie-status') as HTMLElement | null;
  const exportFieldset = document.getElementById('ie-export-units') as HTMLFieldSetElement | null;
  const exportBtn = document.getElementById('ie-export-btn') as HTMLButtonElement | null;
  const fileInput = document.getElementById('ie-import-file') as HTMLInputElement | null;
  const importUnitFieldset = document.getElementById('ie-import-units') as HTMLFieldSetElement | null;
  const importBtn = document.getElementById('ie-import-btn') as HTMLButtonElement | null;
  const manifestPreview = document.getElementById('ie-manifest-preview') as HTMLElement | null;

  // Set initial idle status.
  const i18n = getI18n();
  setStatus(statusEl, i18n.statusIdle || 'Ready.');

  // Wire export button.
  exportBtn?.addEventListener('click', () => {
    clearStatus(statusEl);
    void handleExport(exportFieldset, exportBtn, statusEl);
  });

  // Wire file picker — parse manifest and show preview.
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      if (manifestPreview) manifestPreview.hidden = true;
      return;
    }
    setStatus(statusEl, i18n.statusValidating || 'Validating…');
    const manifest = await parseManifestFromZip(file);
    renderManifestPreview(manifest, manifestPreview, importUnitFieldset);
    clearStatus(statusEl);
    setStatus(statusEl, i18n.statusIdle || 'Ready.');
  });

  // Wire import button.
  importBtn?.addEventListener('click', () => {
    clearStatus(statusEl);
    void handleImport(importUnitFieldset, fileInput, statusEl);
  });
}
