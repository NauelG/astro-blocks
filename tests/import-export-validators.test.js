/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateUsersUnit,
  validatePagesUnit,
  validateMediaUnit,
  validateConfigurationUnit,
  validateGlobalBlocksUnit,
  unitValidators,
  validateLanguagesFile,
  fileValidators,
} from '../dist/api/import-validate.js';

// A-5: validateUsersUnit

test('A-5: validateUsersUnit accepts empty users array', () => {
  assert.deepEqual(validateUsersUnit({ users: [] }), { ok: true });
});

test('A-5: validateUsersUnit accepts valid user with role "owner"', () => {
  const result = validateUsersUnit({
    users: [{ id: '1', email: 'a@b.com', passwordHash: 'x', role: 'owner' }],
  });
  assert.deepEqual(result, { ok: true });
});

test('A-5: validateUsersUnit accepts valid user with role "user"', () => {
  const result = validateUsersUnit({
    users: [{ id: '2', email: 'b@c.com', passwordHash: 'y', role: 'user' }],
  });
  assert.deepEqual(result, { ok: true });
});

test('A-5: validateUsersUnit rejects invalid role "superadmin"', () => {
  const result = validateUsersUnit({
    users: [{ id: '1', email: 'a@b.com', passwordHash: 'x', role: 'superadmin' }],
  });
  assert.equal(result.ok, false);
});

test('A-5: validateUsersUnit rejects null', () => {
  const result = validateUsersUnit(null);
  assert.equal(result.ok, false);
});

// A-5: validatePagesUnit

test('A-5: validatePagesUnit accepts empty pages array', () => {
  assert.deepEqual(validatePagesUnit({ pages: [] }), { ok: true });
});

test('A-5: validatePagesUnit accepts page with only id (lenient)', () => {
  const result = validatePagesUnit({ pages: [{ id: '1' }] });
  assert.deepEqual(result, { ok: true });
});

test('A-5: validatePagesUnit rejects null', () => {
  assert.equal(validatePagesUnit(null).ok, false);
});

test('A-5: validatePagesUnit rejects object without pages key', () => {
  assert.equal(validatePagesUnit({}).ok, false);
});

// A-5: validateMediaUnit

test('A-5: validateMediaUnit accepts empty uploads array', () => {
  assert.deepEqual(validateMediaUnit({ uploads: [] }), { ok: true });
});

test('A-5: validateMediaUnit rejects null', () => {
  assert.equal(validateMediaUnit(null).ok, false);
});

// A-5: validateConfigurationUnit

test('A-5: validateConfigurationUnit accepts an object', () => {
  assert.deepEqual(validateConfigurationUnit({ site: {} }), { ok: true });
});

test('A-5: validateConfigurationUnit rejects null', () => {
  assert.equal(validateConfigurationUnit(null).ok, false);
});

// A-5: validateGlobalBlocksUnit

test('A-5: validateGlobalBlocksUnit accepts { globalBlocks: {} }', () => {
  assert.deepEqual(validateGlobalBlocksUnit({ globalBlocks: {} }), { ok: true });
});

test('A-5: validateGlobalBlocksUnit accepts { blocks: [] }', () => {
  assert.deepEqual(validateGlobalBlocksUnit({ blocks: [] }), { ok: true });
});

test('A-5: validateGlobalBlocksUnit rejects null', () => {
  assert.equal(validateGlobalBlocksUnit(null).ok, false);
});

// H-2: validateUsersUnit must require id, email, passwordHash (not just role)

test('H-2: validateUsersUnit rejects user missing passwordHash', () => {
  const result = validateUsersUnit({
    users: [{ id: '1', email: 'a@b.com', role: 'owner' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason, 'should provide a reason');
});

test('H-2: validateUsersUnit rejects user missing email', () => {
  const result = validateUsersUnit({
    users: [{ id: '1', passwordHash: 'h', role: 'owner' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason, 'should provide a reason');
});

test('H-2: validateUsersUnit rejects user missing id', () => {
  const result = validateUsersUnit({
    users: [{ email: 'a@b.com', passwordHash: 'h', role: 'owner' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason, 'should provide a reason');
});

test('H-2: validateUsersUnit accepts fully valid user with id, email, passwordHash, role', () => {
  const result = validateUsersUnit({
    users: [{ id: '1', email: 'a@b.com', passwordHash: 'hashed', role: 'owner' }],
  });
  assert.deepEqual(result, { ok: true });
});

// A-5: unitValidators map

test('A-5: unitValidators has all 5 ExportUnit keys', () => {
  const keys = Object.keys(unitValidators);
  assert.equal(keys.length, 5);
  assert.ok(keys.includes('pages'));
  assert.ok(keys.includes('media'));
  assert.ok(keys.includes('users'));
  assert.ok(keys.includes('configuration'));
  assert.ok(keys.includes('global-blocks'));
});

test('A-5: unitValidators.users delegates to validateUsersUnit', () => {
  assert.equal(unitValidators['users']({ users: [] }).ok, true);
  assert.equal(unitValidators['users']({ users: [{ role: 'superadmin' }] }).ok, false);
});

// #108: field grammars at the import door

test('#108: validateUsersUnit rejects a markup email, naming the user id', () => {
  const result = validateUsersUnit({
    users: [{ id: 'u1', email: '<img src=x onerror=alert(1)>', passwordHash: 'x', role: 'user' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /u1/);
  assert.match(result.reason, /email/);
});

test('#108: validateUsersUnit still accepts a valid email', () => {
  const result = validateUsersUnit({
    users: [{ id: 'u1', email: 'a@b.co', passwordHash: 'x', role: 'user' }],
  });
  assert.deepEqual(result, { ok: true });
});

test('#108: validateLanguagesFile requires a languages array', () => {
  assert.equal(validateLanguagesFile(null).ok, false);
  assert.equal(validateLanguagesFile({}).ok, false);
  assert.equal(validateLanguagesFile({ languages: 'nope' }).ok, false);
});

test('#108: validateLanguagesFile rejects a code failing the grammar', () => {
  const result = validateLanguagesFile({ languages: [{ code: '<script>', label: 'Bad' }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /code/);
});

test('#108: validateLanguagesFile rejects a label failing the grammar', () => {
  const twoLines = ['two', 'lines'].join(String.fromCharCode(10));
  const result = validateLanguagesFile({ languages: [{ code: 'es', label: twoLines }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /label/);

  const oversized = validateLanguagesFile({ languages: [{ code: 'es', label: 'x'.repeat(81) }] });
  assert.equal(oversized.ok, false);
});

test('#108: validateLanguagesFile accepts valid entries, extra keys, and absent labels', () => {
  const result = validateLanguagesFile({
    languages: [
      { code: 'es', label: 'Español', enabled: true, isDefault: true, extra: 'ignored' },
      { code: 'pt-br' },
    ],
  });
  assert.deepEqual(result, { ok: true });
});

test('#108: fileValidators wires data/languages.json to validateLanguagesFile', () => {
  assert.equal(typeof fileValidators['data/languages.json'], 'function');
  assert.equal(fileValidators['data/languages.json']({ languages: [] }).ok, true);
});
