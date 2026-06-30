/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { sha256Hex, verifyChecksums, buildManifest } from '../dist/api/manifest.js';

// A-4: sha256Hex

test('A-4: sha256Hex returns known sha256 of "hello"', () => {
  // Known sha256 of 'hello'
  const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const actual = sha256Hex(Buffer.from('hello'));
  assert.equal(actual, expected);
});

test('A-4: sha256Hex accepts Uint8Array', () => {
  const bytes = new Uint8Array([104, 101, 108, 108, 111]); // 'hello'
  const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  assert.equal(sha256Hex(bytes), expected);
});

test('A-4: sha256Hex matches node:crypto output directly', () => {
  const bytes = Buffer.from('test content for checksum');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256Hex(bytes), expected);
});

// A-4: verifyChecksums

function makeManifestWithChecksums(checksums) {
  return buildManifest(['pages'], { pages: 1 }, checksums);
}

test('A-4: verifyChecksums returns { ok: true } when all staged entries match', () => {
  const content = Buffer.from('{"pages":[]}');
  const hash = sha256Hex(content);
  const manifest = makeManifestWithChecksums({ 'data/pages.json': hash });
  const staged = { 'data/pages.json': content };
  const result = verifyChecksums(staged, manifest);
  assert.deepEqual(result, { ok: true });
});

test('A-4: verifyChecksums returns { ok: false, failed } when one entry mismatches', () => {
  const content = Buffer.from('{"pages":[]}');
  const hash = sha256Hex(content);
  const manifest = makeManifestWithChecksums({ 'data/pages.json': hash });
  const tamperedStaged = { 'data/pages.json': Buffer.from('{"pages":["tampered"]}') };
  const result = verifyChecksums(tamperedStaged, manifest);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.failed));
  assert.ok(result.failed.includes('data/pages.json'));
});

test('A-4: verifyChecksums returns { ok: false } when manifest entry is missing from staged', () => {
  const hash = sha256Hex(Buffer.from('content'));
  const manifest = makeManifestWithChecksums({ 'data/pages.json': hash });
  const result = verifyChecksums({}, manifest); // staged is empty
  assert.equal(result.ok, false);
  assert.ok(result.failed?.includes('data/pages.json'));
});

test('A-4: verifyChecksums succeeds with multiple matching entries', () => {
  const pages = Buffer.from('{"pages":[]}');
  const users = Buffer.from('{"users":[]}');
  const checksums = {
    'data/pages.json': sha256Hex(pages),
    'data/users.json': sha256Hex(users),
  };
  const manifest = makeManifestWithChecksums(checksums);
  const staged = {
    'data/pages.json': pages,
    'data/users.json': users,
  };
  const result = verifyChecksums(staged, manifest);
  assert.deepEqual(result, { ok: true });
});

// C-1: extra staged files not in manifest must be rejected (injection bypass guard)

test('C-1: verifyChecksums returns { ok: false } when staged has extra file not in manifest checksums', () => {
  const pages = Buffer.from('{"pages":[]}');
  const pagesHash = sha256Hex(pages);
  // manifest only covers data/pages.json
  const manifest = makeManifestWithChecksums({ 'data/pages.json': pagesHash });
  const staged = {
    'data/pages.json': pages,
    // injected file not listed in manifest.checksums
    'data/users.json': Buffer.from('{"users":[{"role":"owner","id":"x","email":"x@x.com","passwordHash":"h"}]}'),
  };
  const result = verifyChecksums(staged, manifest);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.failed));
  assert.ok(result.failed.includes('data/users.json'));
});
