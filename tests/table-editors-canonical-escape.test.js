/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: the four table-editor client modules must consume the
 * canonical escapeHtml/escapeAttr pair from utils/html-escape.ts for BOTH
 * attribute and text-content escaping, instead of splitting escapeHtml from
 * ./common.js and escapeAttr from the canonical module.
 *
 * Rule: each file must import `escapeHtml` from the canonical
 * '../../../utils/html-escape.js' module, and must NOT import `escapeHtml`
 * from './common.js' anymore. This is part of the issue #39 consolidation
 * effort (sub-slice 2c).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const FILES = [
  'routes/admin/client/configs-editor.ts',
  'routes/admin/client/menus-editor.ts',
  'routes/admin/client/redirects-editor.ts',
  'routes/admin/client/page-editor.ts',
];

for (const relPath of FILES) {
  test(`${relPath} — must import escapeHtml from the canonical html-escape module`, async () => {
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

    const commonImportMatch = src.match(
      /^import\s*\{([^}]*)\}\s*from\s*['"]\.\/common\.js['"];?$/m,
    );

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
}
