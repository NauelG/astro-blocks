/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * upload-gate.test.js
 * Unit tests for utils/upload-gate.ts — evaluateUpload denylist + allowlist gate.
 * Tests import from ../dist/ after build.
 *
 * RED phase: written before the implementation exists.
 *
 * Spec scenarios: SEC-DENY-01, R2.3, R2.4 (ADR-4).
 * Evaluation ORDER (locked):
 *   1) denylist on MIME   → denied
 *   2) denylist on ext    → denied
 *   3) allowlist on MIME  → unsupported if absent
 *   4) ok
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateUpload } from '../dist/utils/upload-gate.js';

const DEFAULT_ALLOWED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'application/pdf',
];

// ─── Denylist MIME — always denied regardless of allowlist ────────────────────

test('SEC-DENY-01: evaluateUpload — text/html → denied (denylist MIME)', () => {
  const result = evaluateUpload({
    mimeType: 'text/html',
    derivedExtension: '.html',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('SEC-DENY-01: evaluateUpload — application/javascript → denied (denylist MIME)', () => {
  const result = evaluateUpload({
    mimeType: 'application/javascript',
    derivedExtension: '.js',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('evaluateUpload — text/javascript → denied (denylist MIME variant)', () => {
  const result = evaluateUpload({
    mimeType: 'text/javascript',
    derivedExtension: '.js',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

// ─── Denylist MIME beats allowlist — even if misconfigured ───────────────────

test('evaluateUpload — denylist beats allowlist: text/html in allowed → still denied', () => {
  const allowedWithDangerous = new Set([...DEFAULT_ALLOWED, 'text/html']);
  const result = evaluateUpload({
    mimeType: 'text/html',
    derivedExtension: '.html',
    allowed: allowedWithDangerous,
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('evaluateUpload — denylist beats allowlist: application/javascript in allowed → still denied', () => {
  const allowedWithDangerous = new Set([...DEFAULT_ALLOWED, 'application/javascript']);
  const result = evaluateUpload({
    mimeType: 'application/javascript',
    derivedExtension: '.js',
    allowed: allowedWithDangerous,
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

// ─── Denylist extension — denied regardless of MIME ──────────────────────────

test('evaluateUpload — .exe extension → denied (denylist ext)', () => {
  const result = evaluateUpload({
    mimeType: 'application/octet-stream',
    derivedExtension: '.exe',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('evaluateUpload — .sh extension → denied (denylist ext)', () => {
  const result = evaluateUpload({
    mimeType: 'application/x-sh',
    derivedExtension: '.sh',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('evaluateUpload — .bat extension → denied (denylist ext)', () => {
  const result = evaluateUpload({
    mimeType: 'application/x-bat',
    derivedExtension: '.bat',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

test('evaluateUpload — .html extension with non-dangerous MIME → denied (ext denylist applies)', () => {
  const result = evaluateUpload({
    mimeType: 'application/octet-stream',
    derivedExtension: '.html',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

// ─── Unsupported: MIME not in denylist, not in allowlist ─────────────────────

test('evaluateUpload — application/msword not in allowlist → unsupported', () => {
  const result = evaluateUpload({
    mimeType: 'application/msword',
    derivedExtension: '.doc',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'unsupported' });
});

test('evaluateUpload — application/zip not in allowlist → unsupported', () => {
  const result = evaluateUpload({
    mimeType: 'application/zip',
    derivedExtension: '.zip',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'unsupported' });
});

// ─── Allowed: MIME passes both denylist and allowlist ────────────────────────

test('evaluateUpload — image/jpeg in allowlist → ok', () => {
  const result = evaluateUpload({
    mimeType: 'image/jpeg',
    derivedExtension: '.jpg',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateUpload — image/png in allowlist → ok', () => {
  const result = evaluateUpload({
    mimeType: 'image/png',
    derivedExtension: '.png',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateUpload — application/pdf in default allowlist → ok', () => {
  const result = evaluateUpload({
    mimeType: 'application/pdf',
    derivedExtension: '.pdf',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateUpload — image/svg+xml in default allowlist → ok (SVG not in denylist)', () => {
  const result = evaluateUpload({
    mimeType: 'image/svg+xml',
    derivedExtension: '.svg',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateUpload — image/gif in default allowlist → ok', () => {
  const result = evaluateUpload({
    mimeType: 'image/gif',
    derivedExtension: '.gif',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

// ─── Evaluation order: ext denial fires even when MIME is safe ───────────────

test('evaluateUpload — .svgz extension → denied (even though svg is allowed)', () => {
  const result = evaluateUpload({
    mimeType: 'image/svg+xml',
    derivedExtension: '.svgz',
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'denied' });
});

// ─── Null/absent derivedExtension handled gracefully ─────────────────────────

test('evaluateUpload — null derivedExtension with safe MIME and in allowlist → ok', () => {
  const result = evaluateUpload({
    mimeType: 'application/pdf',
    derivedExtension: null,
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateUpload — null derivedExtension with safe MIME not in allowlist → unsupported', () => {
  const result = evaluateUpload({
    mimeType: 'application/msword',
    derivedExtension: null,
    allowed: new Set(DEFAULT_ALLOWED),
  });
  assert.deepEqual(result, { ok: false, reason: 'unsupported' });
});
