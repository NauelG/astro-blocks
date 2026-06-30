/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * file-value.test.js
 * Unit tests for utils/file-value.ts pure helpers.
 * Tests import from ../dist/ after build.
 *
 * RED phase: written before the implementation exists.
 *
 * Spec: D8, ADR-3, ADR-5.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toFileValue,
  parseFileValue,
  serializeFileValueAttr,
  isEmptyFileValue,
  mediaEntryToFileValue,
  fileDownloadUrl,
} from '../dist/utils/file-value.js';

// ─── toFileValue ──────────────────────────────────────────────────────────────

test('toFileValue — passes through valid object with url', () => {
  const result = toFileValue({ url: '/uploads/doc.pdf', filename: 'doc.pdf', mimeType: 'application/pdf' });
  assert.equal(result.url, '/uploads/doc.pdf');
  assert.equal(result.filename, 'doc.pdf');
  assert.equal(result.mimeType, 'application/pdf');
});

test('toFileValue — passes through object with download flag', () => {
  const result = toFileValue({ url: '/uploads/doc.pdf', download: true });
  assert.equal(result.url, '/uploads/doc.pdf');
  assert.equal(result.download, true);
});

test('toFileValue — empty string → sentinel { url: "" }', () => {
  const result = toFileValue('');
  assert.equal(result.url, '');
});

test('toFileValue — null → sentinel { url: "" }', () => {
  const result = toFileValue(null);
  assert.equal(result.url, '');
});

test('toFileValue — undefined → sentinel { url: "" }', () => {
  const result = toFileValue(undefined);
  assert.equal(result.url, '');
});

test('toFileValue — object without url → sentinel { url: "" }', () => {
  const result = toFileValue({ filename: 'doc.pdf' });
  assert.equal(result.url, '');
});

test('toFileValue — array → sentinel { url: "" }', () => {
  const result = toFileValue(['/doc.pdf']);
  assert.equal(result.url, '');
});

// ─── parseFileValue ───────────────────────────────────────────────────────────

test('parseFileValue — empty string returns { url: "" }', () => {
  const result = parseFileValue('');
  assert.equal(result.url, '');
});

test('parseFileValue — valid JSON object with url returns parsed object', () => {
  const raw = JSON.stringify({ url: '/uploads/doc.pdf', filename: 'doc.pdf' });
  const result = parseFileValue(raw);
  assert.equal(result.url, '/uploads/doc.pdf');
  assert.equal(result.filename, 'doc.pdf');
});

test('parseFileValue — malformed JSON returns sentinel { url: "" }', () => {
  const result = parseFileValue('{bad json');
  assert.equal(result.url, '');
});

test('parseFileValue — JSON without url property returns sentinel', () => {
  const raw = JSON.stringify({ filename: 'doc.pdf' });
  const result = parseFileValue(raw);
  assert.equal(result.url, '');
});

test('parseFileValue — round-trip with all fields', () => {
  const original = {
    url: '/uploads/2026/06/report.pdf',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    download: true,
  };
  const result = parseFileValue(JSON.stringify(original));
  assert.equal(result.url, original.url);
  assert.equal(result.filename, original.filename);
  assert.equal(result.mimeType, original.mimeType);
  assert.equal(result.download, original.download);
});

test('parseFileValue — download field false is preserved', () => {
  const raw = JSON.stringify({ url: '/uploads/doc.pdf', download: false });
  const result = parseFileValue(raw);
  assert.equal(result.download, false);
});

// ─── serializeFileValueAttr ───────────────────────────────────────────────────

test('serializeFileValueAttr — no raw double-quote in output (critical breakout char)', () => {
  const value = { url: '/uploads/doc.pdf', filename: 'my "report".pdf' };
  const serialized = serializeFileValueAttr(value);
  assert.ok(!serialized.includes('"'), 'must encode all double-quotes to prevent attribute breakout');
});

test('serializeFileValueAttr — round-trip through HTML attribute preserves data', () => {
  const original = { url: '/uploads/doc.pdf', filename: 'report.pdf', mimeType: 'application/pdf', download: true };
  const serialized = serializeFileValueAttr(original);
  // Decode HTML entities (as browser would when reading .value)
  const decoded = serialized
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const roundTripped = JSON.parse(decoded);
  assert.equal(roundTripped.url, original.url);
  assert.equal(roundTripped.filename, original.filename);
  assert.equal(roundTripped.mimeType, original.mimeType);
  assert.equal(roundTripped.download, original.download);
});

test('serializeFileValueAttr — encodes &, <, >, \', "', () => {
  const value = { url: '/a&b<c>d"e\'f.pdf' };
  const serialized = serializeFileValueAttr(value);
  assert.ok(!serialized.includes('&b'), 'raw & must be encoded');
  assert.ok(!serialized.includes('<c>'), 'raw < > must be encoded');
  assert.ok(!serialized.includes('"e'), 'raw " must be encoded');
});

// ─── isEmptyFileValue ─────────────────────────────────────────────────────────

test('isEmptyFileValue — { url: "" } is empty', () => {
  assert.equal(isEmptyFileValue({ url: '' }), true);
});

test('isEmptyFileValue — {} is empty (missing url)', () => {
  assert.equal(isEmptyFileValue({}), true);
});

test('isEmptyFileValue — { url: "/doc.pdf" } is not empty', () => {
  assert.equal(isEmptyFileValue({ url: '/doc.pdf' }), false);
});

test('isEmptyFileValue — null is empty', () => {
  assert.equal(isEmptyFileValue(null), true);
});

test('isEmptyFileValue — undefined is empty', () => {
  assert.equal(isEmptyFileValue(undefined), true);
});

test('isEmptyFileValue — string is treated as empty (not a valid FileFieldValue object)', () => {
  assert.equal(isEmptyFileValue('/doc.pdf'), true);
});

// ─── mediaEntryToFileValue ────────────────────────────────────────────────────

test('mediaEntryToFileValue — maps entry with all relevant fields', () => {
  const entry = {
    id: '1',
    url: '/uploads/2026/06/doc.pdf',
    filename: 'doc.pdf',
    size: 12345,
    mimeType: 'application/pdf',
    createdAt: '2026-06-29T00:00:00.000Z',
    fileCategory: 'document',
  };
  const value = mediaEntryToFileValue(entry);
  assert.equal(value.url, '/uploads/2026/06/doc.pdf');
  assert.equal(value.filename, 'doc.pdf');
  assert.equal(value.mimeType, 'application/pdf');
});

test('mediaEntryToFileValue — download field not set by default (false/undefined)', () => {
  const entry = {
    id: '1',
    url: '/uploads/2026/06/doc.pdf',
    filename: 'doc.pdf',
    size: 12345,
    mimeType: 'application/pdf',
    createdAt: '2026-06-29T00:00:00.000Z',
  };
  const value = mediaEntryToFileValue(entry);
  // download should be absent or false — never forced to true
  assert.ok(value.download !== true, 'download must not be forced true from entry alone');
});

test('mediaEntryToFileValue — maps image entry (image/jpeg)', () => {
  const entry = {
    id: '2',
    url: '/uploads/2026/06/photo.jpg',
    filename: 'photo.jpg',
    size: 5000,
    mimeType: 'image/jpeg',
    createdAt: '2026-06-29T00:00:00.000Z',
  };
  const value = mediaEntryToFileValue(entry);
  assert.equal(value.url, '/uploads/2026/06/photo.jpg');
  assert.equal(value.mimeType, 'image/jpeg');
});

// ─── fileDownloadUrl ──────────────────────────────────────────────────────────

test('fileDownloadUrl — download=true appends ?download to plain url', () => {
  const value = { url: '/uploads/2026/06/doc.pdf', download: true };
  assert.equal(fileDownloadUrl(value), '/uploads/2026/06/doc.pdf?download');
});

test('fileDownloadUrl — download=false returns url unchanged', () => {
  const value = { url: '/uploads/2026/06/doc.pdf', download: false };
  assert.equal(fileDownloadUrl(value), '/uploads/2026/06/doc.pdf');
});

test('fileDownloadUrl — download=undefined returns url unchanged', () => {
  const value = { url: '/uploads/2026/06/doc.pdf' };
  assert.equal(fileDownloadUrl(value), '/uploads/2026/06/doc.pdf');
});

test('fileDownloadUrl — existing query string handled (no double ?)', () => {
  const value = { url: '/uploads/2026/06/doc.pdf?foo=bar', download: true };
  const result = fileDownloadUrl(value);
  // Must not produce ??download or duplicate ?
  assert.ok(!result.includes('??'), 'must not produce double question mark');
  assert.ok(result.includes('download'), 'must include download param');
  // Should produce ?foo=bar&download
  assert.equal(result, '/uploads/2026/06/doc.pdf?foo=bar&download');
});

test('fileDownloadUrl — url already has ?download, download=true → no duplication', () => {
  const value = { url: '/uploads/doc.pdf?download', download: true };
  const result = fileDownloadUrl(value);
  // Should not produce /uploads/doc.pdf?download&download or ?download?download
  const downloadCount = (result.match(/download/g) || []).length;
  assert.equal(downloadCount, 1, 'download must appear exactly once');
});

test('fileDownloadUrl — empty url + download=true → appends ?download', () => {
  const value = { url: '', download: true };
  // Should not crash; result is empty + ?download
  const result = fileDownloadUrl(value);
  assert.ok(result.includes('download'), 'download param must be in result even for empty url');
});

// ─── fileDownloadUrl — false-positive / double-append regression cases ────────

test('fileDownloadUrl — ?downloadtoken=abc with download=true → appends &download (no false positive)', () => {
  // ?downloadtoken is NOT the same as ?download — must still append
  const value = { url: '/uploads/doc.pdf?downloadtoken=abc', download: true };
  const result = fileDownloadUrl(value);
  // Must still contain the original downloadtoken param
  assert.ok(result.includes('downloadtoken=abc'), 'original downloadtoken param must be preserved');
  // Must have the bare download param appended
  const params = new URL(result, 'http://x').searchParams;
  assert.ok(params.has('download'), 'must add the bare download param');
});

test('fileDownloadUrl — ?x=1&download=something with download=true → no double download param', () => {
  // A download param with a value already exists — must not append a second one
  const value = { url: '/uploads/doc.pdf?x=1&download=something', download: true };
  const result = fileDownloadUrl(value);
  // Count occurrences of the key "download" in the search string
  const params = new URL(result, 'http://x').searchParams;
  const keys = [...params.keys()].filter(k => k === 'download');
  assert.equal(keys.length, 1, 'download key must appear exactly once');
});

test('fileDownloadUrl — ?download already present with download=true → idempotent, no &download appended', () => {
  // Bare ?download already exists — must be idempotent
  const value = { url: '/uploads/doc.pdf?download', download: true };
  const result = fileDownloadUrl(value);
  const params = new URL(result, 'http://x').searchParams;
  const keys = [...params.keys()].filter(k => k === 'download');
  assert.equal(keys.length, 1, 'download must appear exactly once (idempotent)');
  // No extra &download should have been appended
  assert.ok(!result.includes('&download'), 'must not append a second &download');
});
