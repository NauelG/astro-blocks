/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: src/routes/admin/client/block-form.ts must consume the
 * canonical escapeHtml/escapeAttr pair from src/utils/html-escape.ts instead of
 * defining its own local `escapePickerHtml` attribute escaper, and must no
 * longer import escapeHtml from ./common.js. This is part of the issue #39
 * consolidation effort (sub-slice 2d).
 *
 * block-form.ts is excluded from unit coverage (scripts/coverage.mjs) and is
 * e2e-covered only, so this test reads the source text directly instead of
 * importing from dist/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeAttr } from '../dist/utils/html-escape.js';

const root = process.cwd();
const relPath = 'src/routes/admin/client/block-form.ts';

/**
 * Verbatim copy of the deleted local escapePickerHtml body (pre-refactor),
 * kept here as a standing regression lock so the canonical escapeAttr
 * behavior can be proven equivalent without depending on the removed source.
 */
function oldEscapePickerHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test(`${relPath} — must not declare a local escapePickerHtml function`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  assert.ok(
    !/function\s+escapePickerHtml\(/.test(src),
    `Found a local "function escapePickerHtml(" declaration in ${relPath}. ` +
      'It must be deleted in favor of the canonical escapeHtml/escapeAttr imports.',
  );
});

test(`${relPath} — must import escapeHtml and escapeAttr from the canonical html-escape module`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  const importLineMatch = src.match(
    /^import\s*\{[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/utils\/html-escape\.js['"];?$/m,
  );

  assert.ok(
    importLineMatch,
    `Expected ${relPath} to import from '../../../utils/html-escape.js', but no matching import line was found.`,
  );

  const importLine = importLineMatch[0];

  assert.ok(
    importLine.includes('escapeHtml'),
    `The canonical html-escape import line in ${relPath} does not include escapeHtml: ${importLine}`,
  );
  assert.ok(
    importLine.includes('escapeAttr'),
    `The canonical html-escape import line in ${relPath} does not include escapeAttr: ${importLine}`,
  );
});

test(`${relPath} — must NOT import escapeHtml from ./common.js`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  const commonImportMatch = src.match(/^import\s*\{([^}]*)\}\s*from\s*['"]\.\/common\.js['"];?$/m);

  assert.ok(
    commonImportMatch,
    `Expected ${relPath} to still import other named exports from './common.js', but no matching import line was found.`,
  );

  const commonImportLine = commonImportMatch[0];

  assert.ok(
    !commonImportLine.includes('escapeHtml'),
    `Found escapeHtml still imported from './common.js' in ${relPath}. ` +
      'It must be imported from the canonical utils/html-escape.js module instead.',
  );
});

test('canonical escapeAttr is byte-identical to the deleted local escapePickerHtml for all HTML-significant chars', () => {
  const fixtures = [
    '&',
    '<',
    '>',
    '"',
    "'",
    `&<>"'`,
    'Tom & Jerry',
    '&quot;',
    'x" onmouseover="alert(1)',
    '',
    String(42),
  ];

  for (const fixture of fixtures) {
    assert.equal(
      escapeAttr(fixture),
      oldEscapePickerHtml(fixture),
      `escapeAttr(${JSON.stringify(fixture)}) diverged from the legacy escapePickerHtml output`,
    );
  }
});
