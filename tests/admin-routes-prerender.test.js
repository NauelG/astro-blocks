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

/**
 * Every admin route injected by the plugin MUST opt into on-demand SSR via
 * `export const prerender = false`. Otherwise, in a consumer running
 * `output: 'static'`, the page is prerendered at build time and
 * `Astro.request.headers.get('cookie')` is empty at runtime — so
 * resolveUiLocale never sees the cms-ui-locale cookie and the admin UI
 * language switch silently has no effect (the reload serves static HTML).
 */
test('every injected admin route declares prerender = false (so SSR reads cms-ui-locale)', () => {
  const pluginSrc = fs.readFileSync(path.join(ROOT, 'src', 'plugin', 'index.ts'), 'utf8');
  const injected = [...pluginSrc.matchAll(/resolveCms\(['"]admin\/([a-z0-9-]+\.astro)['"]\)/g)].map(
    (m) => m[1],
  );

  assert.ok(
    injected.length >= 11,
    `expected to find the injected admin routes, found ${injected.length}`,
  );

  const missing = injected.filter((file) => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin', file), 'utf8');
    return !/export\s+const\s+prerender\s*=\s*false/.test(src);
  });

  assert.deepEqual(
    missing,
    [],
    `Admin routes missing 'export const prerender = false' (they get prerendered in output:'static' and never read the cms-ui-locale cookie): ${missing.join(', ')}`,
  );
});
