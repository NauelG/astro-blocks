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
    // (GitHub #25): serialize via withUsersLock and re-check INSIDE the
    // lock (check-and-write atomic) so neither path silently overwrites
    // the owner the other one just created/applied.
    const result = await data.withUsersLock(async () => {
      const fresh = await data.loadUsers();
      if ((fresh.users?.length ?? 0) !== 0) {
        return { kind: 'raced' as const, users: fresh.users || [] };
      }
      const id = data.generateId();
      const createdAt = new Date().toISOString();
      const passwordHash = await hashPassword(password);
      const newUser: User = { id, email, passwordHash, role: 'owner', createdAt };
      await data.saveUsers({ users: [newUser] });
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
