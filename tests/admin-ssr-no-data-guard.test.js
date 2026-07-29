/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * admin-ssr-no-data-guard.test.js — an admin page ships no content data (R7, ADR-0037).
 *
 * An admin `.astro` may call `loadSite()` and nothing else. Its content reaches the browser through
 * `/cms/api/*`, which authenticates every request, and through no other path.
 *
 * WHY THIS IS A RULE ABOUT DATA AND NOT A GUARD. `getAuth` reads its token from the Authorization /
 * x-cms-token HEADER, and the client keeps it in sessionStorage. Neither travels with a page
 * navigation — a browser sends cookies. So the server has no credential to check when someone asks
 * for an admin page: a page-level auth check is not merely missing, it is not expressible without
 * first issuing a session cookie, which would forfeit the header-only property the API's CSRF
 * posture rests on. The fix is therefore to remove the data, not to gate it.
 *
 * `loadSite` is the sole exception, deliberately: site.json holds public branding (name, baseUrl,
 * favicon, logo, colours, default SEO) that the public site already renders, and keeping it
 * server-side is what lets the shell paint branded with no unstyled flash.
 *
 * WHAT THIS GUARD CANNOT DO. It is lexical. It proves no page *calls* a loader; it does not prove
 * the emitted HTML is clean — a page that obtained data some other way would pass. The behavioural
 * half is e2e/admin-ssr-no-data.spec.ts. Same division of labour as R4 (static) and R5
 * (behavioural) in admin-html-rendering.md.
 *
 * Scope is DISCOVERED, never hardcoded, so a page added later is covered the day it lands.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_DIR = join(ROOT, 'src', 'routes', 'admin');

/**
 * Any `await load…(` whose loader is not exactly `loadSite`. The negative lookahead needs the word
 * boundary so a future `loadSiteSomething()` is still caught.
 */
const FORBIDDEN_LOADER = /\bawait\s+(load(?!Site\b)[A-Z]\w*)\s*\(/g;

/** Admin page files — the `.astro` at the top level of routes/admin (layout included). */
function collectAdminPages(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
    .map((entry) => join(dir, entry.name));
}

/** Strip // line and block comments so a commented-out loader does not trip the guard. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const pages = collectAdminPages(ADMIN_DIR).sort();

test('the guard actually found admin pages to check', () => {
  // A discovery bug that silently matched nothing would make every test below vacuously pass.
  assert.ok(pages.length >= 10, `expected the admin page set, found ${pages.length}`);
});

for (const abs of pages) {
  const rel = relative(ROOT, abs).split('\\').join('/');

  test(`${rel} — R7: server-renders no content data`, () => {
    const stripped = stripComments(readFileSync(abs, 'utf8'));
    const found = [...stripped.matchAll(FORBIDDEN_LOADER)].map((m) => m[1]);

    assert.deepEqual(
      [...new Set(found)],
      [],
      `${rel} calls ${[...new Set(found)].join(', ')} in its frontmatter. An admin page may load ` +
        'loadSite() and nothing else (R7, ADR-0037): this HTML is served to anyone, because the ' +
        'session token lives in a header and sessionStorage and never reaches the server on a page ' +
        'navigation. Fetch this data from /cms/api/* in a client/ module, which authenticates.',
    );
  });
}
