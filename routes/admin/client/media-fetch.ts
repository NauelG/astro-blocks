/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-fetch.ts — Shared fetch utility for media list + formatters.
 *
 * Centralizes query-string building, auth header, and envelope parsing for
 * both the admin grid (media.ts) and the image-picker (block-form.ts).
 */

import { getCmsToken } from './common.js';

export interface MediaListEnvelope {
  uploads: MediaEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface MediaEntry {
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

/**
 * Fetch a paginated, optionally filtered list of media entries.
 *
 * Only supplied (non-undefined, non-empty) params are added to the query string.
 * Auth header is always included. Returns a safe default envelope on any error.
 */
export async function fetchMedia(params?: { q?: string; page?: number; limit?: number }): Promise<MediaListEnvelope> {
  const safeDefault: MediaListEnvelope = { uploads: [], total: 0, page: 1, limit: 24 };

  try {
    const qs = new URLSearchParams();
    if (params?.q !== undefined && params.q !== '') qs.set('q', params.q);
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));

    const queryString = qs.toString();
    const url = `/cms/api/media${queryString ? `?${queryString}` : ''}`;

    const token = getCmsToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return safeDefault;

    const body = await res.json() as Partial<MediaListEnvelope>;
    return {
      uploads: Array.isArray(body.uploads) ? body.uploads : [],
      total: typeof body.total === 'number' ? body.total : 0,
      page: typeof body.page === 'number' ? body.page : 1,
      limit: typeof body.limit === 'number' ? body.limit : 24,
    };
  } catch {
    return safeDefault;
  }
}

// ─── Shared metadata formatters ───────────────────────────────────────────────

/**
 * Format a byte count as a human-readable string (B, KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format image dimensions as "w×h", or "—" when either dimension is absent or
 * not strictly positive. Mirrors the SSR copy in routes/admin/media.astro so the
 * server first-paint and the client re-render of the SAME card never disagree
 * (a stored 0 must render "—" in both paths).
 */
export function formatDimensions(w?: number, h?: number): string {
  if (w !== undefined && h !== undefined && w > 0 && h > 0) return `${w}×${h}`;
  return '—';
}

/**
 * Format an ISO date string as a locale date string. Mirrors the SSR copy in
 * routes/admin/media.astro: explicit 'en-US' + { year, month: 'short', day } so
 * SSR and client produce byte-identical output for the same entry.
 */
export function formatMediaDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
