/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SignJWT } from 'jose';

import { ensureDefaultFiles, loadUsers, saveUsers } from '../dist/api/data.js';
import {
  handleLogin,
  handleAuthMe,
  handleAuthStatus,
  handleGetUsers,
  getAuth,
} from '../dist/api/handlers.js';

// The dev/test fallback signing secret (auth-core.ts INSECURE_JWT_FALLBACK). getAuth verifies
// with it when ASTRO_BLOCKS_JWT_SECRET is unset, so tokens forged here round-trip through it.
const FALLBACK_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function loginOwner(email = 'owner@example.com', password = 'secret123') {
  const res = await handleLogin(
    new Request('http://localhost/cms/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const body = await res.json();
  return { token: body.token, user: body.user };
}

function authRequest(token) {
  return new Request('http://localhost/cms/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
}

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

// ─── getAuth: stateful session revocation (#124, ADR-0027) ─────────────────────

test('getAuth: token of a deleted user is rejected (null)', async () => {
  await withTempProject(async () => {
    const { token } = await loginOwner();

    // The user is removed from the store after the token was issued.
    await saveUsers({ users: [] });

    const result = await getAuth(authRequest(token));
    assert.equal(result, null);
  });
});

test('getAuth: token is rejected once tokenVersion is bumped (revoked)', async () => {
  await withTempProject(async () => {
    const { token } = await loginOwner();

    const stored = await loadUsers();
    stored.users[0].tokenVersion = (stored.users[0].tokenVersion ?? 1) + 1;
    await saveUsers(stored);

    const result = await getAuth(authRequest(token));
    assert.equal(result, null);
  });
});

test('getAuth: legacy token without a tokenVersion claim is rejected', async () => {
  await withTempProject(async () => {
    const { user } = await loginOwner();

    // A token shaped like the pre-revocation model: email + role, no tokenVersion.
    const legacy = await new SignJWT({ email: user.email, role: 'owner' })
      .setSubject(user.id)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(FALLBACK_SECRET);

    const result = await getAuth(authRequest(legacy));
    assert.equal(result, null);
  });
});

test('getAuth: role is resolved fresh from the store, not the token', async () => {
  await withTempProject(async () => {
    const { token } = await loginOwner(); // issued while role === 'owner'

    // Demote directly in the store (bypassing the last-owner guard, which is not under test).
    const stored = await loadUsers();
    stored.users[0] = { ...stored.users[0], role: 'user' };
    await saveUsers(stored);

    const result = await getAuth(authRequest(token));
    assert.ok(result, 'a valid token must still authenticate');
    assert.equal(result.user.role, 'user', 'role must come from the store, not the stale token');
  });
});

test('getAuth: demoted-owner token fails requireOwner (403) but still authenticates', async () => {
  await withTempProject(async () => {
    const { token } = await loginOwner();

    const stored = await loadUsers();
    stored.users[0] = { ...stored.users[0], role: 'user' };
    await saveUsers(stored);

    const auth = await getAuth(authRequest(token));
    assert.ok(auth, 'still a valid session');
    const response = await handleGetUsers(auth.user); // owner-only route
    assert.equal(response.status, 403);
  });
});

test('getAuth: legacy record without a tokenVersion field defaults to 1 and passes', async () => {
  await withTempProject(async () => {
    // A record persisted before the field existed — no tokenVersion.
    await saveUsers({
      users: [
        {
          id: 'legacy-1',
          email: 'legacy@example.com',
          passwordHash: 'c2FsdA==:aGFzaA==',
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const token = await new SignJWT({ tokenVersion: 1 })
      .setSubject('legacy-1')
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(FALLBACK_SECRET);

    const result = await getAuth(authRequest(token));
    assert.ok(result, 'a v1 token must match a fieldless record read as v1');
    assert.equal(result.user.id, 'legacy-1');
    assert.equal(result.user.email, 'legacy@example.com');
    assert.equal(result.user.role, 'owner');
  });
});

// ─── tokenVersion normalization at the store boundary ─────────────────────────
//
// The tests above forge their tokens with SignJWT, which skips createToken — the one reader of
// user.tokenVersion that never defaulted the field. These cross handleLogin -> createToken ->
// getAuth for real, which is the only way the lockout is visible.

test('handleLogin: a legacy record without tokenVersion yields a token getAuth accepts', async () => {
  await withTempProject(async () => {
    await loginOwner(); // bootstrap, so the record carries a real passwordHash

    // A record persisted before ADR-0027 existed.
    const stored = await loadUsers();
    delete stored.users[0].tokenVersion;
    await saveUsers(stored);

    const { token } = await loginOwner();
    const result = await getAuth(authRequest(token));

    assert.ok(result, 'a legacy record must authenticate through the real login path');
    assert.equal(result.user.role, 'owner');
  });
});

test('handleLogin: a record with a malformed tokenVersion yields a token getAuth accepts', async () => {
  await withTempProject(async () => {
    await loginOwner();

    // A hand-edited file or a restored archive: the store casts JSON without validating.
    const stored = await loadUsers();
    stored.users[0].tokenVersion = '3';
    await saveUsers(stored);

    const { token } = await loginOwner();
    const result = await getAuth(authRequest(token));

    assert.ok(result, 'a malformed generation must read as 1, not lock the user out forever');
    assert.equal(result.user.role, 'owner');
  });
});

test('loadUsers: normalizes absent and malformed tokenVersion to 1', async () => {
  await withTempProject(async () => {
    // NaN does not survive JSON.stringify (it serializes to null). Both land on the invalid
    // branch, so the assertion is about the intent, not the on-disk form.
    const cases = [
      { name: 'absent', stored: undefined, expected: 1 },
      { name: 'string', stored: '3', expected: 1 },
      { name: 'NaN', stored: NaN, expected: 1 },
      { name: 'zero', stored: 0, expected: 1 },
      { name: 'negative', stored: -5, expected: 1 },
      { name: 'fractional', stored: 1.5, expected: 1 },
      { name: 'valid', stored: 3, expected: 3 },
    ];

    for (const { name, stored, expected } of cases) {
      const record = {
        id: 'u1',
        email: 'u1@example.com',
        passwordHash: 'c2FsdA==:aGFzaA==',
        role: 'owner',
        createdAt: new Date().toISOString(),
      };
      if (stored !== undefined) record.tokenVersion = stored;
      await saveUsers({ users: [record] });

      const { users } = await loadUsers();
      assert.equal(users[0].tokenVersion, expected, `${name} must read as ${expected}`);
    }
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
