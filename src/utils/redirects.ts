/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { RedirectRule, RedirectStatusCode } from '../types/index.js';
import { normalizePathname } from './slug.js';

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

type RedirectPathField = 'from' | 'to';

/** Catalog key for the field label — used as the {field} interpolation param. */
function fieldLabelKey(field: RedirectPathField): string {
  return field === 'from' ? 'redirects.labelFrom' : 'redirects.labelTo';
}

export interface RedirectPathError {
  errorKey: string;
  fieldKey: string;
}

export function normalizeRedirectStatusCode(value: unknown): RedirectStatusCode {
  return value === 302 ? 302 : 301;
}

export function normalizeRedirectPath(pathname: string): string {
  return normalizePathname(pathname);
}

export function validateRedirectPathInput(
  value: unknown,
  field: RedirectPathField,
): RedirectPathError | null {
  const path = typeof value === 'string' ? value.trim() : '';
  const fieldKey = fieldLabelKey(field);

  if (!path) return { errorKey: 'redirects.pathRequired', fieldKey };
  // Backslashes and protocol-relative prefixes are off-origin in disguise: browsers
  // normalize "\" to "/", so "/\evil.com" and "//evil.com" both resolve to
  // https://evil.com. Redirect targets are internal-only — reject, never rewrite.
  if (ABSOLUTE_URL_REGEX.test(path) || path.includes('\\') || path.startsWith('//'))
    return { errorKey: 'redirects.pathMustBeInternal', fieldKey };
  if (!path.startsWith('/')) return { errorKey: 'redirects.pathMustStartSlash', fieldKey };
  if (path.includes('?') || path.includes('#'))
    return { errorKey: 'redirects.pathNoQueryFragment', fieldKey };

  return null;
}

export function hasDuplicateRedirectFrom(
  redirects: RedirectRule[],
  fromPath: string,
  excludeId?: string,
): boolean {
  return redirects.some((entry) => entry.from === fromPath && entry.id !== excludeId);
}

export function findRedirectByPath(
  redirects: RedirectRule[],
  pathname: string,
): RedirectRule | null {
  const targetPath = normalizeRedirectPath(pathname);
  return redirects.find((entry) => entry.enabled !== false && entry.from === targetPath) || null;
}
