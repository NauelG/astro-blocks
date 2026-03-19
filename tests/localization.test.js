import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultLanguageCode,
  getLocalizedValue,
  getLocalizedValueForLocale,
  hasLocalizedValue,
  isLocalizedMapValue,
  isSchemaPropLocalizable,
  normalizeLanguages,
  normalizeLocaleCode,
  resolvePreferredLocaleFromAcceptLanguage,
  setLocalizedValue,
} from '../dist/utils/localization.js';

test('normalizeLocaleCode normalizes separators and case', () => {
  assert.equal(normalizeLocaleCode('PT_BR'), 'pt-br');
});

test('normalizeLanguages ensures one enabled default language', () => {
  const data = normalizeLanguages({
    languages: [
      { code: 'es', label: 'Español', enabled: false },
      { code: 'en', label: 'English', enabled: true },
    ],
  });

  assert.equal(data.languages.some((entry) => entry.isDefault && entry.enabled !== false), true);
  assert.equal(getDefaultLanguageCode(data), 'en');
});

test('localized map helpers set and read locale values', () => {
  const map = setLocalizedValue({}, 'es', 'Hola');
  const withEnglish = setLocalizedValue(map, 'en', 'Hello');

  assert.equal(getLocalizedValue(withEnglish, 'en', 'es'), 'Hello');
  assert.equal(getLocalizedValue(withEnglish, 'fr', 'es'), 'Hola');
  assert.equal(getLocalizedValueForLocale(withEnglish, 'fr'), undefined);
  assert.equal(getLocalizedValueForLocale(withEnglish, 'en'), 'Hello');
  assert.equal(hasLocalizedValue(withEnglish, 'en'), true);
  assert.equal(hasLocalizedValue(withEnglish, 'fr'), false);
});

test('isLocalizedMapValue validates map keys against locale set', () => {
  const locales = new Set(['es', 'en']);

  assert.equal(isLocalizedMapValue({ es: 'Hola', en: 'Hello' }, locales), true);
  assert.equal(isLocalizedMapValue({ title: 'Hola' }, locales), false);
});

test('isSchemaPropLocalizable follows default localizable rules for string/text', () => {
  assert.equal(isSchemaPropLocalizable({ type: 'string' }), true);
  assert.equal(isSchemaPropLocalizable({ type: 'text' }), true);
  assert.equal(isSchemaPropLocalizable({ type: 'number' }), false);
  assert.equal(isSchemaPropLocalizable({ type: 'string', localizable: false }), false);
  assert.equal(isSchemaPropLocalizable({ type: 'number', localizable: true }), true);
});

test('resolvePreferredLocaleFromAcceptLanguage matches exact and base locales', () => {
  const available = ['es', 'en', 'pt-br'];
  assert.equal(resolvePreferredLocaleFromAcceptLanguage('en-GB,en;q=0.9,es;q=0.8', available, 'es'), 'en');
  assert.equal(resolvePreferredLocaleFromAcceptLanguage('pt-PT,fr;q=0.8', available, 'es'), 'pt-br');
});

test('resolvePreferredLocaleFromAcceptLanguage falls back to default locale', () => {
  const available = ['es', 'en'];
  assert.equal(resolvePreferredLocaleFromAcceptLanguage('', available, 'es'), 'es');
  assert.equal(resolvePreferredLocaleFromAcceptLanguage('fr-FR,ca;q=0.9', available, 'es'), 'es');
});
