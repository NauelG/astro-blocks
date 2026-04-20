/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const consumerMd = await readFile(join(root, 'AGENTS.consumer.md'), 'utf-8');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));

const REQUIRED_HEADINGS = [
  '# AstroBlocks — AI Agent Context for Consumers',
  '## What This File Is',
  '## Prerequisites',
  '## Installation',
  '## Integration Options Reference',
  '## Block Development',
  '## Import Map (all public export paths)',
  '## Data Model (files the plugin creates in your project)',
  '## CMS Admin Routes (plugin-managed, read-only for consumers)',
  '## Authentication (admin UI)',
  '## Environment Variables Reference (complete list)',
  '## Versioning and Updates',
  '## License and Support',
];

test('AGENTS.consumer.md — structural coverage', async (t) => {
  await t.test('file exists at repo root', () => {
    assert.ok(consumerMd.length > 0, 'AGENTS.consumer.md is empty or missing');
  });

  await t.test('contains all required headings verbatim', () => {
    for (const heading of REQUIRED_HEADINGS) {
      assert.ok(consumerMd.includes(heading), `Missing heading: ${heading}`);
    }
  });

  await t.test('mentions every package.json#exports key', () => {
    for (const key of Object.keys(pkg.exports)) {
      assert.ok(consumerMd.includes(key), `Missing export key: ${key}`);
    }
  });

  await t.test('mentions every package.json#bin entry', () => {
    for (const name of Object.keys(pkg.bin || {})) {
      assert.ok(consumerMd.includes(name), `Missing bin entry: ${name}`);
    }
  });

  await t.test('frames admin routes as plugin-managed (not customizable)', () => {
    assert.match(consumerMd, /INJECTED|injected/);
    assert.ok(!/how to modify admin routes/i.test(consumerMd), 'Should NOT document how to modify admin routes');
  });
});
