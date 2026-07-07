import test from 'node:test';
import assert from 'node:assert/strict';

import { getLanguageLocaleKeys, normalizeLanguageCode } from '../dist/utils/language-locales.js';

test('normalizeLanguageCode normalizes case, whitespace and underscores', () => {
  assert.equal(normalizeLanguageCode(' EN_us '), 'en-us');
});

test('normalizeLanguageCode returns empty string for falsy input', () => {
  assert.equal(normalizeLanguageCode(''), '');
});

test('getLanguageLocaleKeys returns a Set of normalized codes for enabled and disabled languages', () => {
  const languagesData = {
    languages: [
      { code: 'ES', label: 'Español', enabled: true, isDefault: true },
      { code: 'en_US', label: 'English', enabled: false },
    ],
  };

  const keys = getLanguageLocaleKeys(languagesData);
  assert.ok(keys instanceof Set);
  assert.ok(keys.has('es'));
  assert.ok(keys.has('en-us'));
  assert.equal(keys.size, 2);
});

test('getLanguageLocaleKeys filters out falsy codes and handles an empty languages array', () => {
  const keys = getLanguageLocaleKeys({ languages: [] });
  assert.equal(keys.size, 0);
});
