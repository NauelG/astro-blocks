import test from 'node:test';
import assert from 'node:assert/strict';

import { getI18nMeta } from '../dist/utils/getI18nMeta.js';

test('getI18nMeta builds hreflang links and og locales', () => {
  const meta = getI18nMeta(
    {
      locale: 'en',
      defaultLocale: 'es',
      alternates: [
        { locale: 'es', path: '/' },
        { locale: 'en', path: '/en' },
        { locale: 'ca', path: '/ca' },
      ],
    },
    { baseUrl: 'https://example.com' }
  );

  assert.ok(meta);
  assert.equal(meta.htmlLang, 'en');
  assert.equal(meta.ogLocale, 'en');
  assert.deepEqual(meta.ogLocaleAlternate, ['es', 'ca']);
  assert.deepEqual(meta.alternates, [
    { hrefLang: 'es', href: 'https://example.com/' },
    { hrefLang: 'en', href: 'https://example.com/en' },
    { hrefLang: 'ca', href: 'https://example.com/ca' },
    { hrefLang: 'x-default', href: 'https://example.com/' },
  ]);
});

test('getI18nMeta returns null when no alternates are available', () => {
  const meta = getI18nMeta({
    locale: 'es',
    defaultLocale: 'es',
    alternates: [],
  });

  assert.equal(meta, null);
});
