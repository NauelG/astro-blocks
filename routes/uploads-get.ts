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
};

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const filePath = resolveUploadPath(url.pathname);
  if (!filePath) return new Response(null, { status: 404 });

  try {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    return new Response(buffer, {
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }
}
