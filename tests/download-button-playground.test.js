/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * tests/download-button-playground.test.js
 *
 * Structural tests for the DownloadButton playground component (Slice E).
 * Spec: R9.1-A, R9.2-A — file-existence and schema-declaration checks.
 *
 * No build needed — these are synchronous fs assertions on source files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS_DIR = path.join(ROOT, 'playgrounds', 'basic', 'src', 'components');

// ─── R9.1-A — DownloadButton.astro exists ────────────────────────────────────

test('R9.1-A: DownloadButton.astro exists in playground components', () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.astro');
  assert.ok(fs.existsSync(filePath), `Expected file to exist: ${filePath}`);
});

// ─── R9.2-A — DownloadButton.schema.ts exists and has correct declarations ───

test('R9.2-A: DownloadButton.schema.ts exists in playground components', () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.schema.ts');
  assert.ok(fs.existsSync(filePath), `Expected file to exist: ${filePath}`);
});

test("R9.2-A: DownloadButton.schema.ts declares a prop with type 'file'", () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.schema.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /type:\s*['"]file['"]/, "Schema should contain type: 'file' declaration");
});

test("R9.2-A: DownloadButton.schema.ts includes 'application/pdf' in accept", () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.schema.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(
    content,
    /application\/pdf/,
    "Schema should contain 'application/pdf' in accept array",
  );
});

test('R9.2-A: DownloadButton.schema.ts declares download: true', () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.schema.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /download:\s*true/, 'Schema should contain download: true');
});

// ─── DownloadButton.astro uses fileDownloadUrl ────────────────────────────────

test('DownloadButton.astro imports or references fileDownloadUrl', () => {
  const filePath = path.join(COMPONENTS_DIR, 'DownloadButton.astro');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(
    content,
    /fileDownloadUrl/,
    'DownloadButton.astro should reference fileDownloadUrl helper',
  );
});

// ─── R8.1-A — media.astro does NOT contain hardcoded accept="image/*" ────────

test('R8.1-A: routes/admin/media.astro does not contain hardcoded accept="image/*"', () => {
  const filePath = path.join(ROOT, 'routes', 'admin', 'media.astro');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.ok(
    !content.includes('accept="image/*"'),
    'media.astro must not contain hardcoded accept="image/*" — it should be dynamic',
  );
});

// ─── R8.2-A — media.ts contains a non-image (document) branch ────────────────

test('R8.2-A: routes/admin/client/media.ts contains non-image (document) card branch', () => {
  const filePath = path.join(ROOT, 'routes', 'admin', 'client', 'media.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(
    content,
    /fileCategory|document|non.?image/i,
    'media.ts should contain a conditional branch for non-image (document) entries',
  );
});
