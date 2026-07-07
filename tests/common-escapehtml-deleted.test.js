/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: routes/admin/client/common.ts must NOT declare a local
 * DOM-based escapeHtml function (the `div.textContent = v; return
 * div.innerHTML` implementation). It was dead code with zero importers
 * repo-wide once block-form.ts was repointed to the canonical
 * utils/html-escape.ts module (sub-slice 2d, issue #39). This is the final
 * cleanup, sub-slice 2e.
 *
 * A second, repo-wide guard scans every routes/admin/client/*.ts file (via
 * glob, not a hardcoded list) and asserts none of them import `escapeHtml`
 * from './common.js', to keep the guard honest as new files are added.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const relPath = 'routes/admin/client/common.ts';
const clientDir = join(root, 'routes/admin/client');

test(`${relPath} — must not declare a local escapeHtml function`, async () => {
  const src = await readFile(join(root, relPath), 'utf-8');

  assert.ok(
    !/function\s+escapeHtml\(/.test(src),
    `Found a local "function escapeHtml(" declaration in ${relPath}. ` +
      'It is dead code with zero importers repo-wide and must be deleted.',
  );
});

test('no file under routes/admin/client/*.ts imports escapeHtml from ./common.js', async () => {
  const entries = await readdir(clientDir, { withFileTypes: true });
  const tsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);

  assert.ok(tsFiles.length > 0, `Expected to find .ts files under ${clientDir}, found none.`);

  const offenders = [];

  for (const fileName of tsFiles) {
    const filePath = join(clientDir, fileName);
    const src = await readFile(filePath, 'utf-8');

    const commonImportMatches = src.matchAll(
      /^import\s*\{([^}]*)\}\s*from\s*['"](?:\.\/)?common\.js['"];?$/gm,
    );

    for (const match of commonImportMatches) {
      const importedNames = match[1];
      if (/\bescapeHtml\b/.test(importedNames)) {
        offenders.push(fileName);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found escapeHtml still imported from './common.js' in: ${offenders.join(', ')}. ` +
      'Repoint these files to the canonical utils/html-escape.js module.',
  );
});
