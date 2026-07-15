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
  // Now returns { errorKey, fieldKey } objects instead of strings (localization is done at handler level)
  const emptyFrom = validateRedirectPathInput('', 'from');
  assert.deepEqual(emptyFrom, {
    errorKey: 'redirects.pathRequired',
    fieldKey: 'redirects.labelFrom',
  });

  const externalFrom = validateRedirectPathInput('https://example.com/old', 'from');
  assert.deepEqual(externalFrom, {
    errorKey: 'redirects.pathMustBeInternal',
    fieldKey: 'redirects.labelFrom',
  });

  const noSlashTo = validateRedirectPathInput('old', 'to');
  assert.deepEqual(noSlashTo, {
    errorKey: 'redirects.pathMustStartSlash',
    fieldKey: 'redirects.labelTo',
  });

  const queryFrom = validateRedirectPathInput('/old?a=1', 'from');
  assert.deepEqual(queryFrom, {
    errorKey: 'redirects.pathNoQueryFragment',
    fieldKey: 'redirects.labelFrom',
  });

  const hashTo = validateRedirectPathInput('/old#section', 'to');
  assert.deepEqual(hashTo, {
    errorKey: 'redirects.pathNoQueryFragment',
    fieldKey: 'redirects.labelTo',
  });

  assert.equal(validateRedirectPathInput('/valid-path', 'from'), null);
});

test('validateRedirectPathInput rejects backslash and protocol-relative bypass shapes', () => {
  // Browsers normalize "\" to "/" and resolve "//host" as protocol-relative,
  // so every one of these would escape the internal-only policy if stored.
  const vectors = ['/\\evil.com', '/\\/evil.com', '\\\\evil.com', '//evil.com', '///evil.com'];

  for (const vector of vectors) {
    assert.deepEqual(validateRedirectPathInput(vector, 'from'), {
      errorKey: 'redirects.pathMustBeInternal',
      fieldKey: 'redirects.labelFrom',
    });
    assert.deepEqual(validateRedirectPathInput(vector, 'to'), {
      errorKey: 'redirects.pathMustBeInternal',
      fieldKey: 'redirects.labelTo',
    });
  }

  // Interior double slashes are not protocol-relative; normalization still collapses them.
  assert.equal(validateRedirectPathInput('/docs//intro', 'from'), null);
  assert.equal(validateRedirectPathInput('/docs//intro', 'to'), null);
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
