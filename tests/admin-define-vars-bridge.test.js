/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_DIR = path.join(ROOT, 'routes', 'admin');

/**
 * An EMPTY `<script define:vars={{ x }}></script>` bridge is broken: define:vars
 * declares `const x` scoped to that script's own execution, so a SEPARATE
 * `<script is:inline>` that references `x` throws "x is not defined" at runtime.
 * The working pattern (settings.astro, cache.astro) puts define:vars on the SAME
 * script that consumes the variable. This guard forbids the empty-bridge smell.
 */
test('no admin route uses an empty define:vars bridge script (runtime ReferenceError)', () => {
  const files = fs.readdirSync(ADMIN_DIR).filter((f) => f.endsWith('.astro'));
  const emptyBridgeRe = /define:vars=\{\{[^}]*\}\}\s*>\s*<\/script>/;

  const offenders = files.filter((f) => emptyBridgeRe.test(fs.readFileSync(path.join(ADMIN_DIR, f), 'utf8')));

  assert.deepEqual(
    offenders,
    [],
    `Admin routes with an empty define:vars bridge (the injected const is unreachable from a separate is:inline script): ${offenders.join(', ')}`,
  );
});
