/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export const prerender = false;
import path from 'node:path';
import fs from 'node:fs/promises';
import { getUploadsDir } from '../utils/paths.mjs';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safePathFromUrl(urlPathname) {
  const normalized = urlPathname.replace(/\/+/g, '/').replace(/^\//, '');
  if (!normalized.startsWith('uploads/')) return null;
  const relative = normalized.slice('uploads/'.length);
  if (relative.includes('..')) return null;
  const fullPath = path.join(getUploadsDir(), relative);
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(uploadsDir)) return null;
  return resolved;
}

export async function GET({ request }) {
  const url = new URL(request.url);
  const filePath = safePathFromUrl(url.pathname);
  if (!filePath) {
    return new Response(null, { status: 404 });
  }
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    return new Response(buf, {
      headers: { 'Content-Type': contentType },
    });
  } catch (e) {
    if (e.code === 'ENOENT') return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }
}
