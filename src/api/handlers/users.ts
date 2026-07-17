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

  const usersData = await data.loadUsers();
  if (usersData.users.some((user) => user.email === email))
    return localizedJsonError(request, 'errors.emailExists');

  const createdAt = new Date().toISOString();
  const newUser: User = {
    id: data.generateId(),
    email,
    passwordHash: await hashPassword(password),
    role,
    tokenVersion: 1,
    createdAt,
  };

  usersData.users.push(newUser);
  await data.saveUsers(usersData);
  return Response.json({ id: newUser.id, email, role, createdAt });
}

export async function handlePutUser(
  id: string,
  request: Request,
  authUser?: AuthUser | null,
): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;

  if (body.role !== undefined) {
    const newRole = body.role === 'owner' ? 'owner' : 'user';
    if (target.role === 'owner' && newRole === 'user' && ownerCount <= 1) {
      return localizedJsonError(request, 'errors.cannotRemoveLastOwner', 400);
    }
    usersData.users[index] = { ...target, role: newRole };
  }

  if (typeof body.password === 'string' && body.password.length > 0) {
    const current = usersData.users[index];
    usersData.users[index] = {
      ...current,
      passwordHash: await hashPassword(body.password),
      // A password change revokes every live session for this user (ADR-0027, #124).
      tokenVersion: current.tokenVersion + 1,
    };
  }

  await data.saveUsers(usersData);
  const updated = usersData.users[index];
  return Response.json({
    id: updated.id,
    email: updated.email,
    role: updated.role,
    createdAt: updated.createdAt,
  });
}

export async function handleDeleteUser(
  id: string,
  authUser?: AuthUser | null,
  request?: Request,
): Promise<Response> {
  const forbidden = requireOwner(authUser, request);
  if (forbidden) return forbidden;

  const usersData = await data.loadUsers();
  const index = usersData.users.findIndex((user) => user.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  const target = usersData.users[index];
  const ownerCount = usersData.users.filter((user) => user.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) {
    return request
      ? localizedJsonError(request, 'errors.cannotDeleteLastOwner', 400)
      : jsonError('Cannot delete the only owner.', 400);
  }

  usersData.users.splice(index, 1);
  await data.saveUsers(usersData);
  return new Response(null, { status: 204 });
}
