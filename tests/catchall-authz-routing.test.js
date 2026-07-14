/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * catchall-authz-routing.test.js — router-level authorization + tier-equivalence
 * regression safety net for src/routes/api/catchall.ts (PR2 of the route-table-auth-gating
 * change, resolves #36 + #37).
 *
 * These tests drive the catchall dispatcher's exported GET/POST/PUT/PATCH/DELETE
 * functions directly (NOT the underlying src/api/handlers.ts business-logic handlers in
 * isolation) — same pattern as tests/catchall-media-routing.test.js. They are
 * CHARACTERIZATION tests: written and observed GREEN against the CURRENT if-chain
 * dispatcher, BEFORE the route-table + dispatch-swap implementation (PR3) lands. This
 * file makes ZERO production code changes — it is the regression proof that the #37
 * fragile owner gates (POST /languages, PUT /languages/:id, DELETE /languages/:id,
 * PUT /site) keep working, and it locks in the full 401 -> 403 -> 404 auth ladder
 * (auth resolved BEFORE any "not found" fallback — info-hiding) across every declared
 * auth tier (public / user / owner) so PR3's dispatch rewrite can be verified against
 * it as an acceptance gate.
 *
 * Auth model reminder (verified against catchall.ts + handlers.ts):
 *   - unauthenticated request                       -> 401
 *   - authenticated, non-owner, on an owner route    -> 403
 *   - authenticated, on an unmatched path             -> 404
 *   - UNauthenticated, on an unmatched path           -> 401 (never 404 — info-hiding)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';

import { ensureDefaultFiles, appendMediaEntry, generateId } from '../dist/api/data.js';
import { GET, POST, PUT, PATCH, DELETE } from '../dist/routes/api/catchall.js';

const JWT_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

/** Signs a JWT for the given role, matching handlers.ts's expected payload shape. */
async function makeToken(role) {
  return new SignJWT({ email: `${role}@example.com`, role })
    .setSubject(`${role}-user-id`)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

/**
 * These tests are about the auth ladder, not schema resolution — so the temp project must be
 * a WORKING one. Since ADR-0025 that means its block schema map resolves: under `node --test`
 * there is no `import.meta.env` bake, so it resolves from disk and the file must exist.
 * Without it every schema-dependent route 500s before auth is even the question.
 */
async function seedSchemaMap(tempRoot) {
  const dir = path.join(tempRoot, '.astro-blocks');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'schema-map.mjs'), 'export const schemaMap = {};\n', 'utf-8');
}

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-catchall-authz-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();
  await seedSchemaMap(tempRoot);
  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/** Minimal APIContext stub. cache disabled so handlers skip invalidation. */
function ctx(request) {
  return { request, cache: { enabled: false } };
}

/** Builds a Request, optionally with a Bearer token and a JSON body. */
function req(url, method, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Seed a real on-disk media entry (mirrors catchall-media-routing.test.js's seedEntry). */
async function seedEntry(
  tempRoot,
  { subdir = '2026/06', filename = 'cat.jpg', mimeType = 'image/jpeg' } = {},
) {
  const dir = path.join(tempRoot, 'public', 'uploads', subdir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  const url = `/uploads/${subdir}/${filename}`;
  const entry = {
    id: generateId(),
    url,
    filename,
    size: 4,
    mimeType,
    createdAt: new Date().toISOString(),
    status: 'ready',
  };
  await appendMediaEntry(entry);
  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════
// Group A — the 4 previously router-external, previously-fragile owner routes
// (#37 headline regression proof). Each: 401 unauth / 403 non-owner / owner-ok.
// If a future change drops or downgrades the `auth: owner` gate for any of
// these 4 routes, the non-owner-403 assertion below goes red — that is the
// regression guard.
// ═══════════════════════════════════════════════════════════════════════════

test('FRAGILE-POST-languages: 401 unauth, 403 non-owner, owner creates a language', async () => {
  await withTempProject(async () => {
    const unauth = await POST(ctx(req('http://localhost/cms/api/languages', 'POST')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await POST(
      ctx(
        req('http://localhost/cms/api/languages', 'POST', {
          token: userToken,
          body: { code: 'fr', label: 'Français' },
        }),
      ),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await POST(
      ctx(
        req('http://localhost/cms/api/languages', 'POST', {
          token: ownerToken,
          body: { code: 'fr', label: 'Français' },
        }),
      ),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.code, 'fr');
  });
});

test('FRAGILE-PUT-languages-id: 401 unauth, 403 non-owner, owner updates a language', async () => {
  await withTempProject(async () => {
    const unauth = await PUT(ctx(req('http://localhost/cms/api/languages/es', 'PUT')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await PUT(
      ctx(
        req('http://localhost/cms/api/languages/es', 'PUT', {
          token: userToken,
          body: { label: 'Hacked' },
        }),
      ),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await PUT(
      ctx(
        req('http://localhost/cms/api/languages/es', 'PUT', {
          token: ownerToken,
          body: { label: 'Español (ES)' },
        }),
      ),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.label, 'Español (ES)');
  });
});

test('FRAGILE-DELETE-languages-id: 401 unauth, 403 non-owner, owner deletes a language', async () => {
  await withTempProject(async () => {
    const unauth = await DELETE(ctx(req('http://localhost/cms/api/languages/es', 'DELETE')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await DELETE(
      ctx(req('http://localhost/cms/api/languages/es', 'DELETE', { token: userToken })),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    // Add a second language first so deleting 'es' does not hit the "cannot
    // delete the last language" business rule — that would mask the auth outcome.
    await POST(
      ctx(
        req('http://localhost/cms/api/languages', 'POST', {
          token: ownerToken,
          body: { code: 'en', label: 'English' },
        }),
      ),
    );
    const owner = await DELETE(
      ctx(req('http://localhost/cms/api/languages/es', 'DELETE', { token: ownerToken })),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.deletedLocale, 'es');
  });
});

test('FRAGILE-PUT-site: 401 unauth, 403 non-owner, owner updates site settings', async () => {
  await withTempProject(async () => {
    const unauth = await PUT(ctx(req('http://localhost/cms/api/site', 'PUT')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await PUT(
      ctx(
        req('http://localhost/cms/api/site', 'PUT', {
          token: userToken,
          body: { siteName: 'Hacked' },
        }),
      ),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await PUT(
      ctx(
        req('http://localhost/cms/api/site', 'PUT', {
          token: ownerToken,
          body: { siteName: 'Acme Corp' },
        }),
      ),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.siteName, 'Acme Corp');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group B — parity for the 6 previously-existing handler-internal owner routes
// (these already had a defense-in-depth requireOwner() call inside the handler;
// this proves the router-level dispatch to them is equally gated).
// ═══════════════════════════════════════════════════════════════════════════

test('OWNER-GET-export: 401 unauth, 403 non-owner, owner reaches the handler', async () => {
  await withTempProject(async () => {
    const unauth = await GET(ctx(req('http://localhost/cms/api/export', 'GET')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await GET(
      ctx(req('http://localhost/cms/api/export', 'GET', { token: userToken })),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await GET(
      ctx(req('http://localhost/cms/api/export?units=pages', 'GET', { token: ownerToken })),
    );
    assert.notEqual(owner.status, 401);
    assert.notEqual(owner.status, 403);
  });
});

test('OWNER-GET-users: 401 unauth, 403 non-owner, owner lists users', async () => {
  await withTempProject(async () => {
    const unauth = await GET(ctx(req('http://localhost/cms/api/users', 'GET')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await GET(
      ctx(req('http://localhost/cms/api/users', 'GET', { token: userToken })),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await GET(
      ctx(req('http://localhost/cms/api/users', 'GET', { token: ownerToken })),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.ok(Array.isArray(body.users));
  });
});

test('OWNER-POST-users: 401 unauth, 403 non-owner, owner creates a user', async () => {
  await withTempProject(async () => {
    const unauth = await POST(ctx(req('http://localhost/cms/api/users', 'POST')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await POST(
      ctx(
        req('http://localhost/cms/api/users', 'POST', {
          token: userToken,
          body: { email: 'x@example.com', password: 'secret123' },
        }),
      ),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await POST(
      ctx(
        req('http://localhost/cms/api/users', 'POST', {
          token: ownerToken,
          body: { email: 'editor@example.com', password: 'secret123' },
        }),
      ),
    );
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.email, 'editor@example.com');
  });
});

test('OWNER-PUT-users-id: 401 unauth, 403 non-owner, owner updates a user', async () => {
  await withTempProject(async () => {
    const ownerToken = await makeToken('owner');
    const created = await (
      await POST(
        ctx(
          req('http://localhost/cms/api/users', 'POST', {
            token: ownerToken,
            body: { email: 'editor@example.com', password: 'secret123' },
          }),
        ),
      )
    ).json();

    const unauth = await PUT(ctx(req(`http://localhost/cms/api/users/${created.id}`, 'PUT')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await PUT(
      ctx(
        req(`http://localhost/cms/api/users/${created.id}`, 'PUT', {
          token: userToken,
          body: { role: 'owner' },
        }),
      ),
    );
    assert.equal(nonOwner.status, 403);

    const owner = await PUT(
      ctx(
        req(`http://localhost/cms/api/users/${created.id}`, 'PUT', {
          token: ownerToken,
          body: { password: 'newpass456' },
        }),
      ),
    );
    assert.equal(owner.status, 200);
  });
});

test('OWNER-DELETE-users-id: 401 unauth, 403 non-owner, owner deletes a user', async () => {
  await withTempProject(async () => {
    const ownerToken = await makeToken('owner');
    const created = await (
      await POST(
        ctx(
          req('http://localhost/cms/api/users', 'POST', {
            token: ownerToken,
            body: { email: 'editor@example.com', password: 'secret123' },
          }),
        ),
      )
    ).json();

    const unauth = await DELETE(ctx(req(`http://localhost/cms/api/users/${created.id}`, 'DELETE')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await DELETE(
      ctx(req(`http://localhost/cms/api/users/${created.id}`, 'DELETE', { token: userToken })),
    );
    assert.equal(nonOwner.status, 403);

    const owner = await DELETE(
      ctx(req(`http://localhost/cms/api/users/${created.id}`, 'DELETE', { token: ownerToken })),
    );
    assert.equal(owner.status, 204);
  });
});

test('OWNER-POST-import: 401 unauth, 403 non-owner, owner reaches the handler', async () => {
  await withTempProject(async () => {
    const unauth = await POST(ctx(req('http://localhost/cms/api/import', 'POST')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const nonOwner = await POST(
      ctx(req('http://localhost/cms/api/import', 'POST', { token: userToken })),
    );
    assert.equal(nonOwner.status, 403);

    const ownerToken = await makeToken('owner');
    const owner = await POST(
      ctx(req('http://localhost/cms/api/import', 'POST', { token: ownerToken })),
    );
    assert.notEqual(owner.status, 401);
    assert.notEqual(owner.status, 403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group C — tier equivalence: at least one public route, one representative
// `user`-tier route per HTTP method, and the unknown-path 401/404 ladder
// (info-hiding: unauthenticated unknown path -> 401, never 404).
// ═══════════════════════════════════════════════════════════════════════════

test('PUBLIC-GET-auth-status: reachable with no token', async () => {
  await withTempProject(async () => {
    const res = await GET(ctx(req('http://localhost/cms/api/auth/status', 'GET')));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.hasUsers, 'boolean');
  });
});

test('PUBLIC-GET-auth-me: no token self-reports 401, valid token returns the user', async () => {
  await withTempProject(async () => {
    const noToken = await GET(ctx(req('http://localhost/cms/api/auth/me', 'GET')));
    assert.equal(noToken.status, 401);

    const token = await makeToken('user');
    const authed = await GET(ctx(req('http://localhost/cms/api/auth/me', 'GET', { token })));
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.equal(body.user.role, 'user');
  });
});

test('PUBLIC-POST-import-bootstrap: reachable with no token (zero-user gate is business logic, not auth)', async () => {
  await withTempProject(async () => {
    const res = await POST(
      ctx(req('http://localhost/cms/api/import/bootstrap', 'POST', { body: {} })),
    );
    assert.notEqual(res.status, 401, 'public route must never be blocked by the central auth gate');
  });
});

test('USER-GET-pages: 401 unauth, 200 for both user and owner roles', async () => {
  await withTempProject(async () => {
    const unauth = await GET(ctx(req('http://localhost/cms/api/pages', 'GET')));
    assert.equal(unauth.status, 401);

    const userToken = await makeToken('user');
    const asUser = await GET(
      ctx(req('http://localhost/cms/api/pages', 'GET', { token: userToken })),
    );
    assert.equal(asUser.status, 200);

    const ownerToken = await makeToken('owner');
    const asOwner = await GET(
      ctx(req('http://localhost/cms/api/pages', 'GET', { token: ownerToken })),
    );
    assert.equal(asOwner.status, 200, 'user-tier routes admit owner callers too');
  });
});

test('USER-POST-pages: 401 unauth, 200 authed creates a page', async () => {
  await withTempProject(async () => {
    const unauth = await POST(
      ctx(
        req('http://localhost/cms/api/pages', 'POST', {
          body: { title: 'Home', slug: '/', status: 'published', blocks: [] },
        }),
      ),
    );
    assert.equal(unauth.status, 401);

    const token = await makeToken('user');
    const authed = await POST(
      ctx(
        req('http://localhost/cms/api/pages', 'POST', {
          token,
          body: { title: 'Home', slug: '/', status: 'published', blocks: [] },
        }),
      ),
    );
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.equal(body.title, 'Home');
  });
});

test('USER-PUT-pages-id: 401 unauth, 200 authed updates the page', async () => {
  await withTempProject(async () => {
    const token = await makeToken('user');
    const created = await (
      await POST(
        ctx(
          req('http://localhost/cms/api/pages', 'POST', {
            token,
            body: { title: 'Home', slug: '/', status: 'published', blocks: [] },
          }),
        ),
      )
    ).json();

    const unauth = await PUT(
      ctx(
        req(`http://localhost/cms/api/pages/${created.id}`, 'PUT', {
          body: { title: 'Home Updated', slug: '/', status: 'published', blocks: [] },
        }),
      ),
    );
    assert.equal(unauth.status, 401);

    const authed = await PUT(
      ctx(
        req(`http://localhost/cms/api/pages/${created.id}`, 'PUT', {
          token,
          body: { title: 'Home Updated', slug: '/', status: 'published', blocks: [] },
        }),
      ),
    );
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.equal(body.title, 'Home Updated');
  });
});

test('USER-PATCH-media-id: 401 unauth, 200 authed updates media alt text', async () => {
  await withTempProject(async (tempRoot) => {
    const entry = await seedEntry(tempRoot);

    const unauth = await PATCH(
      ctx(req(`http://localhost/cms/api/media/${entry.id}`, 'PATCH', { body: { alt: 'x' } })),
    );
    assert.equal(unauth.status, 401);

    const token = await makeToken('user');
    const authed = await PATCH(
      ctx(
        req(`http://localhost/cms/api/media/${entry.id}`, 'PATCH', {
          token,
          body: { alt: 'A cat' },
        }),
      ),
    );
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.equal(body.entry.alt, 'A cat');
  });
});

test('USER-DELETE-pages-id: 401 unauth, 204 authed deletes the page', async () => {
  await withTempProject(async () => {
    const token = await makeToken('user');
    const created = await (
      await POST(
        ctx(
          req('http://localhost/cms/api/pages', 'POST', {
            token,
            body: { title: 'Temp', slug: '/temp', status: 'draft', blocks: [] },
          }),
        ),
      )
    ).json();

    const unauth = await DELETE(ctx(req(`http://localhost/cms/api/pages/${created.id}`, 'DELETE')));
    assert.equal(unauth.status, 401);

    const authed = await DELETE(
      ctx(req(`http://localhost/cms/api/pages/${created.id}`, 'DELETE', { token })),
    );
    assert.equal(authed.status, 204);
  });
});

// ─── Unknown-path ladder: info-hiding (401 before 404) ───────────────────────

test('LADDER-unknown-path: unauthenticated -> 401 (never 404), authenticated -> 404', async () => {
  await withTempProject(async () => {
    const unauth = await GET(ctx(req('http://localhost/cms/api/does-not-exist-xyz', 'GET')));
    assert.equal(
      unauth.status,
      401,
      'existence of a route must never be disclosed to an unauthenticated caller',
    );

    const token = await makeToken('user');
    const authed = await GET(
      ctx(req('http://localhost/cms/api/does-not-exist-xyz', 'GET', { token })),
    );
    assert.equal(
      authed.status,
      404,
      'only an authenticated caller can observe a 404 for an unmatched path',
    );
  });
});
