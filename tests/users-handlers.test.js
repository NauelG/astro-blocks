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
import {
  handleGetUsers,
  handlePostUsers,
  handlePutUser,
  handleDeleteUser,
  handleLogin,
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
    })
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
      owner
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
      null
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
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
      owner
    );

    // Try to create another with the same email.
    const response = await handlePostUsers(
      new Request('http://localhost/cms/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'pass789' }),
      }),
      owner
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Email already exists');
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
      owner
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Email and password required');
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
      owner
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
      owner
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
      owner
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
      owner
    );
    const created = await createResponse.json();

    const response = await handlePutUser(
      created.id,
      new Request(`http://localhost/cms/api/users/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      }),
      null
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
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
      owner
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
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
      owner
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'No se puede quitar el único propietario');
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
      owner
    );
    const created = await createResponse.json();

    const putResponse = await handlePutUser(
      created.id,
      new Request(`http://localhost/cms/api/users/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'newpass456' }),
      }),
      owner
    );

    assert.equal(putResponse.status, 200);

    // Verify the new password works.
    const loginResponse = await handleLogin(
      new Request('http://localhost/cms/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'editor@example.com', password: 'newpass456' }),
      })
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
      owner
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
      owner
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
    assert.equal(body.error, 'No se puede eliminar al único propietario');
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
      owner
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
