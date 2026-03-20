/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { RedirectRule, RedirectStatusCode } from '../types/index.js';
import { normalizePathname } from './slug.js';

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

type RedirectPathField = 'from' | 'to';

function fieldLabel(field: RedirectPathField): string {
  return field === 'from' ? 'origen' : 'destino';
}

export function normalizeRedirectStatusCode(value: unknown): RedirectStatusCode {
  return value === 302 ? 302 : 301;
}

export function normalizeRedirectPath(pathname: string): string {
  return normalizePathname(pathname);
}

export function validateRedirectPathInput(value: unknown, field: RedirectPathField): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  const label = fieldLabel(field);

  if (!path) return `La ruta de ${label} es obligatoria.`;
  if (ABSOLUTE_URL_REGEX.test(path)) return `La ruta de ${label} debe ser interna (no se permiten URLs absolutas).`;
  if (!path.startsWith('/')) return `La ruta de ${label} debe comenzar con "/".`;
  if (path.includes('?') || path.includes('#')) return `La ruta de ${label} no puede incluir query ni fragmento.`;

  return null;
}

export function hasDuplicateRedirectFrom(
  redirects: RedirectRule[],
  fromPath: string,
  excludeId?: string
): boolean {
  return redirects.some((entry) => entry.from === fromPath && entry.id !== excludeId);
}

export function findRedirectByPath(
  redirects: RedirectRule[],
  pathname: string
): RedirectRule | null {
  const targetPath = normalizeRedirectPath(pathname);
  return redirects.find((entry) => entry.enabled !== false && entry.from === targetPath) || null;
}
