/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: asserts that escapeHtml() is never used inside an HTML
 * attribute value in block-form.ts.
 *
 * Rule: attribute values (inside ="...") must use escapePickerHtml() because it
 * also encodes double-quotes ("). Using escapeHtml() in that context allows a
 * value containing a literal " to break out of the attribute, truncating the
 * value and enabling attribute injection.
 *
 * escapeHtml() is correct only for element TEXT CONTENT (between > and <).
 *
 * This test reads the source file as text and fails if it finds the pattern
 *   ="${escapeHtml(   or   ='${escapeHtml(
 * so any future regression is caught by CI before it ships.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const src = await readFile(
  join(root, 'routes/admin/client/block-form.ts'),
  'utf-8'
);

// Matches escapeHtml( used directly inside a double- or single-quoted HTML
// attribute, i.e. the pattern   ="${escapeHtml(   or   ='${escapeHtml(
// Template literals make the interpolation boundary ${...}, so the tell-tale
// string is literally: ="  followed immediately by  ${escapeHtml(
// or the single-quote variant.
const ATTR_DOUBLE_QUOTE = /="\$\{escapeHtml\(/;
const ATTR_SINGLE_QUOTE = /='\$\{escapeHtml\(/;

test('block-form.ts — escapeHtml must NOT appear in HTML attribute value contexts', () => {
  assert.ok(
    !ATTR_DOUBLE_QUOTE.test(src),
    'Found escapeHtml() inside a double-quoted attribute value (="${escapeHtml(). ' +
      'Use escapePickerHtml() for attribute contexts — it also encodes double-quotes.'
  );
  assert.ok(
    !ATTR_SINGLE_QUOTE.test(src),
    "Found escapeHtml() inside a single-quoted attribute value (='${escapeHtml(). " +
      'Use escapePickerHtml() for attribute contexts — it also encodes double-quotes.'
  );
});
