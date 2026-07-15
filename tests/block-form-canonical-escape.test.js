/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: the block-form modules (the facade
 * src/routes/admin/client/block-form.ts plus every module under
 * src/routes/admin/client/block-form/) must consume the canonical
 * escapeHtml/escapeAttr pair from src/utils/html-escape.ts instead of defining
 * a local `escapePickerHtml` attribute escaper, and must not import escapeHtml
 * from ./common.js. This is part of the issue #39 consolidation effort
 * (sub-slice 2d); the multi-file scan follows the #38 decomposition.
 *
 * These modules are excluded from unit coverage (scripts/coverage.mjs) and are
 * e2e-covered only, so this test reads the source text directly instead of
 * importing from dist/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeAttr } from '../dist/utils/html-escape.js';

const root = process.cwd();
const facadeRelPath = 'src/routes/admin/client/block-form.ts';
const modulesRelDir = 'src/routes/admin/client/block-form';

/** Strip // line and block comments so doc mentions of escapeHtml() don't count as calls. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** All block-form source files: the facade + every module in block-form/. */
async function collectBlockFormFiles() {
  const moduleEntries = await readdir(join(root, modulesRelDir), { withFileTypes: true });
  const moduleFiles = moduleEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `${modulesRelDir}/${entry.name}`);
  assert.ok(moduleFiles.length > 0, `Expected .ts modules under ${modulesRelDir}, found none.`);
  return [facadeRelPath, ...moduleFiles];
}

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

test('block-form modules — none declares a local escapePickerHtml function', async () => {
  for (const relPath of await collectBlockFormFiles()) {
    const src = await readFile(join(root, relPath), 'utf-8');
    assert.ok(
      !/function\s+escapePickerHtml\(/.test(src),
      `Found a local "function escapePickerHtml(" declaration in ${relPath}. ` +
        'It must be deleted in favor of the canonical escapeHtml/escapeAttr imports.',
    );
  }
});

test('block-form modules — every user of escapeHtml/escapeAttr imports the canonical html-escape module', async () => {
  for (const relPath of await collectBlockFormFiles()) {
    const src = stripComments(await readFile(join(root, relPath), 'utf-8'));
    const usesEscaper = /\b(?:escapeHtml|escapeAttr)\s*\(/.test(src);
    if (!usesEscaper) continue;

    const importLineMatch = src.match(
      /^import\s*\{[^}]*\}\s*from\s*['"](?:\.\.\/)+utils\/html-escape\.js['"];?$/m,
    );
    assert.ok(
      importLineMatch,
      `${relPath} calls escapeHtml/escapeAttr but has no import from the canonical utils/html-escape.js module.`,
    );

    const importLine = importLineMatch[0];
    if (/\bescapeHtml\s*\(/.test(src)) {
      assert.ok(
        importLine.includes('escapeHtml'),
        `The canonical html-escape import line in ${relPath} does not include escapeHtml: ${importLine}`,
      );
    }
    if (/\bescapeAttr\s*\(/.test(src)) {
      assert.ok(
        importLine.includes('escapeAttr'),
        `The canonical html-escape import line in ${relPath} does not include escapeAttr: ${importLine}`,
      );
    }
  }
});

test('block-form modules — none imports escapeHtml from common.js', async () => {
  for (const relPath of await collectBlockFormFiles()) {
    const src = await readFile(join(root, relPath), 'utf-8');
    const commonImportMatch = src.match(
      /^import\s*\{([^}]*)\}\s*from\s*['"](?:\.\.?\/)+common\.js['"];?$/m,
    );
    if (!commonImportMatch) continue;

    assert.ok(
      !/\bescapeHtml\b/.test(commonImportMatch[1]),
      `Found escapeHtml still imported from common.js in ${relPath}. ` +
        'It must be imported from the canonical utils/html-escape.js module instead.',
    );
  }
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
