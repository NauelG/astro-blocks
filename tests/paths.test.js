import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveUploadPath } from '../dist/utils/paths.js';

test('resolveUploadPath accepts valid upload URLs', () => {
  const resolved = resolveUploadPath('/uploads/2026/03/image.png');
  assert.ok(resolved);
  assert.match(resolved, /public\/uploads\/2026\/03\/image\.png$/);
});

test('resolveUploadPath rejects path traversal', () => {
  assert.equal(resolveUploadPath('/uploads/../secret.txt'), null);
  assert.equal(resolveUploadPath('/other/path.txt'), null);
});
