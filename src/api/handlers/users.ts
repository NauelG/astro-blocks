/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { AuthUser, User } from '../../types/index.js';
import * as data from '../data.js';
import { hashPassword, requireOwner } from './auth-core.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';

export async function handleGetUsers(user?: AuthUser | null): Promise<Response> {
  const forbidden = requireOwner(user);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const list = (usersData.users || []).map(({ id, email, role, createdAt }) => ({
    id,
    email,
    role,
    createdAt,
  }));
  return Response.json({ users: list });
}

export async function handlePostUsers(
  request: Request,
  authUser?: AuthUser | null,
): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'owner' ? 'owner' : 'user';
  if (!email || !password) return localizedJsonError(request, 'errors.emailPasswordRequired');

  // Hash BEFORE the lock (#135, ADR-0030): hashPassword is deliberately slow, and holding the
  // users lock across it would block every login. A duplicate email discards this work — that is
  // the accepted cost of keeping the critical section short.
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  return data.mutateUsers((users) => {
    // Re-checked against the in-lock list, not the pre-lock read: serializing the write without
    // re-validating would move the lost update and leave the check-then-act intact.
    if (users.some((user) => user.email === email))
      return localizedJsonError(request, 'errors.emailExists');

    const newUser: User = {
      id: data.generateId(),
      email,
      passwordHash,
      role,
      tokenVersion: 1,
      createdAt,
    };
    users.push(newUser);
    return Response.json({ id: newUser.id, email, role, createdAt });
  });
}

export async function handlePutUser(
  id: string,
  request: Request,
  authUser?: AuthUser | null,
): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  // Hashed before the lock (#135, ADR-0030) — see handlePostUsers. A 404 discards it.
  const passwordHash =
    typeof body.password === 'string' && body.password.length > 0
      ? await hashPassword(body.password)
      : undefined;

  return data.mutateUsers((users) => {
    // Existence and the last-owner rule are evaluated against the in-lock list.
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

    const target = users[index];
    const ownerCount = users.filter((user) => user.role === 'owner').length;

    if (body.role !== undefined) {
      const newRole = body.role === 'owner' ? 'owner' : 'user';
      if (target.role === 'owner' && newRole === 'user' && ownerCount <= 1) {
        return localizedJsonError(request, 'errors.cannotRemoveLastOwner', 400);
      }
      users[index] = { ...target, role: newRole };
    }

    if (passwordHash) {
      const current = users[index];
      users[index] = {
        ...current,
        passwordHash,
        // A password change revokes every live session for this user (ADR-0027, #124). The
        // increment is applied to the freshly re-read record, so a concurrent write to another
        // user cannot discard it (#135).
        tokenVersion: current.tokenVersion + 1,
      };
    }

    const updated = users[index];
    return Response.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      createdAt: updated.createdAt,
    });
  });
}

export async function handleDeleteUser(
  id: string,
  authUser?: AuthUser | null,
  request?: Request,
): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  return data.mutateUsers((users) => {
    // Existence and the last-owner rule are evaluated against the in-lock list (#135, ADR-0030).
    const index = users.findIndex((user) => user.id === id);
    if (index === -1)
      return request
        ? localizedJsonError(request, 'errors.notFound', 404)
        : jsonError('Not found', 404);

    const target = users[index];
    const ownerCount = users.filter((user) => user.role === 'owner').length;
    if (target.role === 'owner' && ownerCount <= 1) {
      return request
        ? localizedJsonError(request, 'errors.cannotDeleteLastOwner', 400)
        : jsonError('Cannot delete the only owner.', 400);
    }

    users.splice(index, 1);
    return new Response(null, { status: 204 });
  });
}
