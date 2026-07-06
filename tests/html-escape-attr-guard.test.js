/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Repo-wide source-level guard: asserts that escapeHtml() is never used
 * inside an HTML attribute value across every admin client file that renders
 * user-controlled data.
 *
 * Rule: attribute values (inside ="..." or ='...') must use escapeAttr()
 * (or, historically, a local attribute-safe escaper) because it also encodes
 * double-quotes ("). Using escapeHtml() in that context allows a value
 * containing a literal " to break out of the attribute, truncating the
 * value and enabling attribute injection.
 *
 * escapeHtml() is correct only for element TEXT CONTENT (between > and <).
 *
 * This test reads each source file as text and fails if it finds the pattern
 *   ="${escapeHtml(   or   ='${escapeHtml(
 * so any future regression is caught by CI before it ships.
 *
 * This replaces the narrower tests/block-form-attr-escaping.test.js (which
 * only covered block-form.ts) — its coverage is folded into this wider guard,
 * not dropped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

// Matches escapeHtml( used directly inside a double- or single-quoted HTML
// attribute, i.e. the pattern   ="${escapeHtml(   or   ='${escapeHtml(
// Template literals make the interpolation boundary ${...}, so the tell-tale
// string is literally: ="  followed immediately by  ${escapeHtml(
// or the single-quote variant. Note: this regex does NOT false-match
// escapePickerHtml( (character 7 is "P", not "H").
const ATTR_DOUBLE_QUOTE = /="\$\{escapeHtml\(/;
const ATTR_SINGLE_QUOTE = /='\$\{escapeHtml\(/;

const FILES = [
  'routes/admin/client/block-form.ts',
  'routes/admin/client/configs-editor.ts',
  'routes/admin/client/menus-editor.ts',
  'routes/admin/client/redirects-editor.ts',
  'routes/admin/client/page-editor.ts',
  'routes/admin/client/media.ts',
];

for (const relPath of FILES) {
  test(`${relPath} — escapeHtml must NOT appear in HTML attribute value contexts`, async () => {
    const src = await readFile(join(root, relPath), 'utf-8');

    assert.ok(
      !ATTR_DOUBLE_QUOTE.test(src),
      `Found escapeHtml() inside a double-quoted attribute value (="\${escapeHtml() in ${relPath}. ` +
        'Use escapeAttr() for attribute contexts — it also encodes double-quotes.'
    );
    assert.ok(
      !ATTR_SINGLE_QUOTE.test(src),
      `Found escapeHtml() inside a single-quoted attribute value ='\${escapeHtml() in ${relPath}. ` +
        'Use escapeAttr() for attribute contexts — it also encodes double-quotes.'
    );
  });
}
