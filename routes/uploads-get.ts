/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUploadPath } from '../utils/paths.js';

export const prerender = false;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

/** MIME types that are images — used to determine inline-vs-download policy. */
const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/avif',
]);

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const filePath = resolveUploadPath(url.pathname);
  if (!filePath) return new Response(null, { status: 404 });

  try {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'no-cache' };

    if (ext === '.svg') {
      // SVG always served as attachment — XSS guard (R5.4, existing behavior unchanged)
      const safeName = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
    } else if (!IMAGE_CONTENT_TYPES.has(contentType)) {
      // Non-image documents (e.g. PDF): inline by default; attachment when ?download is present
      if (url.searchParams.has('download')) {
        const safeName = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_');
        headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
      }
      // else: no Content-Disposition → browser renders inline
    }
    // Images (other than SVG): no Content-Disposition (unchanged)

    return new Response(buffer, { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }
}
