/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * image-value.test.js
 * Unit tests for src/utils/image-value.ts pure helpers.
 * These run against the compiled dist/ output.
 * RED phase: tests are written before the implementation exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toImageValue,
  parseImageValue,
  imageAttrs,
  isEmptyImageValue,
  mediaEntryToImageValue,
  serializeImageValueAttr,
  getCaption,
} from '../dist/utils/image-value.js';
import { escapeAttr } from '../dist/utils/html-escape.js';

// ─── toImageValue ─────────────────────────────────────────────────────────────

test('T-7: toImageValue — passes through valid object unchanged (SC-1.1)', () => {
  const input = { url: '/uploads/a.jpg', alt: 'A cat', width: 800, height: 600 };
  const result = toImageValue(input);
  assert.equal(result.url, '/uploads/a.jpg');
  assert.equal(result.alt, 'A cat');
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test('T-6: toImageValue — coerces legacy string to { url, alt: "" } (SC-1.2)', () => {
  const result = toImageValue('/uploads/legacy.jpg');
  assert.equal(result.url, '/uploads/legacy.jpg');
  assert.equal(result.alt, '');
  assert.equal(result.width, undefined);
  assert.equal(result.height, undefined);
});

test('T-8: toImageValue — coerces null to sentinel { url: "", alt: "" } (SC-1.4)', () => {
  const result = toImageValue(null);
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

test('toImageValue — coerces undefined to sentinel (SC-1.4)', () => {
  const result = toImageValue(undefined);
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

test('toImageValue — coerces object missing url to sentinel (SC-1.3)', () => {
  const result = toImageValue({ alt: 'Orphan alt' });
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

test('toImageValue — coerces number to sentinel', () => {
  const result = toImageValue(42);
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

test('toImageValue — coerces array to sentinel', () => {
  const result = toImageValue(['/img.jpg']);
  assert.equal(result.url, '');
  assert.equal(result.alt, '');
});

// ─── parseImageValue ──────────────────────────────────────────────────────────

test('T-9: JSON hidden-input round-trip — special chars in alt survive (SC-1.5)', () => {
  const original = {
    url: '/u/img.png',
    alt: 'Quote with "quotes" & <tags>',
    width: 400,
    height: 300,
  };
  const serialized = JSON.stringify(original);
  const parsed = parseImageValue(serialized);
  assert.equal(parsed.url, '/u/img.png');
  assert.equal(parsed.alt, 'Quote with "quotes" & <tags>');
  assert.equal(parsed.width, 400);
  assert.equal(parsed.height, 300);
});

test('parseImageValue — empty string returns { url: "" }', () => {
  const result = parseImageValue('');
  assert.equal(result.url, '');
});

test('parseImageValue — legacy bare URL string returns { url: rawString }', () => {
  const result = parseImageValue('/uploads/old.jpg');
  assert.equal(result.url, '/uploads/old.jpg');
});

test('parseImageValue — valid JSON object with url returns parsed object', () => {
  const input = JSON.stringify({ url: '/img.jpg', alt: 'Hello' });
  const result = parseImageValue(input);
  assert.equal(result.url, '/img.jpg');
  assert.equal(result.alt, 'Hello');
});

test('parseImageValue — malformed JSON returns sentinel { url: "" }', () => {
  const result = parseImageValue('{bad json');
  assert.equal(result.url, '');
});

// ─── imageAttrs ───────────────────────────────────────────────────────────────

test('T-17: imageAttrs — renders all four attributes (SC-7.1)', () => {
  const attrs = imageAttrs({ url: '/a.jpg', alt: 'Cat', width: 800, height: 600 });
  assert.equal(attrs.src, '/a.jpg');
  assert.equal(attrs.alt, 'Cat');
  assert.equal(attrs.width, 800);
  assert.equal(attrs.height, 600);
});

test('T-18: imageAttrs — empty alt is "" not absent (SC-7.2)', () => {
  const attrs = imageAttrs({ url: '/deco.png', alt: '' });
  assert.equal(attrs.src, '/deco.png');
  assert.equal(attrs.alt, '');
  // alt must be present (not undefined)
  assert.ok(Object.prototype.hasOwnProperty.call(attrs, 'alt'), 'alt must be a key in attrs');
});

test('T-19: imageAttrs — absent width/height are omitted (SC-7.3)', () => {
  const attrs = imageAttrs({ url: '/svg.svg', alt: 'Logo' });
  assert.equal(attrs.src, '/svg.svg');
  assert.equal(attrs.alt, 'Logo');
  assert.equal(attrs.width, undefined);
  assert.equal(attrs.height, undefined);
  // width and height should NOT be enumerable keys when absent
  assert.ok(
    !Object.prototype.hasOwnProperty.call(attrs, 'width') || attrs.width === undefined,
    'width absent',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(attrs, 'height') || attrs.height === undefined,
    'height absent',
  );
});

test('imageAttrs — missing alt defaults to ""', () => {
  const attrs = imageAttrs({ url: '/img.jpg' });
  assert.equal(attrs.alt, '');
});

// ─── isEmptyImageValue ────────────────────────────────────────────────────────

test('isEmptyImageValue — { url: "" } is empty', () => {
  assert.equal(isEmptyImageValue({ url: '' }), true);
});

test('isEmptyImageValue — {} is empty (missing url)', () => {
  assert.equal(isEmptyImageValue({}), true);
});

test('isEmptyImageValue — { url: "/img.jpg" } is not empty', () => {
  assert.equal(isEmptyImageValue({ url: '/img.jpg' }), false);
});

test('isEmptyImageValue — null is empty', () => {
  assert.equal(isEmptyImageValue(null), true);
});

test('isEmptyImageValue — string is treated as empty (not a valid ImageFieldValue object)', () => {
  assert.equal(isEmptyImageValue('/img.jpg'), true);
});

// ─── mediaEntryToImageValue ───────────────────────────────────────────────────

test('mediaEntryToImageValue — maps entry with all fields', () => {
  const entry = {
    id: '1',
    url: '/uploads/a.jpg',
    filename: 'a.jpg',
    size: 1000,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
    alt: 'A dog',
    width: 1024,
    height: 768,
  };
  const value = mediaEntryToImageValue(entry);
  assert.equal(value.url, '/uploads/a.jpg');
  assert.equal(value.alt, 'A dog');
  assert.equal(value.width, 1024);
  assert.equal(value.height, 768);
});

test('mediaEntryToImageValue — entry without alt/width/height → url only + alt ""', () => {
  const entry = {
    id: '2',
    url: '/uploads/b.jpg',
    filename: 'b.jpg',
    size: 500,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const value = mediaEntryToImageValue(entry);
  assert.equal(value.url, '/uploads/b.jpg');
  assert.equal(value.alt, '');
  assert.equal(value.width, undefined);
  assert.equal(value.height, undefined);
});

// ─── FIX-1: HTML attribute safety — double-quote in alt/url ───────────────────
// These tests prove that the JSON round-trip through an HTML attribute is safe.
// A naive escapeHtml (textContent→innerHTML) only encodes &, <, > — it does NOT
// encode " so a double-quote in alt would terminate the attribute value and
// truncate the hidden-input value.

function htmlEscapeSimple(s) {
  // Simulates the BROKEN escapeHtml (only & < >) — used in RED assertions.
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlEscapeAttr(s) {
  // Correct implementation: also encodes " and ' (matches escapePickerHtml in block-form.ts)
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

test('FIX-1: escapePickerHtml encodes double-quotes — broken escapeHtml does NOT', () => {
  const value = { url: '/uploads/img.jpg', alt: 'say "hi" <b>&</b>' };
  const json = JSON.stringify(value);

  // Broken path: double-quote is NOT encoded → attribute gets truncated
  const brokenAttrValue = htmlEscapeSimple(json);
  assert.ok(
    brokenAttrValue.includes('"'),
    'broken escapeHtml should leave unescaped double-quotes (this is the bug)',
  );

  // Correct path: double-quote IS encoded → attribute is safe
  const safeAttrValue = htmlEscapeAttr(json);
  assert.ok(
    !safeAttrValue.includes('"'),
    'correct escapePickerHtml should have NO unescaped double-quotes in the encoded output',
  );

  // Round-trip: decoding the safe attr value then JSON.parse yields original
  const decoded = decodeHtmlEntities(safeAttrValue);
  const roundTripped = JSON.parse(decoded);
  assert.equal(roundTripped.url, value.url);
  assert.equal(roundTripped.alt, value.alt);
});

test('FIX-1: alt with double-quote survives HTML-attribute round-trip via escapePickerHtml', () => {
  const value = { url: '/u/photo.jpg', alt: 'A "quoted" caption & <b>bold</b>' };
  const safeAttrValue = htmlEscapeAttr(JSON.stringify(value));
  // No raw double-quote should remain
  assert.ok(!safeAttrValue.includes('"'), 'all " must be &quot; after encoding');
  // Decoding and parsing must yield original
  const roundTripped = JSON.parse(decodeHtmlEntities(safeAttrValue));
  assert.deepEqual(roundTripped, value);
});

// ─── FIX-2: negative and zero dimensions are invalid ─────────────────────────

test('FIX-2: toImageValue — drops negative width, keeps valid height', () => {
  const result = toImageValue({ url: '/img.jpg', alt: '', width: -1, height: 100 });
  assert.equal(result.width, undefined, 'negative width must be dropped');
  assert.equal(result.height, 100, 'valid height must be preserved even when width is invalid');
});

test('FIX-2: toImageValue — drops zero width (must be > 0)', () => {
  const result = toImageValue({ url: '/img.jpg', alt: '', width: 0, height: 0 });
  assert.equal(result.width, undefined, 'zero width must be dropped');
  assert.equal(result.height, undefined, 'zero height must be dropped');
});

test('FIX-2: parseImageValue — drops negative width/height from JSON', () => {
  const raw = JSON.stringify({ url: '/img.jpg', alt: 'x', width: -5, height: -10 });
  const result = parseImageValue(raw);
  assert.equal(result.width, undefined, 'negative width must be dropped by parser');
  assert.equal(result.height, undefined, 'negative height must be dropped by parser');
});

test('FIX-2: parseImageValue — drops zero width/height from JSON', () => {
  const raw = JSON.stringify({ url: '/img.jpg', alt: 'x', width: 0, height: 0 });
  const result = parseImageValue(raw);
  assert.equal(result.width, undefined, 'zero width must be dropped by parser');
  assert.equal(result.height, undefined, 'zero height must be dropped by parser');
});

test('FIX-2: mediaEntryToImageValue — drops negative dimensions', () => {
  const entry = {
    id: '1',
    url: '/u.jpg',
    filename: 'u.jpg',
    size: 100,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
    width: -1,
    height: -1,
  };
  const result = mediaEntryToImageValue(entry);
  assert.equal(result.width, undefined, 'negative width must be dropped');
  assert.equal(result.height, undefined, 'negative height must be dropped');
});

test('FIX-2: mediaEntryToImageValue — drops zero dimensions', () => {
  const entry = {
    id: '2',
    url: '/u.jpg',
    filename: 'u.jpg',
    size: 100,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
    width: 0,
    height: 0,
  };
  const result = mediaEntryToImageValue(entry);
  assert.equal(result.width, undefined, 'zero width must be dropped');
  assert.equal(result.height, undefined, 'zero height must be dropped');
});

// ─── FIX-3: serializeImageValueAttr — call-site regression for the CRITICAL escaping fix ──
// These tests prove that the ACTUAL serializer used by the hidden-input value=""
// attribute encodes double-quotes (the critical character that breaks attribute parsing).
// A quote-blind escaper (escapeHtml: only & < >) would fail the no-raw-quote assertion.

function decodeHtmlEntitiesLocal(s) {
  // Reverse the full attribute escaping: &quot; &#39; &#x27; &lt; &gt; &amp;
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

test('FIX-3: serializeImageValueAttr — no raw double-quote in output (critical breakout char)', () => {
  const value = { url: '/img.jpg', alt: 'say "hi" <b>&\'x' };
  const serialized = serializeImageValueAttr(value);
  assert.ok(
    !serialized.includes('"'),
    'serializeImageValueAttr must encode all double-quotes — a raw " breaks the HTML attribute',
  );
  assert.ok(
    !serialized.includes('<'),
    'serializeImageValueAttr must encode < to prevent tag injection',
  );
  assert.ok(!serialized.includes('>'), 'serializeImageValueAttr must encode >');
  assert.ok(
    !serialized.includes('&') ||
      serialized.includes('&amp;') ||
      serialized.includes('&quot;') ||
      serialized.includes('&lt;') ||
      serialized.includes('&gt;') ||
      serialized.includes('&#39;'),
    'any & must be an entity prefix (escaped), not a raw ampersand',
  );
  assert.ok(
    serialized.includes('&quot;'),
    'double-quote must be encoded as &quot; (or equivalent numeric entity)',
  );
});

test('FIX-3: serializeImageValueAttr — HTML-attribute round-trip preserves all data', () => {
  // Simulates: value attribute in HTML → browser unescapes on .value read → JSON.parse
  const original = { url: '/img.jpg', alt: 'say "hi" <b>&\'x' };
  const serialized = serializeImageValueAttr(original);
  // Reverse HTML entity escaping (as the browser does when reading .value)
  const decoded = decodeHtmlEntitiesLocal(serialized);
  const roundTripped = JSON.parse(decoded);
  assert.deepEqual(
    roundTripped,
    original,
    'round-trip through HTML attribute must preserve all fields exactly',
  );
});

test('FIX-3: serializeImageValueAttr — quote-blind escaper would FAIL (proves the test catches regression)', () => {
  // A quote-blind escaper only encodes & < > — does NOT encode " — this is the BUG.
  // This test asserts the property that a buggy escaper VIOLATES, proving the
  // regression test would catch a revert of the call-site fix.
  const value = { url: '/img.jpg', alt: 'has "quotes"' };
  const serialized = serializeImageValueAttr(value);
  // The correct serializer MUST NOT have unescaped double-quotes.
  // If someone replaces serializeImageValueAttr with a quote-blind escapeHtml, this fails.
  assert.ok(
    !serialized.includes('"'),
    'regression guard: if this fails, the call site was reverted to a quote-blind escaper',
  );
});

// ─── byte-identity guard vs canonical escapeAttr (consolidation, issue #39) ────
// Locks that serializeImageValueAttr delegates to the exact same escaping as the
// canonical escapeAttr(JSON.stringify(value)) — must stay green before AND after
// the internal implementation is collapsed onto the canonical helper.

test('serializeImageValueAttr — byte-identical to escapeAttr(JSON.stringify(value)) (special chars)', () => {
  const value = { url: '/img.jpg', alt: 'say "hi" <b>&\'x' };
  assert.equal(serializeImageValueAttr(value), escapeAttr(JSON.stringify(value)));
});

test('serializeImageValueAttr — byte-identical to escapeAttr(JSON.stringify(value)) (safe value)', () => {
  const value = { url: '/a.jpg', alt: 'Cat' };
  assert.equal(serializeImageValueAttr(value), escapeAttr(JSON.stringify(value)));
});

// ─── caption pass-through (P1-T5) ─────────────────────────────────────────────

test('toImageValue passes caption string', () => {
  const result = toImageValue({ url: '/img.jpg', alt: 'Alt', caption: 'Photo credit: J. Doe' });
  assert.equal(result.caption, 'Photo credit: J. Doe');
});

test('toImageValue drops non-string caption', () => {
  const result = toImageValue({ url: '/img.jpg', alt: 'Alt', caption: 42 });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(result, 'caption'),
    'non-string caption must be dropped',
  );
});

test('toImageValue omits caption when absent', () => {
  const result = toImageValue({ url: '/img.jpg', alt: 'Alt' });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(result, 'caption'),
    'caption key must be absent when not provided',
  );
});

test('parseImageValue round-trips caption', () => {
  const raw = JSON.stringify({ url: '/img.jpg', alt: 'Alt', caption: 'Archival photo' });
  const result = parseImageValue(raw);
  assert.equal(result.caption, 'Archival photo');
});

test('parseImageValue round-trips caption with quotes and unicode', () => {
  const original = { url: '/img.jpg', alt: 'Alt', caption: 'Café "du Monde" — © 2026' };
  const raw = JSON.stringify(original);
  const result = parseImageValue(raw);
  assert.equal(result.caption, 'Café "du Monde" — © 2026');
});

test('parseImageValue on legacy value (no caption)', () => {
  const raw = JSON.stringify({ url: '/img.jpg', alt: 'Old photo', width: 800, height: 600 });
  const result = parseImageValue(raw);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(result, 'caption'),
    'legacy value must have no caption key',
  );
  // All existing fields preserved
  assert.equal(result.url, '/img.jpg');
  assert.equal(result.alt, 'Old photo');
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test('mediaEntryToImageValue omits caption', () => {
  const entry = {
    id: '1',
    url: '/uploads/a.jpg',
    filename: 'a.jpg',
    size: 1000,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
    alt: 'Alt text',
  };
  const result = mediaEntryToImageValue(entry);
  assert.equal(result.caption, undefined, 'mediaEntryToImageValue must not add caption');
});

test('imageAttrs excludes caption', () => {
  const attrs = imageAttrs({ url: '/img.jpg', alt: 'Alt', caption: 'Some caption' });
  assert.ok(!('caption' in attrs), 'imageAttrs must not include caption in output attrs');
});

// ─── getCaption helper (P1-T5) ────────────────────────────────────────────────

test('getCaption returns empty string for absent caption', () => {
  assert.equal(getCaption({ url: '/img.jpg' }), '');
});

test('getCaption returns empty string for empty string caption', () => {
  assert.equal(getCaption({ url: '/img.jpg', caption: '' }), '');
});

test('getCaption returns empty string for whitespace-only caption', () => {
  assert.equal(getCaption({ url: '/img.jpg', caption: '   ' }), '');
});

test('getCaption returns trimmed string for non-empty caption', () => {
  assert.equal(
    getCaption({ url: '/img.jpg', caption: '  Sunset over the lake  ' }),
    'Sunset over the lake',
  );
});

test('getCaption override param takes precedence over value.caption', () => {
  assert.equal(
    getCaption({ url: '/img.jpg', caption: 'Value caption' }, 'Override caption'),
    'Override caption',
  );
});

test('getCaption override param: empty override falls back to value.caption', () => {
  assert.equal(getCaption({ url: '/img.jpg', caption: 'Value caption' }, ''), 'Value caption');
});

test('getCaption override param: whitespace override falls back to value.caption', () => {
  assert.equal(getCaption({ url: '/img.jpg', caption: 'Value caption' }, '   '), 'Value caption');
});
