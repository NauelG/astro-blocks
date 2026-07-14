/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The file-type configuration contract (ADR-0023).
 *
 * The rule these tests exist to hold: a consumer can ask for a type the system does not
 * support, and when they do, they learn it at BUILD time, in a message that tells them what
 * to do next — not at upload time, in a 415 that says nothing.
 *
 * And the security rule underneath it: customFileTypes REGISTERS, it never BYPASSES.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateFileTypeConfig } from '../dist/plugin/index.js';

const DEFAULTS = ['image/jpeg', 'image/png', 'application/pdf'];

// ─── V4: an unsupported MIME fails the build ─────────────────────────────────

test('V4: a MIME with no catalog row throws, and the message names it', () => {
  assert.throws(
    () => validateFileTypeConfig([...DEFAULTS, 'application/zip']),
    (err) => {
      assert.match(err.message, /application\/zip/, 'the message must name the offending MIME');
      assert.match(err.message, /customFileTypes/, 'and tell the consumer how to fix it');
      return true;
    },
  );
});

test('V4: the error lists the supported types, so the consumer can see what they can pick', () => {
  try {
    validateFileTypeConfig(['application/zip']);
    assert.fail('expected a throw');
  } catch (err) {
    assert.match(err.message, /image\/jpeg/);
    assert.match(err.message, /video\/mp4/);
  }
});

test('V4: video/mp4 is accepted once the consumer opts in — the reported incident, at config level', () => {
  assert.doesNotThrow(() => validateFileTypeConfig([...DEFAULTS, 'video/mp4']));
});

test('V4: a MIME registered via customFileTypes is then allowed', () => {
  assert.doesNotThrow(() =>
    validateFileTypeConfig(
      [...DEFAULTS, 'application/zip'],
      [{ mime: 'application/zip', ext: '.zip', category: 'document' }],
    ),
  );
});

test('V4: the default allowlist alone always validates', () => {
  assert.doesNotThrow(() => validateFileTypeConfig(DEFAULTS));
  assert.doesNotThrow(() => validateFileTypeConfig([]));
});

// ─── V1/V2: the denylist beats the escape hatch ──────────────────────────────
//
// This is the property that keeps ADR-0018's central promise intact. Payload CMS gets this
// wrong in the opposite direction: defining `mimeTypes` on a collection skips its executable
// denylist entirely, so `mimeTypes: ['image/*']` silently disables it.

test('V1: registering a denylisted MIME throws', () => {
  for (const mime of ['text/html', 'application/javascript', 'application/x-msdownload']) {
    assert.throws(
      () => validateFileTypeConfig([mime], [{ mime, ext: '.dat', category: 'document' }]),
      /denylist/,
      `${mime} must be refused`,
    );
  }
});

test('V1: the denylist regex catches MIME families, not just the exact set', () => {
  assert.throws(
    () =>
      validateFileTypeConfig(
        ['text/javascript'],
        [{ mime: 'text/javascript', ext: '.dat', category: 'document' }],
      ),
    /denylist/,
  );
});

test('V2: registering a denylisted extension throws, even under a harmless MIME', () => {
  for (const ext of ['.js', '.html', '.exe', '.svgz']) {
    assert.throws(
      () =>
        validateFileTypeConfig(
          ['application/x-thing'],
          [{ mime: 'application/x-thing', ext, category: 'document' }],
        ),
      /denylist/,
      `${ext} must be refused`,
    );
  }
});

// ─── V3: a registration cannot shadow a builtin ──────────────────────────────

test('V3: redefining a builtin type throws — an audited serving policy cannot be overridden', () => {
  assert.throws(
    () =>
      validateFileTypeConfig(
        ['image/png'],
        [{ mime: 'image/png', ext: '.png', category: 'document' }],
      ),
    /already a builtin/,
  );
});

test('V3: an SVG cannot be re-registered to escape its attachment disposition', () => {
  assert.throws(
    () =>
      validateFileTypeConfig(
        ['image/svg+xml'],
        [{ mime: 'image/svg+xml', ext: '.svg', category: 'image' }],
      ),
    /already a builtin/,
    'this is the stored-XSS path ADR-0018 closed; the escape hatch must not reopen it',
  );
});

test('duplicate registrations throw', () => {
  assert.throws(
    () =>
      validateFileTypeConfig(
        [],
        [
          { mime: 'application/zip', ext: '.zip', category: 'document' },
          { mime: 'application/zip', ext: '.zip2', category: 'document' },
        ],
      ),
    /duplicate/i,
  );
});

// ─── Shape validation ────────────────────────────────────────────────────────

test('a malformed ext throws', () => {
  for (const ext of ['zip', '.ZIP!', '', '.']) {
    assert.throws(
      () => validateFileTypeConfig([], [{ mime: 'application/zip', ext, category: 'document' }]),
      /invalid ext/,
      `ext "${ext}" must be refused`,
    );
  }
});

test('an invalid category throws — the enum is closed', () => {
  assert.throws(
    () =>
      validateFileTypeConfig(
        [],
        [{ mime: 'application/zip', ext: '.zip', category: 'spreadsheet' }],
      ),
    /invalid category/,
  );
});

test('a malformed mime throws', () => {
  assert.throws(
    () => validateFileTypeConfig([], [{ mime: 'zip', ext: '.zip', category: 'document' }]),
    /invalid mime/,
  );
});
