/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthResult, AuthUser, User } from '../../types/index.js';
import { jsonError, localizedJsonError } from './shared.js';

// SECURITY: this constant signs and verifies admin session tokens. When no secret is
// configured we fall back to a well-known string ONLY to keep local development frictionless.
// Signing/verifying with a public constant in production would let anyone forge an owner
// token, so production refuses it (see classifyJwtSecret / jwtSecretMisconfigured below).
const INSECURE_JWT_FALLBACK = 'cms-jwt-secret-change-me';

export type JwtSecretStatus = 'configured' | 'insecure-dev' | 'insecure-production';

/**
 * Pure classification of the JWT secret configuration. Exported for unit testing.
 * - 'configured': a non-empty secret is present — safe in any environment.
 * - 'insecure-production': no secret AND running in production — auth must fail closed.
 * - 'insecure-dev': no secret outside production — tolerated with a loud warning.
 */
export function classifyJwtSecret(
  rawSecret: string | undefined,
  isProduction: boolean,
): JwtSecretStatus {
  if (rawSecret && rawSecret.trim()) return 'configured';
  return isProduction ? 'insecure-production' : 'insecure-dev';
}

/**
 * Whether the server is running as a production build. Uses Astro/Vite's build-time
 * `import.meta.env.PROD` (baked into the production SSR bundle) as the primary signal so the
 * guard fires even when the host does not set NODE_ENV; NODE_ENV==='production' is a secondary
 * signal for platforms that do. Outside a Vite build (e.g. unit tests importing raw dist),
 * `import.meta.env` is undefined and only NODE_ENV applies.
 */
function isProductionRuntime(): boolean {
  const viteEnv = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  return viteEnv?.PROD === true || process.env.NODE_ENV === 'production';
}

/**
 * Resolve the configured JWT secret from the environment. The documented, prefix-consistent
 * variable is ASTRO_BLOCKS_JWT_SECRET; CMS_JWT_SECRET is accepted as a deprecated legacy alias
 * (earlier releases read only that name while the docs specified the ASTRO_BLOCKS_ one, so
 * deployments that followed the docs were silently running on the built-in fallback).
 */
function resolveConfiguredJwtSecret(): string | undefined {
  const primary = process.env.ASTRO_BLOCKS_JWT_SECRET?.trim();
  if (primary) return primary;
  const legacy = process.env.CMS_JWT_SECRET?.trim();
  if (legacy) {
    console.warn(
      '[astro-blocks] CMS_JWT_SECRET is a deprecated alias and will be removed in a future release. ' +
        'Rename it to ASTRO_BLOCKS_JWT_SECRET.',
    );
    return legacy;
  }
  return undefined;
}

const CONFIGURED_JWT_SECRET = resolveConfiguredJwtSecret();
const JWT_SECRET_STATUS = classifyJwtSecret(CONFIGURED_JWT_SECRET, isProductionRuntime());
const JWT_SECRET = new TextEncoder().encode(CONFIGURED_JWT_SECRET || INSECURE_JWT_FALLBACK);
const JWT_EXPIRY = '7d';

if (JWT_SECRET_STATUS === 'insecure-production') {
  console.warn(
    '[astro-blocks] SECURITY: ASTRO_BLOCKS_JWT_SECRET is not set. Admin authentication is DISABLED — ' +
      'the server refuses to sign or verify tokens with the built-in fallback secret in production. ' +
      'Set ASTRO_BLOCKS_JWT_SECRET to a strong random value and restart.',
  );
} else if (JWT_SECRET_STATUS === 'insecure-dev') {
  console.warn(
    '[astro-blocks] SECURITY WARNING: ASTRO_BLOCKS_JWT_SECRET is not set; using an insecure built-in fallback. ' +
      'This is tolerated in development but MUST be set before deploying — otherwise anyone can forge an owner session token.',
  );
}

/**
 * True only when the secret is the insecure fallback AND we are in production. In that
 * state every auth operation fails closed rather than trusting a publicly-known key.
 */
export function jwtSecretMisconfigured(): boolean {
  return JWT_SECRET_STATUS === 'insecure-production';
}

function scryptAsync(password: string, salt: crypto.BinaryLike, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return scryptAsync(password, salt, 64).then(
    (hash) => `${salt.toString('base64')}:${hash.toString('base64')}`,
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !password) return false;

  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(derived, expected);
}

export async function createToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export async function getAuth(request: Request): Promise<AuthResult | null> {
  // Fail closed: never trust a token verified with the public fallback secret in production.
  if (jwtSecretMisconfigured()) return null;

  const token =
    request.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      ?.trim() ||
    request.headers.get('x-cms-token') ||
    '';

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const id = payload.sub;
    const email = payload.email;
    const role = payload.role;
    if (!id || !email || !role) return null;

    return { user: { id: String(id), email: String(email), role: String(role) } };
  } catch {
    return null;
  }
}

export function requireOwner(user?: AuthUser | null, request?: Request): Response | null {
  if (!user || user.role !== 'owner') {
    return request
      ? localizedJsonError(request, 'errors.forbidden', 403)
      : jsonError('Forbidden', 403);
  }
  return null;
}
