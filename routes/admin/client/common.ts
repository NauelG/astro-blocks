/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

type CmsUser = { id: string; email: string; role: string } | null;

type CmsWindow = Window & typeof globalThis & {
  getCmsToken?: () => string;
  getCmsUser?: () => CmsUser;
  cmsAlert?: (options: { title?: string; message: string }) => Promise<unknown> | unknown;
  cmsConfirm?: (options: { message: string; confirmLabel?: string }) => Promise<boolean>;
  cmsToast?: (options: { title?: string; message: string; tone?: 'success' | 'error' | 'info' }) => void;
};

export function getCmsWindow(): CmsWindow {
  return window as CmsWindow;
}

export function getCmsToken(): string {
  try {
    return getCmsWindow().getCmsToken?.() || '';
  } catch {
    return '';
  }
}

export function authHeaders(contentType = true): HeadersInit {
  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${getCmsToken()}`,
  };
}

export async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await parseJsonResponse<T & { error?: string }>(response);
  if (!response.ok) {
    throw new Error((data && typeof data === 'object' && 'error' in data && data.error) || 'Request failed');
  }
  return data as T;
}

export async function fetchOk(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) return response;

  const data = await parseJsonResponse<{ error?: string }>(response);
  throw new Error((data && data.error) || 'Request failed');
}

export async function showAlert(message: string, title = 'Error'): Promise<void> {
  const api = getCmsWindow().cmsAlert;
  if (api) {
    await api({ title, message });
    return;
  }

  alert(message);
}

export async function showConfirm(message: string, confirmLabel = 'Confirmar'): Promise<boolean> {
  const api = getCmsWindow().cmsConfirm;
  if (api) return api({ message, confirmLabel });
  return confirm(message);
}

export function showToast(message: string, tone: 'success' | 'error' | 'info' = 'info', title?: string): void {
  const api = getCmsWindow().cmsToast;
  if (api) {
    api({ title, message, tone });
    return;
  }
  console.info(message);
}

export function openDialog(dialog: HTMLDialogElement | null): void {
  dialog?.showModal();
}

export function closeDialog(dialog: HTMLDialogElement | null): void {
  dialog?.close();
}

export function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

export function formatDisplayDate(value?: string | null): string {
  if (!value) return 'Sin fecha';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}
