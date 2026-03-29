/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadConfigs } from '../dist/api/data.js';
import {
  handleDeleteConfig,
  handleGetConfigs,
  handlePostConfigs,
  handlePutConfig,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-configs-'));

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

test('ensureDefaultFiles creates configs.json', async () => {
  await withTempProject(async (tempRoot) => {
    const configsPath = path.join(tempRoot, 'data', 'configs.json');
    const raw = await fs.readFile(configsPath, 'utf-8');
    const data = JSON.parse(raw);

    assert.deepEqual(data, { configs: [] });
  });
});

test('config handlers support CRUD and key updates', async () => {
  await withTempProject(async () => {
    const postResponse = await handlePostConfigs(
      new Request('http://localhost/cms/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'GOOGLE_MAPS_API_KEY',
          value: 'AIza-123',
          description: 'Google Maps key',
        }),
      })
    );

    assert.equal(postResponse.status, 200);
    const created = await postResponse.json();
    assert.equal(created.key, 'GOOGLE_MAPS_API_KEY');
    assert.equal(created.value, 'AIza-123');
    assert.equal(created.description, 'Google Maps key');
    assert.ok(created.id);

    const getResponse = await handleGetConfigs();
    const listed = await getResponse.json();
    assert.equal(Array.isArray(listed.configs), true);
    assert.equal(listed.configs.length, 1);

    const putResponse = await handlePutConfig(
      created.id,
      new Request(`http://localhost/cms/api/configs/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'FORM_RECIPIENT',
          value: 'forms@example.com',
          description: 'Forms destination',
        }),
      })
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.key, 'FORM_RECIPIENT');
    assert.equal(updated.value, 'forms@example.com');
    assert.equal(updated.description, 'Forms destination');

    const deleteResponse = await handleDeleteConfig(created.id);
    assert.equal(deleteResponse.status, 204);

    const afterDelete = await loadConfigs();
    assert.equal(afterDelete.configs.length, 0);
  });
});

test('config handlers validate key format and case-insensitive duplicates', async () => {
  await withTempProject(async () => {
    const first = await handlePostConfigs(
      new Request('http://localhost/cms/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'Form_Recipient', value: 'a@example.com' }),
      })
    );

    assert.equal(first.status, 200);
    const firstJson = await first.json();

    const duplicate = await handlePostConfigs(
      new Request('http://localhost/cms/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'form_recipient', value: 'b@example.com' }),
      })
    );

    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error, 'Ya existe un parámetro con esa clave.');

    const invalidKey = await handlePostConfigs(
      new Request('http://localhost/cms/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: '1INVALID', value: 'x' }),
      })
    );

    assert.equal(invalidKey.status, 400);
    assert.equal(
      (await invalidKey.json()).error,
      'La clave debe empezar por una letra y solo puede contener letras, números, punto, guion y guion bajo.'
    );

    const second = await handlePostConfigs(
      new Request('http://localhost/cms/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'GOOGLE_MAPS_API_KEY', value: 'k2' }),
      })
    );

    assert.equal(second.status, 200);
    const secondJson = await second.json();

    const renameConflict = await handlePutConfig(
      secondJson.id,
      new Request(`http://localhost/cms/api/configs/${secondJson.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: firstJson.key.toLowerCase(), value: 'new-value' }),
      })
    );

    assert.equal(renameConflict.status, 400);
    assert.equal((await renameConflict.json()).error, 'Ya existe un parámetro con esa clave.');
  });
});
