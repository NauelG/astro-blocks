/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { lookupByExt } from '../utils/file-catalog.js';
import { resolveUploadPath } from '../utils/paths.js';

export const prerender = false;

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const filePath = resolveUploadPath(url.pathname);
  if (!filePath) return new Response(null, { status: 404 });

  try {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Content-Type and inline-vs-download both come from the catalog row (ADR-0023).
    // This route used to keep its own extension→type map, which had no '.avif' entry while
    // the variant generator writes '.avif' files — so every AVIF variant was served as
    // application/octet-stream. Two maps that had to agree, and did not.
    //
    // An unknown extension is octet-stream + attachment: unknown never means inline.
    const row = lookupByExt(ext);
    const contentType = row?.contentType ?? 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    };

    // SVG is an attachment because its ROW says so — not because this route remembers to
    // special-case it. The next route that serves a file inherits the rule for free.
    const forceDownload = url.searchParams.has('download');
    if ((row?.disposition ?? 'attachment') === 'attachment' || forceDownload) {
      const safeName = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
    }

    return new Response(buffer, { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }
}
