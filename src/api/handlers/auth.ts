/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { AuthUser, User } from '../../types/index.js';
import * as data from '../data.js';
import { createToken, hashPassword, jwtSecretMisconfigured, verifyPassword } from './auth-core.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';

export async function handleLogin(request: Request): Promise<Response> {
  // Fail closed: refuse to issue tokens signed with the public fallback secret in production.
  if (jwtSecretMisconfigured()) {
    return jsonError(
      'Authentication is unavailable: the ASTRO_BLOCKS_JWT_SECRET environment variable must be set.',
      503,
    );
  }

  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return localizedJsonError(request, 'errors.emailPasswordRequired');

  const usersData = await data.loadUsers();
  let users = usersData.users || [];

  if (users.length === 0) {
    // First-user creation races against a concurrent bootstrap import
    // (GitHub #25): mutateUsers serializes on the users lock and re-reads
    // INSIDE it (check-and-write atomic), so neither path silently
    // overwrites the owner the other one just created/applied.
    // Hashed BEFORE the lock (#135, ADR-0030): hashPassword is deliberately slow, and this lock
    // is the one every login contends for. A raced bootstrap discards the work.
    const passwordHash = await hashPassword(password);

    const result = await data.mutateUsers((fresh) => {
      if (fresh.length !== 0) {
        return { kind: 'raced' as const, users: [...fresh] };
      }
      const id = data.generateId();
      const createdAt = new Date().toISOString();
      const newUser: User = { id, email, passwordHash, role: 'owner', tokenVersion: 1, createdAt };
      fresh.push(newUser);
      return { kind: 'created' as const, user: newUser };
    });

    if (result.kind === 'created') {
      const token = await createToken(result.user);
      return Response.json({
        token,
        user: { id: result.user.id, email: result.user.email, role: 'owner' },
      });
    }

    // Raced: a concurrent bootstrap import created the owner first. Fall
    // through to the shared find/verify path using the fresh users list.
    users = result.users;
  }

  const user = users.find((entry) => entry.email === email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return localizedJsonError(request, 'errors.invalidCredentials', 401);
  }

  const token = await createToken(user);
  return Response.json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

export async function handleAuthMe(user?: AuthUser | null, request?: Request): Promise<Response> {
  if (!user) {
    return request
      ? localizedJsonError(request, 'errors.unauthorized', 401)
      : jsonError('Unauthorized', 401);
  }
  return Response.json({ user });
}

export async function handleAuthStatus(): Promise<Response> {
  const [usersData, site] = await Promise.all([data.loadUsers(), data.loadSite()]);
  return Response.json({
    hasUsers: (usersData.users || []).length > 0,
    logo: site.logo || '',
    siteName: site.siteName || 'CMS',
  });
}
