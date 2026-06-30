/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * plugin-resolve-options.test.js
 *
 * Tests for Slice C tasks:
 *   C3 — resolveOptions: allowedFileTypes dedup+lowercase wiring
 *   C3 — vite.define: ASTRO_BLOCKS_ALLOWED_FILE_TYPES bridge
 *   C4 — validateFileProps: warn-and-drop for out-of-allowlist accept MIMEs
 *   C5 — DEFAULT_ALLOWED_FILE_TYPES importable from package root
 *
 * Spec: R1.1-A, R1.2-A, R1.3-A, R1.4-A, R7.2-A, R7.3-A
 * Design: plugin/index.ts resolveOptions + vite.define, ADR-6
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_ALLOWED_FILE_TYPES } from '../dist/utils/file-types.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-plugin-opts-'));
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

/**
 * Simulate astro:config:setup enough to call resolveOptions + vite.define.
 * We import the plugin default, call it with options, then invoke the
 * astro:config:setup hook with a minimal stub config, and return the
 * mutated vite config.
 *
 * resolveOptions is not exported directly; we exercise it through the hook.
 */
async function runSetupHook(options, tempRoot) {
  // Load the plugin. Cache-bust so different option combos load fresh.
  const url =
    new URL('../dist/plugin/index.js', import.meta.url).href +
    `?cb=${Date.now()}-${Math.random()}`;
  const { default: astroBlocks } = await import(url);

  const integration = astroBlocks({ blocks: [], ...options });

  // Minimal vite config stub
  const viteStub = { define: {}, resolve: { alias: {} }, server: {}, ssr: {} };
  const configStub = { root: tempRoot, vite: viteStub };

  // The hook is async
  const hook = integration.hooks['astro:config:setup'];
  await hook({ config: configStub, injectRoute: () => {} });

  return configStub.vite;
}

// ─── C5: DEFAULT_ALLOWED_FILE_TYPES importable from package root ──────────────
// Spec R1.1-A (D2): "DEFAULT_ALLOWED_FILE_TYPES is a named export from the package root"

test('C5: DEFAULT_ALLOWED_FILE_TYPES is importable from package root', async () => {
  const url =
    new URL('../dist/plugin/index.js', import.meta.url).href +
    `?cb=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  assert.ok(
    'DEFAULT_ALLOWED_FILE_TYPES' in mod,
    'DEFAULT_ALLOWED_FILE_TYPES must be exported from plugin/index.js (package root)'
  );
  assert.deepEqual(
    [...mod.DEFAULT_ALLOWED_FILE_TYPES].sort(),
    [...DEFAULT_ALLOWED_FILE_TYPES].sort(),
    'root re-export must match utils/file-types.ts source'
  );
});

// ─── C3: resolveOptions — allowedFileTypes defaults ──────────────────────────

test('C3 R1.1-A: resolveOptions defaults allowedFileTypes to DEFAULT_ALLOWED_FILE_TYPES', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook({}, tempRoot);
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined, 'vite.define must have ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
    const parsed = JSON.parse(raw);
    assert.deepEqual(
      [...parsed].sort(),
      [...DEFAULT_ALLOWED_FILE_TYPES].sort(),
      'default allowedFileTypes must equal DEFAULT_ALLOWED_FILE_TYPES'
    );
  });
});

test('C3 R1.2-A: resolveOptions uses custom allowedFileTypes (replaces defaults)', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook({ allowedFileTypes: ['image/jpeg', 'application/pdf'] }, tempRoot);
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.sort(), ['application/pdf', 'image/jpeg'], 'custom list must replace defaults');
  });
});

test('C3 R1.3-A: resolveOptions deduplicates and lowercases allowedFileTypes', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook(
      { allowedFileTypes: ['Image/JPEG', 'image/jpeg', 'Application/PDF', 'APPLICATION/PDF'] },
      tempRoot
    );
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.sort(), ['application/pdf', 'image/jpeg'], 'dedup+lowercase must reduce to 2 entries');
  });
});

// ─── C3: vite.define bridge ───────────────────────────────────────────────────

test('C3 R1.4-A: vite.define ASTRO_BLOCKS_ALLOWED_FILE_TYPES matches resolved allowlist', async () => {
  await withTempProject(async (tempRoot) => {
    const custom = ['image/jpeg', 'application/pdf'];
    const vite = await runSetupHook({ allowedFileTypes: custom }, tempRoot);
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined, 'define key must be present');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.sort(), [...custom].sort(), 'define value must deep-equal resolved allowlist');
  });
});

// ─── I2: allowedFileTypes: [] emits empty-allowlist warn ─────────────────────

test('I2: allowedFileTypes:[] resolves to [] and emits empty-allowlist warn', async () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    await withTempProject(async (tempRoot) => {
      const vite = await runSetupHook({ allowedFileTypes: [] }, tempRoot);
      const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
      assert.ok(raw !== undefined, 'vite.define must have ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed, [], 'empty allowedFileTypes must resolve to []');
      assert.ok(
        warns.some((w) => w.includes('allowedFileTypes is empty')),
        `expected empty-allowlist warn, got: ${JSON.stringify(warns)}`
      );
      assert.ok(
        warns.some((w) => w.includes('all file uploads will be rejected')),
        `expected rejection warning in message, got: ${JSON.stringify(warns)}`
      );
    });
  } finally {
    console.warn = origWarn;
  }
});

// ─── C4: validateFileProps advisory warn (ADR-6) ─────────────────────────────

test('C4 R7.2-A: out-of-allowlist MIME emits advisory warn (will be ignored by the media picker)', async () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    const { validateFileProps } = await import(
      new URL('../dist/plugin/index.js', import.meta.url).href +
      `?cb=${Date.now()}-${Math.random()}`
    );
    assert.ok(typeof validateFileProps === 'function', 'validateFileProps must be exported');

    const blocks = [
      {
        name: 'Download',
        items: {
          brochure: {
            type: 'file',
            label: 'Brochure',
            accept: ['application/pdf', 'application/msword'],
          },
        },
      },
    ];
    const allowedFileTypes = ['image/jpeg', 'application/pdf'];
    validateFileProps(blocks, allowedFileTypes);

    assert.ok(
      warns.some((w) => w.includes('application/msword')),
      `expected a warn about "application/msword", got: ${JSON.stringify(warns)}`
    );
    assert.ok(
      warns.some((w) => w.includes('Download')),
      `expected block name "Download" in warn, got: ${JSON.stringify(warns)}`
    );
    assert.ok(
      warns.some((w) => w.includes('brochure')),
      `expected prop name "brochure" in warn, got: ${JSON.stringify(warns)}`
    );
    assert.ok(
      warns.some((w) => w.includes('will be ignored by the media picker')),
      `expected new wording "will be ignored by the media picker", got: ${JSON.stringify(warns)}`
    );
    assert.ok(
      !warns.some((w) => w.includes('was dropped')),
      `must NOT use old wording "was dropped", got: ${JSON.stringify(warns)}`
    );
  } finally {
    console.warn = origWarn;
  }
});

test('C4 R7.3-A: file prop with no accept emits no warn', async () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    const { validateFileProps } = await import(
      new URL('../dist/plugin/index.js', import.meta.url).href +
      `?cb=${Date.now()}-${Math.random()}`
    );
    const blocks = [
      {
        name: 'Download',
        items: { brochure: { type: 'file', label: 'Brochure' } },
      },
    ];
    validateFileProps(blocks, ['image/jpeg', 'application/pdf']);
    assert.equal(warns.length, 0, `expected no warns, got: ${JSON.stringify(warns)}`);
  } finally {
    console.warn = origWarn;
  }
});

test('C4: valid accept subset emits no warn', async () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    const { validateFileProps } = await import(
      new URL('../dist/plugin/index.js', import.meta.url).href +
      `?cb=${Date.now()}-${Math.random()}`
    );
    const blocks = [
      {
        name: 'Download',
        items: { brochure: { type: 'file', label: 'Brochure', accept: ['application/pdf'] } },
      },
    ];
    validateFileProps(blocks, ['image/jpeg', 'application/pdf']);
    assert.equal(warns.length, 0, `expected no warns, got: ${JSON.stringify(warns)}`);
  } finally {
    console.warn = origWarn;
  }
});

test('C4: non-file props are ignored by validateFileProps', async () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    const { validateFileProps } = await import(
      new URL('../dist/plugin/index.js', import.meta.url).href +
      `?cb=${Date.now()}-${Math.random()}`
    );
    const blocks = [
      {
        name: 'Hero',
        items: {
          title: { type: 'string', label: 'Title' },
          hero: { type: 'image', label: 'Hero image' },
        },
      },
    ];
    validateFileProps(blocks, ['image/jpeg']);
    assert.equal(warns.length, 0, `non-file props must not trigger warns`);
  } finally {
    console.warn = origWarn;
  }
});
