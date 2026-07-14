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
 * Design: src/plugin/index.ts resolveOptions + vite.define, ADR-6
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_ALLOWED_FILE_TYPES } from '../dist/utils/file-catalog.js';

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
    new URL('../dist/plugin/index.js', import.meta.url).href + `?cb=${Date.now()}-${Math.random()}`;
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
    new URL('../dist/plugin/index.js', import.meta.url).href + `?cb=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  assert.ok(
    'DEFAULT_ALLOWED_FILE_TYPES' in mod,
    'DEFAULT_ALLOWED_FILE_TYPES must be exported from plugin/index.js (package root)',
  );
  assert.deepEqual(
    [...mod.DEFAULT_ALLOWED_FILE_TYPES].sort(),
    [...DEFAULT_ALLOWED_FILE_TYPES].sort(),
    'root re-export must match src/utils/file-types.ts source',
  );
});

// ─── Modelling what vite.define actually does ────────────────────────────────
//
// vite.define splices its value into the bundle as raw SOURCE. So a define value of
// `JSON.stringify(["a"])` becomes the array LITERAL ["a"] in the emitted code, while
// `JSON.stringify(JSON.stringify(["a"]))` becomes the string literal "[\"a\"]".
//
// These tests used to do a single JSON.parse on the define value and assert the array. That
// passes for BOTH encodings — which is why nobody noticed that ASTRO_BLOCKS_ALLOWED_FILE_TYPES
// was single-encoded, arrived at the runtime as an array, was rejected by
// getAllowedFileTypes()'s `typeof raw === 'string'` guard, and silently fell back to the
// shipped defaults. allowedFileTypes never reached the server in any released version, and
// that -- not the missing MIME_TO_EXT row -- is what produced the reported video/mp4 415.
//
// runtimeValueOf() models the substitution, so the tests now assert what the SERVER sees.

/** The value the runtime observes for `import.meta.env.X`, given the define source text. */
function runtimeValueOf(defineSource) {
  return JSON.parse(defineSource);
}

/** A JSON bridge must arrive at the runtime as a STRING, to be JSON.parsed there. */
function assertJsonBridge(defineSource, expected, key) {
  const runtimeValue = runtimeValueOf(defineSource);
  assert.equal(
    typeof runtimeValue,
    'string',
    `${key}: vite.define splices this in as source. It must evaluate to a STRING (double-encode ` +
      `it) or the runtime's typeof check rejects it and silently falls back to defaults.`,
  );
  assert.deepEqual(JSON.parse(runtimeValue), expected);
}

// ─── C3: resolveOptions — allowedFileTypes defaults ──────────────────────────

test('C3 R1.1-A: resolveOptions defaults allowedFileTypes to DEFAULT_ALLOWED_FILE_TYPES', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook({}, tempRoot);
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined, 'vite.define must have ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
    const runtimeValue = runtimeValueOf(raw);
    assert.equal(
      typeof runtimeValue,
      'string',
      'the bridge must arrive at the runtime as a string',
    );
    assert.deepEqual(
      [...JSON.parse(runtimeValue)].sort(),
      [...DEFAULT_ALLOWED_FILE_TYPES].sort(),
      'default allowedFileTypes must equal DEFAULT_ALLOWED_FILE_TYPES',
    );
  });
});

test('C3 R1.2-A: resolveOptions uses custom allowedFileTypes (replaces defaults)', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook(
      { allowedFileTypes: ['image/jpeg', 'application/pdf'] },
      tempRoot,
    );
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined);
    assertJsonBridge(raw, ['image/jpeg', 'application/pdf'], 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
  });
});

test('C3 R1.3-A: resolveOptions deduplicates and lowercases allowedFileTypes', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook(
      { allowedFileTypes: ['Image/JPEG', 'image/jpeg', 'Application/PDF', 'APPLICATION/PDF'] },
      tempRoot,
    );
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined);
    assertJsonBridge(raw, ['image/jpeg', 'application/pdf'], 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
  });
});

// ─── C3: vite.define bridge ───────────────────────────────────────────────────

test('C3 R1.4-A: vite.define ASTRO_BLOCKS_ALLOWED_FILE_TYPES matches resolved allowlist', async () => {
  await withTempProject(async (tempRoot) => {
    const custom = ['image/jpeg', 'application/pdf'];
    const vite = await runSetupHook({ allowedFileTypes: custom }, tempRoot);
    const raw = vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'];
    assert.ok(raw !== undefined, 'define key must be present');
    assertJsonBridge(raw, custom, 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
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
      assertJsonBridge(raw, [], 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES');
      assert.ok(
        warns.some((w) => w.includes('allowedFileTypes is empty')),
        `expected empty-allowlist warn, got: ${JSON.stringify(warns)}`,
      );
      assert.ok(
        warns.some((w) => w.includes('all file uploads will be rejected')),
        `expected rejection warning in message, got: ${JSON.stringify(warns)}`,
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
      `expected a warn about "application/msword", got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      warns.some((w) => w.includes('Download')),
      `expected block name "Download" in warn, got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      warns.some((w) => w.includes('brochure')),
      `expected prop name "brochure" in warn, got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      warns.some((w) => w.includes('will be ignored by the media picker')),
      `expected new wording "will be ignored by the media picker", got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      !warns.some((w) => w.includes('was dropped')),
      `must NOT use old wording "was dropped", got: ${JSON.stringify(warns)}`,
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

// ─── The bridge class ────────────────────────────────────────────────────────

test('every JSON vite.define bridge arrives at the runtime as a string', async () => {
  // This is the guard for the class of bug, not the instance. A single JSON.stringify(value)
  // becomes an object/array LITERAL in the bundle; the runtime readers all guard with
  // `typeof raw === 'string'` before JSON.parse, so a single-encoded bridge is not a loud
  // failure — it is a SILENT fallback to defaults. allowedFileTypes shipped that way and
  // nobody noticed, because the tests parsed the define value directly instead of modelling
  // the substitution.
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook(
      {
        allowedFileTypes: ['image/png', 'video/mp4'],
        customFileTypes: [{ mime: 'application/zip', ext: '.zip', category: 'document' }],
        maxUploadBytes: { video: 123 },
      },
      tempRoot,
    );

    const JSON_BRIDGES = [
      'import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES',
      'import.meta.env.ASTRO_BLOCKS_CUSTOM_FILE_TYPES',
      'import.meta.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY',
      'import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY',
    ];

    for (const key of JSON_BRIDGES) {
      const source = vite.define[key];
      assert.ok(source !== undefined, `${key} must be defined`);
      const runtimeValue = runtimeValueOf(source);
      assert.equal(
        typeof runtimeValue,
        'string',
        `${key} is single-encoded: the runtime will see a literal, its typeof check will ` +
          `reject it, and the configuration will be silently ignored. Double-encode it.`,
      );
      assert.doesNotThrow(() => JSON.parse(runtimeValue), `${key} must JSON.parse at runtime`);
    }
  });
});

test('maxUploadBytes crosses the vite.define bridge intact, per category', async () => {
  // limitFor() is `maxUploadBytes[cat] ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES ?? DEFAULT[cat]` — most
  // specific wins. The `??` chain itself is one line; what can actually break is the bridge, and
  // the bridge is where the allowlist silently died for its whole life. So assert the bridge.
  //
  // (The env-var half of the chain is exercised for real in tests/media-upload-limits.test.js.)
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook({ maxUploadBytes: { video: 123, image: 456 } }, tempRoot);
    const source = vite.define['import.meta.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY'];
    assertJsonBridge(
      source,
      { video: 123, image: 456 },
      'ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY',
    );
  });
});

test('an omitted maxUploadBytes crosses as an empty object, not undefined', async () => {
  await withTempProject(async (tempRoot) => {
    const vite = await runSetupHook({}, tempRoot);
    const source = vite.define['import.meta.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY'];
    assertJsonBridge(source, {}, 'ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY');
  });
});
