/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Guard: the package root must never contain a `data/` directory.
 *
 * `.gitignore` refuses to track a package-root `data/`, but nothing stops the
 * write itself — a test that leaks a write to `process.cwd()/data` passes green
 * while polluting the repo (see #96). This script makes that leak loud: it runs
 * after the suite and fails if `data/` exists at the package root.
 *
 * A rule enforced only by `.gitignore` is a rule nothing enforces.
 */

import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(packageRoot, 'data');

if (!fs.existsSync(dataDir)) {
  process.exit(0);
}

const entries = fs.readdirSync(dataDir, { withFileTypes: true });
const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join(', ');

console.error(
  [
    '',
    `✖ Package-root data/ leak detected: ${dataDir}`,
    `  Contents: ${listing || '(empty)'}`,
    '',
    '  A test leaked a write to process.cwd()/data — the package root must never',
    '  contain data/ (it is always consumer/playground-scoped). This usually means',
    '  a fire-and-forget job outlived its test and wrote after teardown (#96).',
    '',
    '  Clean it and re-run:  rm -rf data',
    '',
  ].join('\n'),
);

process.exit(1);
