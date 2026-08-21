/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Client module for the Users admin page.
 *
 * Migrated out of users.astro's inline `define:vars` script (issue #99): an is:inline
 * script cannot reach the canonical escaper, so its row rendering built innerHTML from
 * unescaped API data (stored XSS via u.email / u.id). Here, every API-sourced value
 * passes escapeHtml (text) / escapeAttr (attribute) at the sink.
 *
 * Client-side strings resolve through ct(), against the same UI locale that the
 * layout resolved for SSR.
 */

import { getCmsWindow, getCmsToken } from './common.js';
import { escapeAttr, escapeHtml } from '../../../utils/html-escape.js';
import { ct } from '../i18n/client.js';

type AdminUser = { id: string; email?: string; role?: string; createdAt?: string };
type CmsUser = { id: string; email: string; role: string } | null;

const PENCIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function getCmsUser(): CmsUser {
  const win = getCmsWindow() as unknown as { getCmsUser?: () => CmsUser };
  return win.getCmsUser ? win.getCmsUser() : null;
}

export function initUsersEditor(): void {
  const token = getCmsToken();
  if (!token) {
    window.location.href = '/cms';
    return;
  }

  const initWithUser = (user: CmsUser): void => {
    if (user?.role !== 'owner') {
      window.location.href = '/cms';
      return;
    }
    if (getCmsUser() === null) {
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
  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const loadingEl = document.getElementById('cms-users-loading');
  const listWrap = document.getElementById('cms-users-list-wrap');
  const tbody = document.getElementById('cms-users-tbody');
  const errorEl = document.getElementById('cms-users-error');
  const countEl = document.getElementById('cms-users-count');
  const emptyEl = document.getElementById('cms-users-empty');
  const searchInput = document.getElementById('cms-users-search') as HTMLInputElement | null;
  const roleFilter = document.getElementById('cms-users-role-filter') as HTMLSelectElement | null;
  const dialog = document.getElementById('user-detail-modal') as HTMLDialogElement | null;
  const form = document.getElementById('user-detail-form') as HTMLFormElement | null;
  const titleEl = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const idInput = document.getElementById('user-detail-id') as HTMLInputElement | null;
  const emailInput = document.getElementById('user-detail-email') as HTMLInputElement | null;
  const passwordWrap = document.getElementById('user-detail-password-wrap');
  const passwordInput = document.getElementById('user-detail-password') as HTMLInputElement | null;
  const roleSelect = document.getElementById('user-detail-role') as HTMLSelectElement | null;
  const submitBtn = document.getElementById('user-detail-submit');

  let usersState: AdminUser[] = [];

  const setError = (msg?: string): void => {
    if (errorEl) {
      errorEl.textContent = msg || '';
      errorEl.classList.toggle('cms-hidden', !msg);
    }
  };

  const formatDate = (iso?: string): string => {
    if (!iso) return ct('common.noDate');
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const closeModal = (): void => dialog?.close();
  const openModal = (): void => dialog?.showModal();

  const setFormTitle = (label: string, submitLabel: string): void => {
    if (titleEl) titleEl.textContent = label;
    if (submitBtn) submitBtn.textContent = submitLabel;
  };

  const getFilteredUsers = (): AdminUser[] => {
    const query = searchInput?.value ? searchInput.value.trim().toLowerCase() : '';
    const role = roleFilter?.value ? roleFilter.value : 'all';
    return usersState.filter((entry) => {
      const matchesQuery = !query || (entry.email || '').toLowerCase().indexOf(query) !== -1;
      const matchesRole = role === 'all' || entry.role === role;
      return matchesQuery && matchesRole;
    });
  };

  const updateMeta = (list: AdminUser[]): void => {
    if (countEl) countEl.textContent = ct('users.count', { count: list.length });
    if (emptyEl) emptyEl.classList.toggle('cms-hidden', list.length > 0);
  };

  const openNew = (): void => {
    if (idInput) idInput.value = '';
    if (emailInput) {
      emailInput.value = '';
      emailInput.disabled = false;
    }
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.required = true;
    }
    if (passwordWrap) passwordWrap.style.display = '';
    if (roleSelect) roleSelect.value = 'user';
    setFormTitle(ct('users.newForm'), ct('users.createBtn'));
    openModal();
  };

  const openEdit = (u: AdminUser): void => {
    if (!u) return;
    if (idInput) idInput.value = u.id;
    if (emailInput) {
      emailInput.value = u.email || '';
      emailInput.disabled = true;
    }
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.required = false;
    }
    if (passwordWrap) passwordWrap.style.display = '';
    if (roleSelect) roleSelect.value = u.role || 'user';
    setFormTitle(ct('users.editForm'), ct('common.save'));
    openModal();
  };

  function renderUsers(): void {
    const list = getFilteredUsers();
    const ownerCount = usersState.filter((entry) => entry.role === 'owner').length;
    if (tbody) tbody.innerHTML = '';
    if (listWrap) listWrap.classList.remove('cms-hidden');
    updateMeta(list);
    list.forEach((u) => {
      if (!tbody) return;
      const tr = document.createElement('tr');
      const canDelete = u.role !== 'owner' || ownerCount > 1;
      const idAttr = escapeAttr(u.id);
      const editLabel = escapeAttr(ct('common.edit'));
      const deleteLabel = escapeAttr(ct('users.deleteLabel'));
      const deleteBtn = canDelete
        ? `<button type="button" class="cms-table-btn-delete cms-user-delete" data-id="${idAttr}" aria-label="${deleteLabel}">${TRASH_SVG}</button>`
        : `<button type="button" class="cms-table-btn-delete cms-user-delete" data-id="${idAttr}" disabled aria-label="${deleteLabel}" title="${escapeAttr(ct('users.cannotDeleteLastOwner'))}">${TRASH_SVG}</button>`;
      tr.innerHTML =
        `<td class="cms-table-actions"><button type="button" class="cms-table-btn-edit cms-user-edit" data-id="${idAttr}" aria-label="${editLabel}">${PENCIL_SVG}</button></td>` +
        `<td>${escapeHtml(u.email || '')}</td>` +
        `<td><span class="cms-badge ${u.role === 'owner' ? 'cms-badge-success' : 'cms-badge-neutral'}">${escapeHtml(u.role === 'owner' ? ct('users.roleOwner') : ct('users.roleUser'))}</span></td>` +
        `<td>${escapeHtml(formatDate(u.createdAt))}</td>` +
        `<td class="cms-table-actions-delete">${deleteBtn}</td>`;
      tbody.appendChild(tr);
      tr.querySelector('.cms-user-edit')?.addEventListener('click', () => openEdit(u));
      const delBtn = tr.querySelector('.cms-user-delete') as HTMLButtonElement | null;
      if (delBtn && !delBtn.disabled) delBtn.addEventListener('click', () => deleteUser(u.id));
    });
  }

  const loadUsers = (): void => {
    setError('');
    if (loadingEl) loadingEl.classList.remove('cms-hidden');
    if (listWrap) listWrap.classList.add('cms-hidden');
    fetch('/cms/api/users', { headers: headers() })
      .then((r) => {
        if (r.status === 403) {
          window.location.href = '/cms';
          return null;
        }
        if (!r.ok) throw new Error(ct('users.loadError'));
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        usersState = data.users || [];
        if (loadingEl) loadingEl.classList.add('cms-hidden');
        renderUsers();
      })
      .catch((err) => {
        if (loadingEl) loadingEl.classList.add('cms-hidden');
        setError(err.message || ct('users.loadError'));
      });
  };

  function deleteUser(id: string): void {
    if (!id) return;
    win
      .cmsConfirm?.({ message: ct('users.deleteConfirm'), confirmLabel: ct('users.deleteLabel') })
      .then((ok) => {
        if (!ok) return;
        setError('');
        fetch(`/cms/api/users/${id}`, { method: 'DELETE', headers: headers() })
          .then((r) => {
            if (r.status === 204) {
              win.cmsToast?.({
                title: ct('users.modalTitle'),
                message: ct('users.deleted'),
                tone: 'success',
              });
              loadUsers();
              return;
            }
            return r.json().then((data) => {
              throw new Error(data.error || ct('users.deleteError'));
            });
          })
          .catch((err) => setError(err.message || ct('users.deleteError')));
      });
  }

  document.getElementById('cms-users-add-btn')?.addEventListener('click', openNew);
  document.querySelector('[data-open-users-new]')?.addEventListener('click', openNew);
  searchInput?.addEventListener('input', renderUsers);
  roleFilter?.addEventListener('change', renderUsers);

  if (dialog) {
    dialog.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.getAttribute?.('data-close-modal') === 'user-detail-modal') closeModal();
      if (target === dialog) closeModal();
    });
    dialog.addEventListener('cancel', closeModal);
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = idInput?.value ? idInput.value.trim() : '';
    const email = emailInput?.value ? emailInput.value.trim() : '';
    const password = passwordInput?.value ? passwordInput.value : '';
    const role = roleSelect?.value ? roleSelect.value : 'user';
    if (!email) {
      setError(ct('users.emailRequired'));
      return;
    }
    if (!id && !password) {
      setError(ct('users.passwordRequiredNew'));
      return;
    }
    setError('');
    if (id) {
      const body: { role: string; password?: string } = { role };
      if (password) body.password = password;
      fetch(`/cms/api/users/${id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
        .then((res) => {
          if (!res.ok) throw new Error(res.data.error || ct('users.saveError'));
          closeModal();
          win.cmsToast?.({
            title: ct('users.modalTitle'),
            message: ct('users.updated'),
            tone: 'success',
          });
          loadUsers();
        })
        .catch((err) => setError(err.message || ct('users.saveError')));
    } else {
      fetch('/cms/api/users', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email, password, role }),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
        .then((res) => {
          if (!res.ok) throw new Error(res.data.error || ct('users.saveError'));
          closeModal();
          win.cmsToast?.({
            title: ct('users.modalTitle'),
            message: ct('users.created'),
            tone: 'success',
          });
          loadUsers();
        })
        .catch((err) => setError(err.message || ct('users.saveError')));
    }
  });

  loadUsers();
}
