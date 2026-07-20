/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * fflate <-> Web ReadableStream bridge.
 *
 * This module is the integration seam between fflate's callback-based
 * streaming API and the web Streams API used by Request/Response bodies.
 * It has no dependency on handlers.ts or data.ts — pure I/O bridge.
 *
 * ADR-4: Streaming export constraint — never buffer the whole archive.
 *
 * Implementation note: fflate's Async*Deflate/Inflate variants use Node.js
 * Worker threads, which are not available in all environments. We use the
 * synchronous Zip/Unzip + ZipDeflate/UnzipInflate variants instead, which
 * run on the same thread and are fully compatible with the Node.js ESM build.
 */

import { Zip, Unzip, UnzipInflate } from 'fflate';
import type { AsyncFlateStreamHandler } from 'fflate';

/**
 * Creates a ReadableStream<Uint8Array> backed by a fflate Zip instance.
 *
 * @param zipSetup - A callback that receives the Zip instance so the caller
 *   can add entries (via ZipDeflate or ZipPassThrough) and call zip.end().
 *   The callback must call zip.end() after adding all files.
 * @returns A ReadableStream that emits the zip archive bytes as they are produced.
 */
export function fflateZipToReadableStream(
  zipSetup: (zip: Zip) => void,
): ReadableStream<Uint8Array> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let streamErrored = false;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      const zip = new Zip();

      const onData: AsyncFlateStreamHandler = (err, chunk, final) => {
        if (streamErrored) return;
        if (err) {
          streamErrored = true;
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) {
          controller.close();
        }
      };

      zip.ondata = onData;

      try {
        zipSetup(zip);
      } catch (err) {
        streamErrored = true;
        controller.error(err);
      }
    },
    cancel() {
      streamErrored = true;
    },
  });

  return stream;
}

/**
 * Reads a ReadableStream of zip bytes and calls onFile for each extracted entry.
 *
 * @param stream - A ReadableStream<Uint8Array> of raw zip bytes.
 * @param onFile - Async callback invoked with (name, data) for each extracted file.
 *   The data is a Buffer containing the full decompressed content of the file.
 * @returns A Promise that resolves when the stream is fully consumed, or rejects
 *   if the stream errors or decompression fails.
 */
export async function readableStreamToFflateUnzip(
  stream: ReadableStream<Uint8Array>,
  onFile: (name: string, data: Buffer) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const unzip = new Unzip();
    // Register the sync inflate decoder so deflated entries are handled
    unzip.register(UnzipInflate);

    const pendingFiles: Promise<void>[] = [];

    unzip.onfile = (file) => {
      const chunks: Uint8Array[] = [];

      file.ondata = (err, chunk, final) => {
        if (err) {
          reject(err);
          return;
        }
        chunks.push(chunk);
        if (final) {
          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const buf = Buffer.allocUnsafe(totalLen);
          let offset = 0;
          for (const c of chunks) {
            buf.set(c, offset);
            offset += c.length;
          }
          const p = onFile(file.name, buf).catch(reject);
          pendingFiles.push(p);
        }
      };

      file.start();
    };

    // Pump the readable stream into fflate's Unzip
    const reader = stream.getReader();

    function pump(): void {
      reader.read().then(
        ({ done, value }) => {
          if (done) {
            try {
              // Signal end of stream to fflate
              unzip.push(new Uint8Array(0), true);
            } catch (err) {
              reject(err);
              return;
            }
            // Wait for all onFile callbacks to complete
            Promise.all(pendingFiles).then(() => resolve(), reject);
            return;
          }
          try {
            unzip.push(value, false);
          } catch (err) {
            reject(err);
            return;
          }
          pump();
        },
        (err: unknown) => {
          // Stream reader errored (e.g. controller.error() was called mid-stream)
          reject(err);
        },
      );
    }

    pump();
  });
}
