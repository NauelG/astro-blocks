/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import astroBlocks, { assertAdapterConfigured } from '../dist/plugin/index.js';

const anAdapter = { name: '@astrojs/node' };

// Capture console.warn output for the duration of `fn`.
function captureWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

// ─── Pure guard: assertAdapterConfigured ──────────────────────────────────────

test('build with no adapter throws an actionable error', () => {
  assert.throws(
    () => assertAdapterConfigured('build', undefined),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /astro-blocks/);
      assert.match(err.message, /adapter/i);
      assert.match(err.message, /Aborting build/);
      return true;
    }
  );
});

test('build with an adapter present does not throw', () => {
  assert.doesNotThrow(() => assertAdapterConfigured('build', anAdapter));
});

// Non-build commands warn (never throw) when the adapter is missing, so local
// workflows like `astro dev` / `astro sync` keep working.
for (const command of ['dev', 'preview', 'sync']) {
  test(`${command} with no adapter warns but does not throw`, () => {
    let warnings;
    assert.doesNotThrow(() => {
      warnings = captureWarnings(() => assertAdapterConfigured(command, undefined));
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /astro-blocks/);
    assert.match(warnings[0], /astro build.*will fail/);
    // The warning must not hard-code `astro dev`, which is misleading for sync/preview.
    assert.doesNotMatch(warnings[0], /works under `astro dev`/);
  });

  test(`${command} with an adapter present is silent`, () => {
    const warnings = captureWarnings(() => assertAdapterConfigured(command, anAdapter));
    assert.equal(warnings.length, 0);
  });
}

// ─── End-to-end hook wiring: config:setup captures command → config:done guards ──
// Exercises the real closure (astroCommand) rather than the pure function alone.

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-adapter-guard-'));
  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
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

async function runSetup(integration, tempRoot, command) {
  const configStub = {
    root: tempRoot,
    vite: { define: {}, resolve: { alias: {} }, server: {}, ssr: {} },
  };
  await integration.hooks['astro:config:setup']({
    config: configStub,
    command,
    injectRoute: () => {},
  });
}

// Each astroBlocks() call returns a fresh integration with its own `astroCommand` closure.

test('e2e: config:done throws when build ran config:setup with no adapter', async () => {
  await withTempProject(async (tempRoot) => {
    const integration = astroBlocks({ blocks: [] });
    await runSetup(integration, tempRoot, 'build');
    assert.throws(
      () => integration.hooks['astro:config:done']({ config: { adapter: undefined } }),
      /Aborting build/
    );
  });
});

test('e2e: config:done stays silent when build has an adapter', async () => {
  await withTempProject(async (tempRoot) => {
    const integration = astroBlocks({ blocks: [] });
    await runSetup(integration, tempRoot, 'build');
    const warnings = captureWarnings(() =>
      assert.doesNotThrow(() =>
        integration.hooks['astro:config:done']({ config: { adapter: anAdapter } })
      )
    );
    assert.equal(warnings.length, 0);
  });
});

test('e2e: config:done warns (no throw) when dev ran config:setup with no adapter', async () => {
  await withTempProject(async (tempRoot) => {
    const integration = astroBlocks({ blocks: [] });
    await runSetup(integration, tempRoot, 'dev');
    const warnings = captureWarnings(() =>
      assert.doesNotThrow(() =>
        integration.hooks['astro:config:done']({ config: { adapter: undefined } })
      )
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /astro-blocks/);
  });
});
