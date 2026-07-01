/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

// A-1 canary: fflate core exports are available (validates fflate is installed + build succeeds)
import { strToU8, Zip, Unzip } from 'fflate';

test('A-1: fflate strToU8 is a function', () => {
  assert.equal(typeof strToU8, 'function');
});

test('A-1: fflate Zip is a function (constructor)', () => {
  assert.equal(typeof Zip, 'function');
});

test('A-1: fflate Unzip is a function (constructor)', () => {
  assert.equal(typeof Unzip, 'function');
});

// A-7: fflate <-> ReadableStream bridge tests
import { fflateZipToReadableStream, readableStreamToFflateUnzip } from '../dist/api/backup-stream.js';
import { ZipDeflate } from 'fflate';

test('A-7: fflateZipToReadableStream is a function', () => {
  assert.equal(typeof fflateZipToReadableStream, 'function');
});

test('A-7: readableStreamToFflateUnzip is a function', () => {
  assert.equal(typeof readableStreamToFflateUnzip, 'function');
});

test('A-7: round-trip zip then unzip via ReadableStream', async () => {
  const inputContent = 'Hello, fflate ReadableStream bridge!';
  const inputBytes = strToU8(inputContent);

  // Zip via ReadableStream using synchronous ZipDeflate
  const zipStream = fflateZipToReadableStream((zip) => {
    const entry = new ZipDeflate('test.txt');
    zip.add(entry);
    entry.push(inputBytes, true);
    zip.end();
  });

  // Collect zipped bytes
  const reader = zipStream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const zipped = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    zipped.set(chunk, offset);
    offset += chunk.length;
  }

  // Verify zip magic bytes: PK\x03\x04
  assert.equal(zipped[0], 0x50, 'zip magic byte 0 should be 0x50 (P)');
  assert.equal(zipped[1], 0x4b, 'zip magic byte 1 should be 0x4b (K)');
  assert.equal(zipped[2], 0x03, 'zip magic byte 2 should be 0x03');
  assert.equal(zipped[3], 0x04, 'zip magic byte 3 should be 0x04');

  // Unzip via ReadableStream
  const zipBuffer = Buffer.from(zipped);
  const unzipStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(zipBuffer));
      controller.close();
    },
  });

  const extracted = {};
  await readableStreamToFflateUnzip(unzipStream, async (name, data) => {
    extracted[name] = Buffer.from(data).toString('utf-8');
  });

  assert.ok('test.txt' in extracted, 'extracted should contain test.txt');
  assert.equal(extracted['test.txt'], inputContent, 'extracted content should match input');
});

test('A-7: zip output starts with PK\\x03\\x04 magic bytes', async () => {
  const bytes = strToU8('small content');
  const stream = fflateZipToReadableStream((zip) => {
    const entry = new ZipDeflate('file.txt');
    zip.add(entry);
    entry.push(bytes, true);
    zip.end();
  });

  const reader = stream.getReader();
  const firstChunk = (await reader.read()).value;
  reader.cancel();

  assert.ok(firstChunk instanceof Uint8Array, 'first chunk should be Uint8Array');
  assert.ok(firstChunk.length >= 4, 'first chunk should have at least 4 bytes');
  assert.equal(firstChunk[0], 0x50);
  assert.equal(firstChunk[1], 0x4b);
  assert.equal(firstChunk[2], 0x03);
  assert.equal(firstChunk[3], 0x04);
});

test('A-7: controller.error mid-stream aborts cleanly', async () => {
  // Create a stream that errors partway through
  const errorStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04])); // partial PK header
      controller.error(new Error('simulated mid-stream abort'));
    },
  });

  // readableStreamToFflateUnzip should reject (propagate the error) rather than hang
  await assert.rejects(
    async () => {
      await readableStreamToFflateUnzip(errorStream, async () => {});
    },
    /simulated mid-stream abort/,
  );
});
