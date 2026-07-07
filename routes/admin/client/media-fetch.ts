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
export async function fetchMedia(params?: {
  q?: string;
  page?: number;
  limit?: number;
}): Promise<MediaListEnvelope> {
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

    const body = (await res.json()) as Partial<MediaListEnvelope>;
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

/**
 * Upload a single file to /cms/api/upload.
 *
 * This is the ONLY supported upload protocol: the raw file bytes are sent as the
 * request body, with the file's real MIME as Content-Type and the (percent-encoded)
 * filename in the x-cms-filename header. The server reads the body via
 * request.arrayBuffer() and does NOT parse multipart/form-data (see handleUpload in
 * api/handlers.ts). Sending FormData here yields a multipart/form-data Content-Type,
 * which the server rejects — and, being a form-like Content-Type, it also trips
 * Astro's origin-check middleware behind reverse proxies. Auth is a JWT in the
 * Authorization header, never an ambient cookie, so CSRF is a non-issue.
 *
 * Centralized so every caller (media grid, block picker, SEO image) stays in sync.
 * Returns the raw Response; callers own success/error handling.
 */
export function uploadMedia(file: File): Promise<Response> {
  const token = getCmsToken();
  return fetch('/cms/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-cms-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
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
