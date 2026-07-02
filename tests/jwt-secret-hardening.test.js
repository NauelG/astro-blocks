/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyJwtSecret } from '../dist/api/handlers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Run `fn` with a throwaway project root so a bootstrapped owner account is written to an
// isolated temp dir (not the repo's ./data), then always clean it up.
function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-blocks-jwt-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ─── Pure decision logic ──────────────────────────────────────────────────────

test('classifyJwtSecret: a non-empty secret is accepted in any environment', () => {
  assert.equal(classifyJwtSecret('a-real-secret', true), 'configured');
  assert.equal(classifyJwtSecret('a-real-secret', false), 'configured');
  assert.equal(classifyJwtSecret('  spaced-secret  ', true), 'configured');
});

test('classifyJwtSecret: a missing secret in production is a security misconfiguration', () => {
  assert.equal(classifyJwtSecret(undefined, true), 'insecure-production');
  assert.equal(classifyJwtSecret('', true), 'insecure-production');
  assert.equal(classifyJwtSecret('   ', true), 'insecure-production');
});

test('classifyJwtSecret: a missing secret outside production is tolerated (dev)', () => {
  assert.equal(classifyJwtSecret(undefined, false), 'insecure-dev');
  assert.equal(classifyJwtSecret('', false), 'insecure-dev');
});

// ─── Behavioral: the auth layer fails closed in production without a secret ─────
// The module resolves the secret once at load time, so these run in child
// processes with the environment set before `../dist/api/handlers.js` is imported.

function runInChildProcess(source, env) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}

test('production without a JWT secret: handleLogin returns 503 and getAuth returns null', () => {
  const source = `
    import { handleLogin, getAuth } from './dist/api/handlers.js';
    const login = await handleLogin(new Request('http://x/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    }));
    if (login.status !== 503) { console.error('expected 503, got', login.status); process.exit(2); }
    const auth = await getAuth(new Request('http://x', { headers: { authorization: 'Bearer anything' } }));
    if (auth !== null) { console.error('expected null auth'); process.exit(3); }
    process.exit(0);
  `;
  // Neither env var set — a non-zero child exit surfaces as a thrown error here.
  runInChildProcess(source, { NODE_ENV: 'production', ASTRO_BLOCKS_JWT_SECRET: '', CMS_JWT_SECRET: '' });
});

test('production WITH ASTRO_BLOCKS_JWT_SECRET: first login bootstraps the owner (200)', () => {
  withTempRoot((root) => {
    const source = `
      import { handleLogin } from './dist/api/handlers.js';
      // Isolated project root — first login creates the owner and returns 200.
      const res = await handleLogin(new Request('http://x/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
      }));
      if (res.status !== 200) { console.error('expected 200, got', res.status); process.exit(2); }
      process.exit(0);
    `;
    runInChildProcess(source, {
      NODE_ENV: 'production',
      ASTRO_BLOCKS_JWT_SECRET: 'a-strong-test-secret',
      ASTRO_BLOCKS_PROJECT_ROOT: root,
    });
  });
});

test('production with the legacy CMS_JWT_SECRET alias also authenticates (200)', () => {
  withTempRoot((root) => {
    const source = `
      import { handleLogin } from './dist/api/handlers.js';
      const res = await handleLogin(new Request('http://x/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
      }));
      if (res.status !== 200) { console.error('legacy alias did not authenticate, got', res.status); process.exit(2); }
      process.exit(0);
    `;
    runInChildProcess(source, {
      NODE_ENV: 'production',
      ASTRO_BLOCKS_JWT_SECRET: '',
      CMS_JWT_SECRET: 'legacy-secret',
      ASTRO_BLOCKS_PROJECT_ROOT: root,
    });
  });
});
