/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: routes/admin/client/media.ts must consume the
 * canonical escapeHtml/escapeAttr pair from utils/html-escape.ts instead of
 * defining its own local copies.
 *
 * Rule: no `function escapeHtml(` or `function escapeAttr(` declarations may
 * exist in this file, and it must import both names from the canonical
 * '../../../utils/html-escape.js' module. This is part of the issue #39
 * consolidation effort (sub-slice 2b).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const relPath = 'routes/admin/client/media.ts';

test(`${relPath} — must not declare local escapeHtml/escapeAttr functions`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  assert.ok(
    !/function\s+escapeHtml\(/.test(src),
    `Found a local "function escapeHtml(" declaration in ${relPath}. ` +
      'It must be deleted in favor of the canonical import.',
  );
  assert.ok(
    !/function\s+escapeAttr\(/.test(src),
    `Found a local "function escapeAttr(" declaration in ${relPath}. ` +
      'It must be deleted in favor of the canonical import.',
  );
});

test(`${relPath} — must import escapeHtml and escapeAttr from the canonical html-escape module`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  const importLineMatch = src.match(/^import\s*\{[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/utils\/html-escape\.js['"];?$/m);

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
