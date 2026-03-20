/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findRedirectByPath,
  hasDuplicateRedirectFrom,
  normalizeRedirectPath,
  validateRedirectPathInput,
} from '../dist/utils/redirects.js';

test('normalizeRedirectPath canonicalizes trailing and repeated slashes', () => {
  assert.equal(normalizeRedirectPath('/old-path/'), '/old-path');
  assert.equal(normalizeRedirectPath('//docs///intro//'), '/docs/intro');
  assert.equal(normalizeRedirectPath('/'), '/');
});

test('validateRedirectPathInput rejects external urls, query and hash', () => {
  assert.equal(validateRedirectPathInput('', 'from'), 'La ruta de origen es obligatoria.');
  assert.equal(validateRedirectPathInput('https://example.com/old', 'from'), 'La ruta de origen debe ser interna (no se permiten URLs absolutas).');
  assert.equal(validateRedirectPathInput('old', 'to'), 'La ruta de destino debe comenzar con "/".');
  assert.equal(validateRedirectPathInput('/old?a=1', 'from'), 'La ruta de origen no puede incluir query ni fragmento.');
  assert.equal(validateRedirectPathInput('/old#section', 'to'), 'La ruta de destino no puede incluir query ni fragmento.');
  assert.equal(validateRedirectPathInput('/valid-path', 'from'), null);
});

test('findRedirectByPath only returns enabled exact matches', () => {
  const redirects = [
    { id: '1', from: '/old', to: '/new', statusCode: 301, enabled: true },
    { id: '2', from: '/draft', to: '/new-draft', statusCode: 302, enabled: false },
  ];

  assert.equal(findRedirectByPath(redirects, '/old/')?.id, '1');
  assert.equal(findRedirectByPath(redirects, '/draft'), null);
  assert.equal(findRedirectByPath(redirects, '/missing'), null);
});

test('hasDuplicateRedirectFrom ignores excluded id', () => {
  const redirects = [
    { id: '1', from: '/old', to: '/new', statusCode: 301, enabled: true },
    { id: '2', from: '/legacy', to: '/fresh', statusCode: 302, enabled: true },
  ];

  assert.equal(hasDuplicateRedirectFrom(redirects, '/old'), true);
  assert.equal(hasDuplicateRedirectFrom(redirects, '/old', '1'), false);
  assert.equal(hasDuplicateRedirectFrom(redirects, '/not-found'), false);
});
