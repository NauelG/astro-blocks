/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadUsers, mutateUsers } from '../dist/api/data.js';
import {
  handleGetUsers,
  handlePostUsers,
  handlePutUser,
  handleDeleteUser,
  handleLogin,
  getAuth,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-users-'));

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

/**
 * Helper: seed one owner via the first-login path and return an AuthUser
 * shaped object so it can be passed directly to handler `authUser` params.
 */
async function seedOwner(email = 'owner@example.com', password = 'secret123') {
  const loginResponse = await handleLogin(
    new Request('http://localhost/cms/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const { user } = await loginResponse.json();
  return user; // { id, email, role }
}

// ─── handleGetUsers ───────────────────────────────────────────────────────────

test('handleGetUsers: owner receives list of users', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handleGetUsers(owner);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.users), 'users must be an array');
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].email, 'owner@example.com');
    assert.equal(body.users[0].role, 'owner');
    // passwordHash must NOT be leaked in the list
    assert.equal(body.users[0].passwordHash, undefined);
  });
});

test('handleGetUsers: unauthenticated (no user) returns 403', async () => {
  await withTempProject(async () => {
    const response = await handleGetUsers(null);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
  });
});

test('handleGetUsers: non-owner role returns 403', async () => {
  await withTempProject(async () => {
    const nonOwner = { id: 'abc', email: 'user@example.com', role: 'user' };
    const response = await handleGetUsers(nonOwner);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
  });
});

// ─── handlePostUsers ──────────────────────────────────────────────────────────

test('handlePostUsers: owner can create a new user', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456', role: 'user' }),
      }),
      owner,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.email, 'editor@example.com');
    assert.equal(body.role, 'user');
    assert.ok(typeof body.id === 'string' && body.id.length > 0);
    assert.equal(body.passwordHash, undefined);

    const stored = await loadUsers();
    assert.equal(stored.users.length, 2);
  });
});

test('handlePostUsers: unauthenticated returns 403', async () => {
  await withTempProject(async () => {
    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456' }),
      }),
      null,
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.match(body.error, /forbidden/i);
  });
});

test('handlePostUsers: duplicate email returns 400', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Create a second user.
    await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456' }),
      }),
      owner,
    );

    // Try to create another with the same email.
    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass789' }),
      }),
      owner,
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Email already exists.');
  });
});

test('handlePostUsers: missing email/password returns 400', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '', password: '' }),
      }),
      owner,
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Email and password are required.');
  });
});

test('handlePostUsers: malformed email returns 400, localized', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '<img src=x onerror=alert(1)>', password: 'pass456' }),
      }),
      owner,
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid email address.');

    const spanish = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'es',
        },
        body: JSON.stringify({ email: 'not-an-email', password: 'pass456' }),
      }),
      owner,
    );

    assert.equal(spanish.status, 400);
    const spanishBody = await spanish.json();
    assert.equal(spanishBody.error, 'Dirección de email no válida.');

    // Nothing was stored.
    const usersData = await loadUsers();
    assert.equal(usersData.users.length, 1);
  });
});

test('handlePostUsers: email over 254 characters returns 400', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();
    const email = `${'a'.repeat(64)}@${'b'.repeat(61)}.${'c'.repeat(61)}.${'d'.repeat(61)}.example.com`;
    assert.ok(email.length > 254);

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'pass456' }),
      }),
      owner,
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid email address.');
  });
});

test('handlePostUsers: unknown role defaults to "user"', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'guest@example.com', password: 'pass456', role: 'admin' }),
      }),
      owner,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    // Any role other than 'owner' is stored as 'user'.
    assert.equal(body.role, 'user');
  });
});

// ─── handlePutUser ────────────────────────────────────────────────────────────

test('handlePutUser: owner can change another user role', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Create a secondary user.
    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456', role: 'user' }),
      }),
      owner,
    );
    const created = await createResponse.json();

    // Promote the secondary user to owner.
    const putResponse = await handlePutUser(
      created.id,
      new Request(`http://localhost/cms/api/users/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      }),
      owner,
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.role, 'owner');
    assert.equal(updated.email, 'editor@example.com');
  });
});

test('handlePutUser: unauthenticated returns 403', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456' }),
      }),
      owner,
    );
    const created = await createResponse.json();

    const response = await handlePutUser(
      created.id,
      new Request(`http://localhost/cms/api/users/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      }),
      null,
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.match(body.error, /forbidden/i);
  });
});

test('handlePutUser: returns 404 for unknown user id', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePutUser(
      'nonexistent-id',
      new Request('http://localhost/cms/api/users/nonexistent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user' }),
      }),
      owner,
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error, 'should include error message');
  });
});

test('handlePutUser: cannot demote the sole owner', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Attempt to demote the only owner to 'user'.
    const response = await handlePutUser(
      owner.id,
      new Request(`http://localhost/cms/api/users/${owner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user' }),
      }),
      owner,
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Cannot remove the only owner.');
  });
});

test('handlePutUser: owner can change a user password', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Create a secondary user.
    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'oldpass' }),
      }),
      owner,
    );
    const created = await createResponse.json();

    const putResponse = await handlePutUser(
      created.id,
      new Request(`http://localhost/cms/api/users/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'newpass456' }),
      }),
      owner,
    );

    assert.equal(putResponse.status, 200);

    // Verify the new password works.
    const loginResponse = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'newpass456' }),
      }),
    );
    assert.equal(loginResponse.status, 200);
  });
});

// ─── handleDeleteUser ─────────────────────────────────────────────────────────

test('handleDeleteUser: owner can delete another user', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Create a secondary user to delete.
    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456' }),
      }),
      owner,
    );
    const created = await createResponse.json();

    const deleteResponse = await handleDeleteUser(created.id, owner);

    assert.equal(deleteResponse.status, 204);

    const stored = await loadUsers();
    assert.equal(stored.users.length, 1);
    assert.equal(stored.users[0].email, 'owner@example.com');
  });
});

test('handleDeleteUser: unauthenticated returns 403', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass456' }),
      }),
      owner,
    );
    const created = await createResponse.json();

    const response = await handleDeleteUser(created.id, null);

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
  });
});

test('handleDeleteUser: returns 404 for unknown user id', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handleDeleteUser('nonexistent-id', owner);

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handleDeleteUser: cannot delete the sole owner', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handleDeleteUser(owner.id, owner);

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Cannot delete the only owner.');
  });
});

test('handleDeleteUser: can delete an owner when another owner exists', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Promote a second user to owner.
    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner2@example.com', password: 'pass456', role: 'owner' }),
      }),
      owner,
    );
    const secondOwner = await createResponse.json();

    // Now deleting the first owner is allowed because a second owner exists.
    const deleteResponse = await handleDeleteUser(owner.id, owner);

    assert.equal(deleteResponse.status, 204);

    const stored = await loadUsers();
    assert.equal(stored.users.length, 1);
    assert.equal(stored.users[0].id, secondOwner.id);
  });
});

// ─── tokenVersion (session revocation, #124 / ADR-0027) ────────────────────────

test('handlePostUsers: new user is created with tokenVersion 1', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', password: 'pass456', role: 'user' }),
      }),
      owner,
    );
    assert.equal(response.status, 200);

    const stored = await loadUsers();
    const created = stored.users.find((u) => u.email === 'new@example.com');
    assert.ok(created, 'user must be persisted');
    assert.equal(created.tokenVersion, 1);
  });
});

test('handlePutUser: changing the password bumps tokenVersion', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    const before = await loadUsers();
    const initial = before.users[0].tokenVersion ?? 1;

    const response = await handlePutUser(
      owner.id,
      new Request(`http://localhost/cms/api/users/${owner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'brand-new-pass' }),
      }),
      owner,
    );
    assert.equal(response.status, 200);

    const after = await loadUsers();
    assert.equal(after.users[0].tokenVersion, initial + 1);
  });
});

test('handlePutUser: a role change alone does not bump tokenVersion', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    // Second owner so the first can be demoted without hitting the last-owner guard.
    const createResponse = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner2@example.com', password: 'pass456', role: 'owner' }),
      }),
      owner,
    );
    const secondOwner = await createResponse.json();

    const before = await loadUsers();
    const target = before.users.find((u) => u.id === secondOwner.id);
    const initial = target.tokenVersion ?? 1;

    await handlePutUser(
      secondOwner.id,
      new Request(`http://localhost/cms/api/users/${secondOwner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user' }),
      }),
      owner,
    );

    const after = await loadUsers();
    const updated = after.users.find((u) => u.id === secondOwner.id);
    assert.equal(updated.role, 'user');
    assert.equal(updated.tokenVersion, initial, 'demotion must not revoke the session');
  });
});

// ─── #135: every users.json mutation is serialized (ADR-0030) ─────────────────
//
// The interleave is deterministic, not hoped for. hashPassword is deliberately slow — orders of
// magnitude slower than the fs read around it — so two concurrent password changes always overlap:
// both load the same list, both hash, both write the whole list. Before the fix exactly one bump
// survived, whichever wrote last. Do not weaken these into a loop of N attempts.

const FALLBACK_SECRET = new TextEncoder().encode('cms-jwt-secret-change-me');

async function seedUser(owner, email, role = 'user') {
  const res = await handlePostUsers(
    new Request('http://localhost/cms/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'secret123', role }),
    }),
    owner,
  );
  return (await res.json()).id;
}

function putUser(id, body, owner) {
  return handlePutUser(
    id,
    new Request(`http://localhost/cms/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    owner,
  );
}

async function mintToken(id, tokenVersion) {
  const { SignJWT } = await import('jose');
  return new SignJWT({ tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setExpirationTime('7d')
    .sign(FALLBACK_SECRET);
}

function authRequest(token) {
  return new Request('http://localhost/cms/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
}

test('#135: concurrent password changes both keep their revocation bump', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();
    const a = await seedUser(owner, 'a@example.com');
    const b = await seedUser(owner, 'b@example.com');

    await Promise.all([
      putUser(a, { password: 'new-password-a' }, owner),
      putUser(b, { password: 'new-password-b' }, owner),
    ]);

    const { users } = await loadUsers();
    const va = users.find((u) => u.id === a).tokenVersion;
    const vb = users.find((u) => u.id === b).tokenVersion;
    assert.equal(va, 2, `user a's bump was lost (tokenVersion ${va})`);
    assert.equal(vb, 2, `user b's bump was lost (tokenVersion ${vb})`);
  });
});

test('#135: a lost bump would leave a revoked token valid', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();
    const a = await seedUser(owner, 'a@example.com');
    const b = await seedUser(owner, 'b@example.com');

    // Tokens minted at the pre-change generation. Both password changes must revoke them.
    const staleA = await mintToken(a, 1);
    const staleB = await mintToken(b, 1);

    await Promise.all([
      putUser(a, { password: 'new-password-a' }, owner),
      putUser(b, { password: 'new-password-b' }, owner),
    ]);

    // Asserting the counter alone would pass even if getAuth stopped consulting the store.
    // The revocation is about the session, not the number.
    assert.equal(await getAuth(authRequest(staleA)), null, "user a's session survived the change");
    assert.equal(await getAuth(authRequest(staleB)), null, "user b's session survived the change");
  });
});

test('#135: concurrent creates both persist', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();

    await Promise.all([seedUser(owner, 'one@example.com'), seedUser(owner, 'two@example.com')]);

    const { users } = await loadUsers();
    const emails = users.map((u) => u.email);
    assert.ok(emails.includes('one@example.com'), 'first create was lost');
    assert.ok(emails.includes('two@example.com'), 'second create was lost');
  });
});

test('#135: a concurrent delete and update discard neither', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();
    const a = await seedUser(owner, 'a@example.com');
    const b = await seedUser(owner, 'b@example.com');

    await Promise.all([
      handleDeleteUser(a, owner, new Request(`http://localhost/cms/api/users/${a}`)),
      putUser(b, { password: 'new-password-b' }, owner),
    ]);

    const { users } = await loadUsers();
    assert.equal(
      users.find((u) => u.id === a),
      undefined,
      'the delete was lost',
    );
    assert.equal(users.find((u) => u.id === b).tokenVersion, 2, "b's password change was lost");
  });
});

test('#135: concurrent demotion and deletion leave at least one owner', async () => {
  await withTempProject(async () => {
    const owner = await seedOwner();
    const second = await seedUser(owner, 'second@example.com', 'owner');

    await Promise.all([
      putUser(owner.id, { role: 'user' }, owner),
      handleDeleteUser(second, owner, new Request(`http://localhost/cms/api/users/${second}`)),
    ]);

    const { users } = await loadUsers();
    const owners = users.filter((u) => u.role === 'owner');
    assert.ok(owners.length >= 1, 'the instance was left with no owner');
  });
});

test('#135: mutateUsers preserves unknown top-level keys in users.json', async () => {
  await withTempProject(async (tempRoot) => {
    // loadUsers spreads `...data` and restoreUsers spreads `...restored`, both deliberately: an
    // unknown top-level field survives a read and a restore. A mutation must not be the one path
    // that silently destroys it.
    const usersPath = path.join(tempRoot, 'data', 'users.json');
    await fs.writeFile(
      usersPath,
      JSON.stringify({ schemaNote: 'keep me', users: [] }, null, 2),
      'utf-8',
    );

    await mutateUsers((users) => {
      users.push({
        id: 'u1',
        email: 'u1@example.com',
        passwordHash: 'c2FsdA==:aGFzaA==',
        role: 'owner',
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
      });
    });

    const raw = JSON.parse(await fs.readFile(usersPath, 'utf-8'));
    assert.equal(raw.schemaNote, 'keep me', 'an unknown top-level key was dropped by the mutation');
    assert.equal(raw.users.length, 1, 'the mutation itself must still apply');
  });
});
