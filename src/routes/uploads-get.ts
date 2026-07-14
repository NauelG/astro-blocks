/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lookupByExt } from '../utils/file-catalog.js';
import { resolveUploadPath } from '../utils/paths.js';

export const prerender = false;

/** An inclusive byte range, resolved against a known resource size. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header against a resource size.
 *
 *   'bytes=0-1'      → { start: 0, end: 1 }        (Safari's probe)
 *   'bytes=100-'     → { start: 100, end: size-1 } (seek to the end)
 *   'bytes=-10'      → { start: size-10, end: size-1 } (suffix)
 *
 * Returns:
 *   - a ByteRange        when the range is satisfiable
 *   - 'unsatisfiable'    when it is well-formed but outside the resource → 416
 *   - null               when we do not understand it → serve the full body with a 200
 *
 * Multi-range (`bytes=0-99,200-299`) deliberately returns null. RFC 9110 permits a server to
 * ignore a Range header it does not wish to honour, and no browser media element sends one.
 *
 * Anything unparseable degrades to a full 200, never to a wrong 206. A 206 that lies about
 * which bytes it carries is far worse than a 200 that carries all of them: the client will
 * splice it into the wrong offset and the media will be silently corrupt.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix range: the last N bytes. A suffix of 0 bytes is meaningless.
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    // Clamp an end past the last byte — a client asking for more than exists gets what exists.
    if (end > size - 1) end = size - 1;
  }

  if (size === 0 || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const filePath = resolveUploadPath(url.pathname);
  if (!filePath) return new Response(null, { status: 404 });

  let size: number;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return new Response(null, { status: 404 });
    size = stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }

  const ext = path.extname(filePath).toLowerCase();

  // Content-Type and inline-vs-download both come from the catalog row (ADR-0023).
  // This route used to keep its own extension→type map, which had no '.avif' entry while the
  // variant generator writes '.avif' files — so every AVIF variant was served as
  // application/octet-stream. Two maps that had to agree, and did not.
  //
  // An unknown extension is octet-stream + attachment: unknown never means inline.
  const row = lookupByExt(ext);
  const headers: Record<string, string> = {
    'Content-Type': row?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    // Advertised on every response, for every category. A media element will not attempt a
    // ranged request against a server that does not say it supports one.
    'Accept-Ranges': 'bytes',
  };

  // SVG is an attachment because its ROW says so — not because this route remembers to
  // special-case it. The next route that serves a file inherits the rule for free.
  const forceDownload = url.searchParams.has('download');
  if ((row?.disposition ?? 'attachment') === 'attachment' || forceDownload) {
    const safeName = path.basename(filePath).replace(/[^A-Za-z0-9._-]/g, '_');
    headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
  }

  const range = parseRange(request.headers.get('range'), size);

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }

  // The body is STREAMED from disk, not read into memory. This route is public and
  // unauthenticated: a 100 MB video read with fs.readFile() would cost 100 MB of resident
  // memory per concurrent viewer. Images and PDFs get the same fix — they were simply too
  // small for anyone to notice.
  const { start, end } =
    range === null ? { start: 0, end: Math.max(0, size - 1) } : (range as ByteRange);

  const stream = Readable.toWeb(
    createReadStream(filePath, { start, end }),
  ) as ReadableStream<Uint8Array>;

  if (range === null) {
    return new Response(size === 0 ? null : stream, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  }

  return new Response(stream, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  });
}
