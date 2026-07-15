/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Source-level guard: asserts that admin upload call sites surface failures to
 * the user instead of swallowing them (issue #31).
 *
 * Two client call sites previously ignored non-2xx / network upload failures:
 *   - page-editor.ts  uploadSeoImage()  — threw inside an unawaited async fn
 *   - block-form/picker-dialog.ts  picker upload — only acted on `if (uploadRes.ok)`
 *     (lived in block-form.ts until the #38 decomposition)
 *
 * Both must now route failures through showToast(...) with the shared
 * media.uploadError / media.uploadFailed i18n keys, mirroring media.ts.
 *
 * These are DOM event handlers with no jsdom harness in this suite, so we guard
 * at the source level (same approach as block-form-attr-escaping.test.js) to
 * catch any future regression in CI before it ships.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const pageEditor = await readFile(join(root, 'src/routes/admin/client/page-editor.ts'), 'utf-8');
const pickerDialog = await readFile(
  join(root, 'src/routes/admin/client/block-form/picker-dialog.ts'),
  'utf-8',
);

test('page-editor.ts — SEO image upload surfaces failures via showToast', () => {
  const fn = pageEditor.slice(
    pageEditor.indexOf('async function uploadSeoImage'),
    pageEditor.indexOf('async function removeSeoImage'),
  );
  assert.ok(fn.length > 0, 'uploadSeoImage() not found');
  assert.ok(
    !/throw new Error/.test(fn),
    'uploadSeoImage() still throws instead of surfacing the error to the user',
  );
  assert.ok(
    /media\.uploadError/.test(fn),
    'uploadSeoImage() must call showToast with the media.uploadError title',
  );
  // Guard against a silent-swallow regression on the non-2xx branch specifically:
  // the response-error path (distinct from the network-error catch, which uses
  // ct('media.uploadFailed')) must forward the server-provided error message.
  assert.ok(
    /showToast\(\s*data\.error/.test(fn),
    'uploadSeoImage() must forward the server error (data.error) to showToast on a non-ok response',
  );
});

test('block-form/picker-dialog.ts — picker upload surfaces failures via showToast', () => {
  const handler = pickerDialog.slice(
    pickerDialog.indexOf("uploadBtn?.addEventListener('click'"),
    pickerDialog.indexOf('uploadBtn.disabled = false;'),
  );
  assert.ok(handler.length > 0, 'picker upload handler not found');
  assert.ok(
    /media\.uploadError/.test(handler),
    'picker upload must use the media.uploadError title',
  );
  // The non-ok branch must READ the server error body and surface it. This
  // cannot be satisfied by an empty `else {}` (the issue #31 regression) nor by
  // the network-error catch block, which uses ct('media.uploadFailed') and never
  // parses the response — so it pins the exact bug this guard exists to catch.
  assert.ok(
    /const errBody = \(?await uploadRes\.json\(\)/.test(handler),
    'picker upload must read the server error body on a non-ok response',
  );
  assert.ok(
    /showToast\(\s*errBody\.error/.test(handler),
    'picker upload must forward the server error (errBody.error) to showToast on a non-ok response',
  );
});
