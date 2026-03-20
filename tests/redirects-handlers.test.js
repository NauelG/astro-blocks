/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadRedirects } from '../dist/api/data.js';
import {
  handleDeleteRedirect,
  handleGetRedirects,
  handlePostRedirects,
  handlePutRedirect,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-redirects-'));

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

test('ensureDefaultFiles creates redirects.json', async () => {
  await withTempProject(async (tempRoot) => {
    const redirectsPath = path.join(tempRoot, 'data', 'redirects.json');
    const raw = await fs.readFile(redirectsPath, 'utf-8');
    const data = JSON.parse(raw);

    assert.deepEqual(data, { redirects: [] });
  });
});

test('redirect handlers support CRUD and canonical path normalization', async () => {
  await withTempProject(async () => {
    const postResponse = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '/old-path/', to: '//new-path//', statusCode: 301, enabled: true }),
      })
    );

    assert.equal(postResponse.status, 200);
    const created = await postResponse.json();
    assert.equal(created.from, '/old-path');
    assert.equal(created.to, '/new-path');
    assert.equal(created.statusCode, 301);
    assert.equal(created.enabled, true);
    assert.ok(created.id);

    const getResponse = await handleGetRedirects();
    const listed = await getResponse.json();
    assert.equal(Array.isArray(listed.redirects), true);
    assert.equal(listed.redirects.length, 1);

    const putResponse = await handlePutRedirect(
      created.id,
      new Request(`http://localhost/cms/api/redirects/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusCode: 302, enabled: false }),
      })
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.statusCode, 302);
    assert.equal(updated.enabled, false);

    const deleteResponse = await handleDeleteRedirect(created.id);
    assert.equal(deleteResponse.status, 204);

    const afterDelete = await loadRedirects();
    assert.equal(afterDelete.redirects.length, 0);
  });
});

test('redirect handlers validate input and avoid duplicate origins', async () => {
  await withTempProject(async () => {
    const first = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '/old', to: '/new' }),
      })
    );

    assert.equal(first.status, 200);

    const duplicate = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '/old', to: '/another' }),
      })
    );

    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error, 'Ya existe una redirección con esa ruta de origen.');

    const external = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'https://example.com/old', to: '/new' }),
      })
    );

    assert.equal(external.status, 400);
    assert.equal((await external.json()).error, 'La ruta de origen debe ser interna (no se permiten URLs absolutas).');

    const samePath = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '/same/', to: '/same' }),
      })
    );

    assert.equal(samePath.status, 400);
    assert.equal((await samePath.json()).error, 'La ruta de origen y la de destino no pueden ser iguales.');

    const withQuery = await handlePostRedirects(
      new Request('http://localhost/cms/api/redirects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '/old?ref=1', to: '/new' }),
      })
    );

    assert.equal(withQuery.status, 400);
    assert.equal((await withQuery.json()).error, 'La ruta de origen no puede incluir query ni fragmento.');
  });
});
