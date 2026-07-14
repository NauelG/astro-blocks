import test from 'node:test';
import assert from 'node:assert/strict';

import * as handlers from '../dist/api/handlers.js';

/**
 * Locked baseline of the public runtime export surface of src/api/handlers.ts,
 * captured before the PR1 slice of the decompose-handlers refactor (P1-1).
 *
 * `src/api/handlers.ts` is decomposed incrementally across several chained PRs
 * into `api/handlers/*` domain modules, always re-exported from a real,
 * on-disk `src/api/handlers.ts` shim (required under NodeNext module resolution).
 * This test guards that every chained PR preserves the exact same runtime-visible
 * named exports — no additions, no removals, no renames — regardless of how the
 * implementation is internally reorganized.
 *
 * Note: `JwtSecretStatus` is a type-only export and is erased at runtime, so it
 * intentionally does not appear in this list.
 */
const EXPECTED_EXPORT_NAMES = [
  'localizedJsonError',
  'classifyJwtSecret',
  'resetAllowedFileTypesCache',
  '__setAllowedFileTypesForTest',
  'hashPassword',
  'verifyPassword',
  'getAuth',
  'requireOwner',
  'handleLogin',
  'handleAuthMe',
  'handleAuthStatus',
  'handleGetUsers',
  'handlePostUsers',
  'handlePutUser',
  'handleDeleteUser',
  'handleGetLanguages',
  'handlePostLanguages',
  'handlePutLanguage',
  'handleDeleteLanguage',
  'handleGetPages',
  'handleGetBlockSchemas',
  'handlePostPages',
  'handlePutPage',
  'handleDeletePage',
  'handleGetSite',
  'handlePutSite',
  'handleGetMenus',
  'handlePostMenus',
  'handlePutMenu',
  'handleDeleteMenu',
  'handleGetRedirects',
  'handlePostRedirects',
  'handlePutRedirect',
  'handleDeleteRedirect',
  'handleGetConfigs',
  'handlePostConfigs',
  'handlePutConfig',
  'handleDeleteConfig',
  'handleUpload',
  'handleDeleteUpload',
  'handleGetMedia',
  'handleUpdateMediaAlt',
  'handleGetMediaUsage',
  'handleReplaceUpload',
  'handleGetGlobalBlocks',
  'handleGetGlobalBlock',
  'handlePutGlobalBlock',
  'handleInvalidateCache',
  'handleExport',
  'handleImport',
  'handleBootstrapImport',
].sort();

test('dist/api/handlers.js exports exactly the locked pre-refactor name set', () => {
  const actualNames = Object.keys(handlers).sort();
  assert.deepEqual(actualNames, EXPECTED_EXPORT_NAMES);
});

test('every exported handler/helper name resolves to a function', () => {
  for (const name of EXPECTED_EXPORT_NAMES) {
    assert.equal(typeof handlers[name], 'function', `${name} should be a function export`);
  }
});
