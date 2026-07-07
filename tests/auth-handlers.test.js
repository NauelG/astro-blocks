/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadUsers } from '../dist/api/data.js';
import { handleLogin, handleAuthMe, handleAuthStatus } from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-auth-'));

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

// ─── handleLogin ─────────────────────────────────────────────────────────────

test('handleLogin: first login creates owner and returns token + user', async () => {
  await withTempProject(async () => {
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(
      typeof body.token === 'string' && body.token.length > 0,
      'token must be a non-empty string',
    );
    assert.equal(body.user.email, 'admin@example.com');
    assert.equal(body.user.role, 'owner');
    assert.ok(
      typeof body.user.id === 'string' && body.user.id.length > 0,
      'user id must be present',
    );

    // The user must be persisted so subsequent logins can verify the password.
    const stored = await loadUsers();
    assert.equal(stored.users.length, 1);
    assert.equal(stored.users[0].email, 'admin@example.com');
    assert.equal(stored.users[0].role, 'owner');
  });
});

test('handleLogin: successful login after user already exists returns token + user', async () => {
  await withTempProject(async () => {
    // Seed a user via the first-login path.
    await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    // Log in again with valid credentials.
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(typeof body.token === 'string' && body.token.length > 0);
    assert.equal(body.user.email, 'admin@example.com');
  });
});

test('handleLogin: bad password returns 401', async () => {
  await withTempProject(async () => {
    // Create the first user.
    await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    // Try with a wrong password.
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'wrongpassword' }),
      }),
    );

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'Invalid credentials.');
  });
});

test('handleLogin: unknown email after users exist returns 401', async () => {
  await withTempProject(async () => {
    // Seed a user.
    await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    // Try with an email that was never registered.
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'secret123' }),
      }),
    );

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'Invalid credentials.');
  });
});

test('handleLogin: missing email or password returns 400', async () => {
  await withTempProject(async () => {
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '', password: '' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Email and password are required.');
  });
});

test('handleLogin: email is normalized to lowercase', async () => {
  await withTempProject(async () => {
    // First login with mixed-case email.
    await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'Admin@Example.COM', password: 'secret123' }),
      }),
    );

    const stored = await loadUsers();
    // The email stored must be lowercase.
    assert.equal(stored.users[0].email, 'admin@example.com');

    // Second login with lowercase should succeed.
    const response = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    assert.equal(response.status, 200);
  });
});

// ─── handleAuthMe ─────────────────────────────────────────────────────────────

test('handleAuthMe: returns user when authenticated', async () => {
  await withTempProject(async () => {
    const user = { id: 'abc123', email: 'owner@example.com', role: 'owner' };
    const response = await handleAuthMe(user);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.user, user);
  });
});

test('handleAuthMe: returns 401 when user is null', async () => {
  await withTempProject(async () => {
    const response = await handleAuthMe(null);

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'Unauthorized');
  });
});

test('handleAuthMe: returns 401 when user is undefined', async () => {
  await withTempProject(async () => {
    const response = await handleAuthMe(undefined);

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'Unauthorized');
  });
});

// ─── handleAuthStatus ─────────────────────────────────────────────────────────

test('handleAuthStatus: returns hasUsers=false on fresh project', async () => {
  await withTempProject(async () => {
    const response = await handleAuthStatus();

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hasUsers, false);
    assert.equal(typeof body.siteName, 'string');
    assert.ok(body.siteName.length > 0, 'siteName must not be empty');
    assert.equal(typeof body.logo, 'string');
  });
});

test('handleAuthStatus: returns hasUsers=true after a user is created', async () => {
  await withTempProject(async () => {
    // Create the first user through login.
    await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );

    const response = await handleAuthStatus();

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hasUsers, true);
  });
});
