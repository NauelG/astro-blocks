/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Tests for PR-4 Part B — API error localization.
 *
 * These tests verify that user-facing error messages returned by API handlers
 * are localized based on the cms-ui-locale cookie in the incoming request.
 * The wire shape { error: string } must remain unchanged.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles } from '../dist/api/data.js';
import {
  handleLogin,
  handlePostUsers,
  handlePutUser,
  handleDeleteUser,
  handlePostLanguages,
  handlePutLanguage,
  handleDeleteLanguage,
  handlePostMenus,
  handlePutMenu,
  handlePostConfigs,
  handlePutConfig,
  handlePostPages,
  handlePutPage,
  handlePostRedirects,
  handlePutRedirect,
  handleAuthMe,
  requireOwner,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-i18n-api-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function makeRequest(url, options = {}) {
  return new Request(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
}

function withUiLocale(locale, extraHeaders = {}) {
  return { Cookie: `cms-ui-locale=${locale}`, ...extraHeaders };
}

// ─── handleLogin — missing credentials ────────────────────────────────────────

test('handleLogin returns English error for missing credentials (no cookie)', async () => {
  await withTempProject(async () => {
    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string', 'error must be a string');
    // English: 'Email and password are required.'
    assert.match(body.error, /email/i);
    assert.doesNotMatch(body.error, /contraseña|obligatorio/i, 'Must not be Spanish');
  });
});

test('handleLogin returns Spanish error for missing credentials (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ email: '', password: '' }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string', 'error must be a string');
    // Spanish: 'Email y contraseña son obligatorios.'
    assert.match(body.error, /contraseña|obligatorio/i, 'Must be Spanish');
  });
});

test('handleLogin returns English error for invalid credentials (en cookie)', async () => {
  await withTempProject(async () => {
    // First create a user
    await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    }));

    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ email: 'admin@test.com', password: 'wrongpass' }),
    }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /credential/i, 'Must be English');
    assert.doesNotMatch(body.error, /credencial/i, 'Must not be Spanish');
  });
});

test('handleLogin returns Spanish error for invalid credentials (es cookie)', async () => {
  await withTempProject(async () => {
    // First create a user
    await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    }));

    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ email: 'admin@test.com', password: 'wrongpass' }),
    }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /credencial/i, 'Must be Spanish');
  });
});

// ─── handlePostUsers — email already exists ────────────────────────────────────

test('handlePostUsers returns English "email already exists" (en cookie)', async () => {
  await withTempProject(async () => {
    // Bootstrap owner
    await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    }));

    // First creation
    await handlePostUsers(makeRequest('http://localhost/cms/api/users', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ email: 'user@test.com', password: 'pass123', role: 'user' }),
    }), { role: 'owner' });

    // Duplicate
    const res = await handlePostUsers(makeRequest('http://localhost/cms/api/users', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ email: 'user@test.com', password: 'pass123', role: 'user' }),
    }), { role: 'owner' });

    const body = await res.json();
    assert.match(body.error, /email/i, 'Must mention email');
    assert.doesNotMatch(body.error, /existe|ya/i, 'Must be English');
  });
});

test('handlePostUsers returns Spanish "email already exists" (es cookie)', async () => {
  await withTempProject(async () => {
    // Bootstrap owner
    await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    }));

    // First creation
    await handlePostUsers(makeRequest('http://localhost/cms/api/users', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ email: 'user2@test.com', password: 'pass123', role: 'user' }),
    }), { role: 'owner' });

    // Duplicate
    const res = await handlePostUsers(makeRequest('http://localhost/cms/api/users', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ email: 'user2@test.com', password: 'pass123', role: 'user' }),
    }), { role: 'owner' });

    const body = await res.json();
    assert.match(body.error, /existe|ya/i, 'Must be Spanish');
  });
});

// ─── handlePostLanguages — language code required ─────────────────────────────

test('handlePostLanguages returns English error for missing code (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostLanguages(makeRequest('http://localhost/cms/api/languages', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ code: '', label: 'French' }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /code|required/i, 'Must be English');
    assert.doesNotMatch(body.error, /obligatorio/i, 'Must not be Spanish');
  });
});

test('handlePostLanguages returns Spanish error for missing code (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostLanguages(makeRequest('http://localhost/cms/api/languages', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ code: '', label: 'Francés' }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /obligatorio/i, 'Must be Spanish');
  });
});

// ─── handlePostMenus — selector required ──────────────────────────────────────

test('handlePostMenus returns English error for missing selector (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostMenus(makeRequest('http://localhost/cms/api/menus', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ name: 'Main', selector: '', items: [] }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /selector|required/i, 'Must be English');
    assert.doesNotMatch(body.error, /obligatorio/i, 'Must not be Spanish');
  });
});

test('handlePostMenus returns Spanish error for missing selector (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostMenus(makeRequest('http://localhost/cms/api/menus', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ name: 'Principal', selector: '', items: [] }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /obligatorio/i, 'Must be Spanish');
  });
});

// ─── handlePostConfigs — key required ─────────────────────────────────────────

test('handlePostConfigs returns English error for missing key (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostConfigs(makeRequest('http://localhost/cms/api/configs', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ key: '', value: 'val' }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /key|required/i, 'Must be English');
    assert.doesNotMatch(body.error, /clave|obligatoria/i, 'Must not be Spanish');
  });
});

test('handlePostConfigs returns Spanish error for missing key (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostConfigs(makeRequest('http://localhost/cms/api/configs', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ key: '', value: 'val' }),
    }));
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /clave|obligatoria/i, 'Must be Spanish');
  });
});

// ─── wire shape preserved ─────────────────────────────────────────────────────

test('error response wire shape is { error: string } — no extra fields from localization', async () => {
  await withTempProject(async () => {
    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ email: '', password: '' }),
    }));
    const body = await res.json();
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'error'), 'Must have error field');
    assert.ok(typeof body.error === 'string', 'error must be string');
    // May optionally have other fields from jsonError extra param, but must have error
  });
});

test('Accept-Language header falls back correctly when no cookie is present', async () => {
  await withTempProject(async () => {
    const res = await handleLogin(makeRequest('http://localhost/cms/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'es-MX,es;q=0.9' },
      body: JSON.stringify({ email: '', password: '' }),
    }));
    const body = await res.json();
    // Accept-Language es should produce Spanish error
    assert.match(body.error, /contraseña|obligatorio/i, 'Accept-Language es should yield Spanish error');
  });
});

// ─── parseJsonBody — invalid body localization ────────────────────────────────

test('parseJsonBody returns English error for invalid JSON body (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostRedirects(makeRequest('http://localhost/cms/api/redirects', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: 'not-json-at-all',
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string', 'error must be a string');
    assert.match(body.error, /invalid|body/i, 'Must be English invalid body message');
    assert.doesNotMatch(body.error, /inválido|solicitud/i, 'Must not be Spanish');
  });
});

test('parseJsonBody returns Spanish error for invalid JSON body (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostRedirects(makeRequest('http://localhost/cms/api/redirects', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: 'not-json-at-all',
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string', 'error must be a string');
    assert.match(body.error, /inválido|solicitud/i, 'Must be Spanish invalid body message');
  });
});

// ─── handlePostRedirects — path validation localization ───────────────────────

test('handlePostRedirects path validation returns English error for absolute URL (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostRedirects(makeRequest('http://localhost/cms/api/redirects', {
      method: 'POST',
      headers: withUiLocale('en'),
      body: JSON.stringify({ from: 'https://example.com/old', to: '/new' }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /internal|absolute/i, 'Must be English');
    assert.doesNotMatch(body.error, /interno|absoluta/i, 'Must not be Spanish');
  });
});

test('handlePostRedirects path validation returns Spanish error for absolute URL (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handlePostRedirects(makeRequest('http://localhost/cms/api/redirects', {
      method: 'POST',
      headers: withUiLocale('es'),
      body: JSON.stringify({ from: 'https://example.com/old', to: '/new' }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /interno|absoluta/i, 'Must be Spanish');
  });
});

// ─── handleAuthMe — unauthorized localization ─────────────────────────────────

test('handleAuthMe returns English error for unauthenticated (en cookie)', async () => {
  await withTempProject(async () => {
    const res = await handleAuthMe(null, makeRequest('http://localhost/cms/api/auth/me', {
      headers: withUiLocale('en'),
    }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /unauthorized/i, 'Must be English');
    assert.doesNotMatch(body.error, /autorizado/i, 'Must not be Spanish');
  });
});

test('handleAuthMe returns Spanish error for unauthenticated (es cookie)', async () => {
  await withTempProject(async () => {
    const res = await handleAuthMe(null, makeRequest('http://localhost/cms/api/auth/me', {
      headers: withUiLocale('es'),
    }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
    assert.match(body.error, /autorizado/i, 'Must be Spanish');
  });
});

// ─── requireOwner — forbidden localization ────────────────────────────────────

test('requireOwner returns English error when request is provided (en cookie)', async () => {
  await withTempProject(async () => {
    const request = makeRequest('http://localhost/cms/api/users', {
      headers: withUiLocale('en'),
    });
    const res = requireOwner({ id: '1', email: 'a@b.com', role: 'user' }, request);
    assert.ok(res !== null, 'Must return a response for non-owner');
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /forbidden/i, 'Must be English');
    assert.doesNotMatch(body.error, /denegado/i, 'Must not be Spanish');
  });
});

test('requireOwner returns Spanish error when request is provided (es cookie)', async () => {
  await withTempProject(async () => {
    const request = makeRequest('http://localhost/cms/api/users', {
      headers: withUiLocale('es'),
    });
    const res = requireOwner({ id: '1', email: 'a@b.com', role: 'user' }, request);
    assert.ok(res !== null, 'Must return a response for non-owner');
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /denegado/i, 'Must be Spanish');
  });
});
