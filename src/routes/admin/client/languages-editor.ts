/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Client module for the Languages admin page.
 *
 * Migrated out of languages.astro's inline `define:vars` script (issue #99): an
 * is:inline script cannot reach the canonical escaper, so its row rendering built
 * innerHTML from unescaped API data (stored XSS). Here, every API-sourced value
 * passes escapeHtml (text) / escapeAttr (attribute) at the sink.
 *
 * Client-side strings resolve through ct(), against the same UI locale that the
 * layout resolved for SSR.
 */

import { getCmsWindow, getCmsToken } from './common.js';
import { escapeAttr, escapeHtml } from '../../../utils/html-escape.js';
import { ct } from '../i18n/client.js';

type ContentLanguage = {
  code: string;
  label?: string;
  enabled?: boolean;
  isDefault?: boolean;
};

type CmsUser = { id: string; email: string; role: string } | null;

const PENCIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function getCmsUser(): CmsUser {
  const win = getCmsWindow() as unknown as { getCmsUser?: () => CmsUser };
  if (win.getCmsUser) return win.getCmsUser();
  try {
    const raw = sessionStorage.getItem('cms-user');
    return raw ? (JSON.parse(raw) as CmsUser) : null;
  } catch {
    return null;
  }
}

export function initLanguagesEditor(): void {
  const token = getCmsToken();
  if (!token) {
    window.location.href = '/cms';
    return;
  }

  const initWithUser = (user: CmsUser): void => {
    if (user && user.role !== 'owner') {
      window.location.href = '/cms';
      return;
    }
    if (user && user.role === 'owner' && !getCmsUser()) {
      try {
        sessionStorage.setItem('cms-user', JSON.stringify(user));
      } catch {
        // ignore storage issues
      }
    }
    initPage(token);
  };

  const existing = getCmsUser();
  if (existing) {
    initWithUser(existing);
    return;
  }
  fetch('/cms/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => initWithUser(data ? data.user : null))
    .catch(() => initWithUser(null));
}

function initPage(token: string): void {
  const win = getCmsWindow();

  const tbody = document.getElementById('cms-languages-tbody');
  const empty = document.getElementById('cms-languages-empty');
  const dialog = document.getElementById('language-detail-modal') as HTMLDialogElement | null;
  const form = document.getElementById('language-detail-form') as HTMLFormElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const submitBtn = document.getElementById('language-detail-submit');
  const modeInput = document.getElementById('language-detail-mode') as HTMLInputElement | null;
  const currentCodeInput = document.getElementById(
    'language-detail-current-code',
  ) as HTMLInputElement | null;
  const codeInput = document.getElementById('language-detail-code') as HTMLInputElement | null;
  const labelInput = document.getElementById('language-detail-label') as HTMLInputElement | null;
  const enabledInput = document.getElementById(
    'language-detail-enabled',
  ) as HTMLInputElement | null;
  const defaultInput = document.getElementById(
    'language-detail-default',
  ) as HTMLInputElement | null;

  if (
    !tbody ||
    !dialog ||
    !form ||
    !codeInput ||
    !labelInput ||
    !enabledInput ||
    !defaultInput ||
    !modeInput ||
    !currentCodeInput
  ) {
    return;
  }

  const tbodyEl = tbody;
  let languagesState: ContentLanguage[] = [];

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const notifyLanguagesUpdated = (): void => {
    window.dispatchEvent(new CustomEvent('cms:languages-updated'));
  };

  const setModalTitle = (label: string, submit: string): void => {
    if (titleEl) titleEl.textContent = label;
    if (submitBtn) submitBtn.textContent = submit;
  };

  const openModal = (): void => dialog.showModal();
  const closeModal = (): void => dialog.close();

  const resetForm = (): void => {
    modeInput.value = 'create';
    currentCodeInput.value = '';
    codeInput.value = '';
    codeInput.disabled = false;
    labelInput.value = '';
    enabledInput.checked = true;
    defaultInput.checked = false;
    setModalTitle(ct('languages.newForm'), ct('languages.createBtn'));
  };

  const openNew = (): void => {
    resetForm();
    openModal();
  };

  const openEdit = (code: string): void => {
    const language = languagesState.find((entry) => entry.code === code);
    if (!language) return;
    modeInput.value = 'edit';
    currentCodeInput.value = language.code;
    codeInput.value = language.code;
    codeInput.disabled = true;
    labelInput.value = language.label || language.code;
    enabledInput.checked = language.enabled !== false;
    defaultInput.checked = language.isDefault === true;
    setModalTitle(ct('languages.editForm'), ct('common.save'));
    openModal();
  };

  function renderRows(): void {
    tbodyEl.innerHTML = languagesState
      .map((language) => {
        const active = language.enabled !== false;
        const code = escapeHtml(language.code);
        const codeAttr = escapeAttr(language.code);
        const label = escapeHtml(language.label || language.code);
        return (
          '<tr>' +
          `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-language-edit" data-code="${codeAttr}" aria-label="${escapeAttr(ct('common.edit'))}">${PENCIL_SVG}</button></td>` +
          `<td class="cms-table-cell-monospace">${code}</td>` +
          `<td>${label}</td>` +
          `<td><span class="cms-badge ${active ? 'cms-badge-success' : 'cms-badge-neutral'}">${escapeHtml(active ? ct('languages.statusActive') : ct('languages.statusDisabled'))}</span></td>` +
          `<td>${language.isDefault ? escapeHtml(ct('languages.isDefaultYes')) : '—'}</td>` +
          `<td class="cms-table-actions-delete"><button type="button" class="cms-table-btn-delete cms-language-delete" data-code="${codeAttr}" aria-label="${escapeAttr(ct('languages.deleteLabel'))}">${TRASH_SVG}</button></td>` +
          '</tr>'
        );
      })
      .join('');

    if (empty) empty.classList.toggle('cms-hidden', languagesState.length > 0);

    tbodyEl.querySelectorAll('.cms-language-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        if (code) openEdit(code);
      });
    });

    tbodyEl.querySelectorAll('.cms-language-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        if (code) void deleteLanguage(code);
      });
    });
  }

  const refreshLanguages = (): Promise<void> =>
    fetch('/cms/api/languages', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(ct('languages.loadError'));
        return r.json();
      })
      .then((payload) => {
        languagesState = payload.languages || [];
        renderRows();
      })
      .catch((err) => {
        win.cmsAlert?.({
          title: ct('languages.modalTitle'),
          message: err.message || ct('languages.loadError'),
        });
      });

  const getCascadeCounts = async (code: string): Promise<{ pages: number; menus: number }> => {
    const pagesRes = await fetch(`/cms/api/pages?locale=${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const menusRes = await fetch(`/cms/api/menus?locale=${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pagesData = pagesRes.ok ? await pagesRes.json() : { pages: [] };
    const menusData = menusRes.ok ? await menusRes.json() : { menus: [] };
    return {
      pages: Array.isArray(pagesData.pages) ? pagesData.pages.length : 0,
      menus: Array.isArray(menusData.menus) ? menusData.menus.length : 0,
    };
  };

  async function deleteLanguage(code: string): Promise<void> {
    try {
      const counts = await getCascadeCounts(code);
      const message = ct('languages.deleteConfirm', {
        code,
        pages: counts.pages,
        menus: counts.menus,
      });
      const ok = await win.cmsConfirm?.({ message, confirmLabel: ct('languages.deleteLabel') });
      if (!ok) return;

      const response = await fetch(`/cms/api/languages/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || ct('languages.deleteError'));
      }

      win.cmsToast?.({
        title: ct('languages.modalTitle'),
        message: ct('languages.deleted'),
        tone: 'success',
      });
      await refreshLanguages();
      notifyLanguagesUpdated();
    } catch (err) {
      win.cmsAlert?.({
        title: ct('languages.modalTitle'),
        message: (err instanceof Error && err.message) || ct('languages.deleteError'),
      });
    }
  }

  const submitForm = async (): Promise<void> => {
    const mode = modeInput.value;
    const code = codeInput.value.trim().toLowerCase();
    const label = labelInput.value.trim();
    const enabled = enabledInput.checked;
    const isDefault = defaultInput.checked;

    if (!code) {
      await win.cmsAlert?.({
        title: ct('languages.validationTitle'),
        message: ct('languages.codeObligatory'),
      });
      return;
    }

    const payload = {
      ...(mode === 'create' ? { code } : {}),
      label: label || code,
      enabled,
      isDefault,
    };

    const endpoint =
      mode === 'create'
        ? '/cms/api/languages'
        : `/cms/api/languages/${encodeURIComponent(currentCodeInput.value)}`;
    const method = mode === 'create' ? 'POST' : 'PUT';

    const response = await fetch(endpoint, {
      method,
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || ct('languages.saveError'));
    }

    closeModal();
    await refreshLanguages();
    notifyLanguagesUpdated();
    win.cmsToast?.({
      title: ct('languages.modalTitle'),
      message: mode === 'create' ? ct('languages.created') : ct('languages.updated'),
      tone: 'success',
    });
  };

  document.getElementById('cms-language-new-btn')?.addEventListener('click', openNew);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitForm().catch((err) => {
      win.cmsAlert?.({
        title: ct('languages.modalTitle'),
        message: err.message || ct('languages.saveError'),
      });
    });
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target === dialog ||
      target?.getAttribute?.('data-close-modal') === 'language-detail-modal'
    ) {
      closeModal();
    }
  });
  dialog.addEventListener('cancel', () => closeModal());

  void refreshLanguages();
}
