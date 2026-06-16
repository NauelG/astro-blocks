/**
 * Tests for routes/admin/i18n/resolve.ts
 * Tests: parseAcceptLanguage, readUiLocaleCookie, resolveUiLocale
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAcceptLanguage,
  readUiLocaleCookie,
  resolveUiLocale,
} from '../dist/routes/admin/i18n/resolve.js';

// ─── parseAcceptLanguage ──────────────────────────────────────────────────────

test('parseAcceptLanguage: Spanish primary tag resolves to es', () => {
  assert.equal(parseAcceptLanguage('es'), 'es');
});

test('parseAcceptLanguage: English primary tag resolves to en', () => {
  assert.equal(parseAcceptLanguage('en'), 'en');
});

test('parseAcceptLanguage: es-MX regional tag resolves to es (primary subtag)', () => {
  assert.equal(parseAcceptLanguage('es-MX,es;q=0.9,en;q=0.8'), 'es');
});

test('parseAcceptLanguage: es-AR regional tag resolves to es', () => {
  assert.equal(parseAcceptLanguage('es-AR'), 'es');
});

test('parseAcceptLanguage: en-GB regional tag resolves to en', () => {
  assert.equal(parseAcceptLanguage('en-GB,en;q=0.9'), 'en');
});

test('parseAcceptLanguage: en-US regional tag resolves to en', () => {
  assert.equal(parseAcceptLanguage('en-US,en;q=0.9'), 'en');
});

test('parseAcceptLanguage: es-419 regional tag resolves to es', () => {
  assert.equal(parseAcceptLanguage('es-419'), 'es');
});

test('parseAcceptLanguage: unsupported language fr returns null', () => {
  assert.equal(parseAcceptLanguage('fr-FR,fr;q=0.9'), null);
});

test('parseAcceptLanguage: unsupported language de returns null', () => {
  assert.equal(parseAcceptLanguage('de-DE,de;q=0.9'), null);
});

test('parseAcceptLanguage: empty string returns null', () => {
  assert.equal(parseAcceptLanguage(''), null);
});

test('parseAcceptLanguage: null/undefined returns null', () => {
  assert.equal(parseAcceptLanguage(null), null);
  assert.equal(parseAcceptLanguage(undefined), null);
});

test('parseAcceptLanguage: malformed string returns null', () => {
  assert.equal(parseAcceptLanguage('not-a-language-code-xyz'), null);
});

test('parseAcceptLanguage: picks highest q-value supported language', () => {
  // fr first but unsupported, es second => es
  assert.equal(parseAcceptLanguage('fr;q=1.0,es;q=0.9,en;q=0.8'), 'es');
});

test('parseAcceptLanguage: es-ES resolves to es', () => {
  assert.equal(parseAcceptLanguage('es-ES'), 'es');
});

// ─── readUiLocaleCookie ───────────────────────────────────────────────────────

test('readUiLocaleCookie: extracts cms-ui-locale=es from cookie header', () => {
  assert.equal(readUiLocaleCookie('cms-ui-locale=es'), 'es');
});

test('readUiLocaleCookie: extracts cms-ui-locale=en from cookie header', () => {
  assert.equal(readUiLocaleCookie('cms-ui-locale=en'), 'en');
});

test('readUiLocaleCookie: extracts from multi-cookie header', () => {
  assert.equal(readUiLocaleCookie('cms-token=abc; cms-ui-locale=es; other=val'), 'es');
});

test('readUiLocaleCookie: returns null when cms-ui-locale is absent', () => {
  assert.equal(readUiLocaleCookie('other=foo'), null);
});

test('readUiLocaleCookie: returns null for empty cookie header', () => {
  assert.equal(readUiLocaleCookie(''), null);
  assert.equal(readUiLocaleCookie(null), null);
  assert.equal(readUiLocaleCookie(undefined), null);
});

test('readUiLocaleCookie: rejects unknown locale values', () => {
  assert.equal(readUiLocaleCookie('cms-ui-locale=fr'), null);
});

test('readUiLocaleCookie: rejects malformed value', () => {
  assert.equal(readUiLocaleCookie('cms-ui-locale=xyz'), null);
});

// ─── resolveUiLocale ──────────────────────────────────────────────────────────

test('resolveUiLocale: SCENARIO-1 no cookie, unsupported Accept-Language => en', () => {
  // fr is unsupported, fallback to en
  assert.equal(resolveUiLocale({ acceptLanguage: 'fr-FR,fr;q=0.9' }), 'en');
});

test('resolveUiLocale: SCENARIO-1 no cookie, absent Accept-Language => en', () => {
  assert.equal(resolveUiLocale({}), 'en');
});

test('resolveUiLocale: SCENARIO-2 Accept-Language es-MX => es', () => {
  assert.equal(resolveUiLocale({ acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8' }), 'es');
});

test('resolveUiLocale: SCENARIO-3 Accept-Language en-US => en', () => {
  assert.equal(resolveUiLocale({ acceptLanguage: 'en-US,en;q=0.9' }), 'en');
});

test('resolveUiLocale: SCENARIO-4 unsupported Accept-Language => en', () => {
  assert.equal(resolveUiLocale({ acceptLanguage: 'de-DE,de;q=0.9' }), 'en');
});

test('resolveUiLocale: SCENARIO-5 cookie en beats Accept-Language es', () => {
  assert.equal(resolveUiLocale({ cookie: 'cms-ui-locale=en', acceptLanguage: 'es-ES' }), 'en');
});

test('resolveUiLocale: cookie es beats Accept-Language en', () => {
  assert.equal(resolveUiLocale({ cookie: 'cms-ui-locale=es', acceptLanguage: 'en-US' }), 'es');
});

test('resolveUiLocale: invalid cookie falls back to Accept-Language', () => {
  assert.equal(resolveUiLocale({ cookie: 'fr', acceptLanguage: 'es' }), 'es');
});

test('resolveUiLocale: invalid cookie, unsupported Accept-Language => en', () => {
  assert.equal(resolveUiLocale({ cookie: 'xyz', acceptLanguage: 'de' }), 'en');
});

test('resolveUiLocale: returns only en or es (REQ-2.5)', () => {
  const result = resolveUiLocale({ acceptLanguage: 'es' });
  assert.ok(result === 'en' || result === 'es');
});
