---
name: node-test-runner
description: Unit testing patterns for astro-blocks using the built-in Node.js test runner. Covers node:test imports, node:assert/strict assertions, withTempProject temp-dir isolation, env-var save/restore, async test syntax, and subset run commands. Use when writing unit tests, running node --test, using node:test or assert/strict, isolating tests with withTempProject, or running a subset of tests with --test-name-pattern.
license: MIT
metadata:
  authors: "astro-blocks"
  version: "0.1.0"
---

# Node.js Test Runner

## Overview

This skill covers unit testing in **astro-blocks** using the built-in `node:test` runner and `node:assert/strict` assertion module. All 16 test files under `tests/` follow this pattern — no jest, no vitest, no extra frameworks.

Tests import from `../dist/...` (the compiled output), so a build step is always required before running. End-to-end browser tests are **not** in scope here — use the `playwright-best-practices` skill for those.

---

## When to Use

- Writing a new `tests/*.test.js` file for an API handler, utility, or contract function.
- Debugging a failing or flaky async test.
- Running only one test file or one named test during development.
- Looking up the `withTempProject` isolation pattern (used in every file that touches `data/`).
- Looking up env-var save/restore idiom (`ASTRO_BLOCKS_PROJECT_ROOT`).

---

## Running Tests

### Full suite

```bash
npm test
# expands to: npm run build && node --test tests/*.test.js
```

Defined in `package.json:48`. Build is mandatory — tests import from `../dist/`.

### Single file

```bash
node --test tests/configs-handlers.test.js
```

### Subset by name (regex)

```bash
node --test --test-name-pattern="CRUD" tests/*.test.js
```

### Watch mode (Node ≥ 22)

```bash
node --test --watch tests/cache.test.js
```

---

## Test Structure

### Imports

Every test file starts with the same two imports (see `tests/cache.test.js:6-7`, `tests/contract.test.js:1-2`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
```

Import additional node modules (`fs`, `os`, `path`) as needed. Import the module under test from `../dist/...`.

### Top-level test (flat)

```js
test('getPageCachePath normalizes homepage', () => {
  assert.equal(getPageCachePath({ slug: '/' }), '/');
});
```

### Async test

```js
test('ensureDefaultFiles creates configs.json', async () => {
  await withTempProject(async (tempRoot) => {
    const raw = await fs.readFile(path.join(tempRoot, 'data', 'configs.json'), 'utf-8');
    assert.deepEqual(JSON.parse(raw), { configs: [] });
  });
});
```

---

## Patterns

### `withTempProject` — temp-dir isolation

Every test that reads or writes `data/` files must use `withTempProject`. The helper is defined **inline** in each test file (not a shared import). Copy this verbatim:

```js
// tests/configs-handlers.test.js:20-38
async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-<suite>-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
```

Replace `<suite>` with a short name matching the test file (e.g. `astro-blocks-configs-`, `astro-blocks-redirects-`).

Usage:

```js
test('handlers support CRUD', async () => {
  await withTempProject(async (tempRoot) => {
    // tempRoot is the isolated project root for this test
  });
});
```

### Env-var save/restore (without `ensureDefaultFiles`)

For simpler tests that only need a custom project root without calling `ensureDefaultFiles`, use the inline try/finally pattern (see `tests/get-config.test.js:15-47`):

```js
// tests/get-config.test.js:15-16
const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-get-config-'));

try {
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  // ... test body
} finally {
  if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
  await fs.rm(tempRoot, { recursive: true, force: true });
}
```

Key rule: always check `=== undefined` before deciding whether to `delete` or restore the env var. Never blindly assign `undefined`.

### `node:assert/strict` — assertion styles

```js
// Strict equality (===)
assert.equal(response.status, 200);

// Deep structural equality
assert.deepEqual(JSON.parse(raw), { configs: [] });

// Regex match on a string
// tests/contract.test.js:45
assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: {} }])?.message || '', /campo "Title" es obligatorio/);

// Truthy (array membership, booleans)
assert.ok(tags.includes('astro-blocks'));

// Async rejection — assert a promise rejects
await assert.rejects(
  async () => someAsyncFn(),
  { message: /expected error pattern/ }
);
```

### Importing from `dist/`

Tests always import from the compiled output, never from `src/`:

```js
// tests/cache.test.js:9-18
import { CACHE_PATHS, getGlobalCachePaths } from '../dist/utils/cache.js';

// tests/configs-handlers.test.js:12-18
import { ensureDefaultFiles, loadConfigs } from '../dist/api/data.js';
import { handleDeleteConfig, handleGetConfigs } from '../dist/api/handlers.js';
```

If a new module is added under `src/`, run `npm run build` before the test file can import from `../dist/`.

---

## Compact Rules

- Run the full suite with `npm test` (builds first); never run `node --test` without a prior build.
- Import `test` from `node:test` and `assert` from `node:assert/strict` — no other test frameworks.
- Use `withTempProject(fn)` for every test that touches `data/` files; define it inline per test file.
- Save env vars before mutation (`const prev = process.env.X`); restore in `finally`; use `delete` when `prev === undefined`.
- Import modules under test from `../dist/...`, not `../src/...`.
- Use `assert.equal` for scalar equality, `assert.deepEqual` for objects/arrays, `assert.match` for regex, `assert.rejects` for async errors.
- Run a subset with `--test-name-pattern=<regex>` or a single file with `node --test tests/<file>.test.js`.
