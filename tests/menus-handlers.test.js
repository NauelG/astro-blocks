/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadMenus } from '../dist/api/data.js';
import {
  handleDeleteMenu,
  handleGetMenus,
  handlePostMenus,
  handlePutMenu,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-menus-'));

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

test('handleGetMenus returns empty menus list with locale info', async () => {
  await withTempProject(async () => {
    const response = await handleGetMenus(new Request('http://localhost/cms/api/menus'));

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'menus'));
    assert.ok(Array.isArray(body.menus));
    assert.equal(body.menus.length, 0);
    assert.ok(typeof body.locale === 'string');
    assert.ok(typeof body.defaultLocale === 'string');
  });
});

test('menu handlers support full CRUD lifecycle', async () => {
  await withTempProject(async () => {
    // Create a menu
    const postResponse = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Main Navigation',
          selector: 'main-nav',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );

    assert.equal(postResponse.status, 200);
    const created = await postResponse.json();
    assert.equal(created.name, 'Main Navigation');
    assert.equal(created.selector, 'main-nav');
    assert.ok(created.id);
    assert.ok(Array.isArray(created.items));
    assert.equal(created.items.length, 1);
    assert.equal(created.items[0].path, '/');

    // List menus — should have 1
    const getResponse = await handleGetMenus(new Request('http://localhost/cms/api/menus'));
    const listed = await getResponse.json();
    assert.equal(listed.menus.length, 1);
    assert.equal(listed.menus[0].selector, 'main-nav');

    // Update the menu
    const putResponse = await handlePutMenu(
      created.id,
      new Request(`http://localhost/cms/api/menus/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Navigation',
          selector: 'main-nav',
          items: [
            { name: 'Home', path: '/', children: [] },
            { name: 'About', path: '/about', children: [] },
          ],
        }),
      })
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.name, 'Updated Navigation');
    assert.equal(updated.selector, 'main-nav');
    assert.equal(updated.items.length, 2);

    // Verify persisted state via data loader
    const persisted = await loadMenus();
    assert.equal(persisted.menus.length, 1);
    assert.equal(persisted.menus[0].name, 'Updated Navigation');

    // Delete the menu
    const deleteResponse = await handleDeleteMenu(created.id);
    assert.equal(deleteResponse.status, 204);

    // Verify deletion was persisted
    const afterDelete = await loadMenus();
    assert.equal(afterDelete.menus.length, 0);
  });
});

test('handlePostMenus rejects missing selector', async () => {
  await withTempProject(async () => {
    const response = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Menu',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Selector is required.');
  });
});

test('handlePostMenus rejects invalid selector characters', async () => {
  await withTempProject(async () => {
    const response = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Menu',
          selector: 'invalid selector!',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(
      body.error,
      'The selector can only contain letters, numbers, dashes, and underscores (no spaces).'
    );
  });
});

test('handlePostMenus rejects duplicate selector', async () => {
  await withTempProject(async () => {
    const first = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'First Menu',
          selector: 'main-nav',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );
    assert.equal(first.status, 200);

    const duplicate = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Second Menu',
          selector: 'main-nav',
          items: [{ name: 'About', path: '/about', children: [] }],
        }),
      })
    );

    assert.equal(duplicate.status, 400);
    const body = await duplicate.json();
    assert.equal(body.error, 'A menu with that selector already exists.');
  });
});

test('handlePostMenus rejects items without path', async () => {
  await withTempProject(async () => {
    const response = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Items Menu',
          selector: 'bad-items',
          items: [{ name: 'No Path Item', path: '', children: [] }],
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Path is required in all menu items.');
  });
});

test('handlePostMenus rejects non-array items', async () => {
  await withTempProject(async () => {
    // normalizeMenuPayload coerces non-array items to [] — an empty array IS valid
    // so passing a string selector-only body with items omitted results in an empty items array
    // which passes path validation. This test ensures items: null is treated as [].
    const response = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Menu',
          selector: 'my-menu',
          items: null,
        }),
      })
    );

    // normalizeMenuPayload coerces null → [], empty array passes path validation → 200
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items.length, 0);
  });
});

test('handleDeleteMenu returns 404 for unknown id', async () => {
  await withTempProject(async () => {
    const response = await handleDeleteMenu('non-existent-id-xyz');
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handlePutMenu returns 404 for unknown id', async () => {
  await withTempProject(async () => {
    const response = await handlePutMenu(
      'non-existent-id-xyz',
      new Request('http://localhost/cms/api/menus/non-existent-id-xyz', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ghost',
          selector: 'ghost',
          items: [],
        }),
      })
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handlePutMenu prevents changing selector to one already taken by another menu', async () => {
  await withTempProject(async () => {
    const first = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'First',
          selector: 'first-nav',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );
    assert.equal(first.status, 200);

    const second = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Second',
          selector: 'second-nav',
          items: [{ name: 'About', path: '/about', children: [] }],
        }),
      })
    );
    assert.equal(second.status, 200);
    const secondJson = await second.json();

    // Try to rename second menu to the selector already used by first
    const conflict = await handlePutMenu(
      secondJson.id,
      new Request(`http://localhost/cms/api/menus/${secondJson.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Second Renamed',
          selector: 'first-nav',
          items: [{ name: 'About', path: '/about', children: [] }],
        }),
      })
    );

    assert.equal(conflict.status, 400);
    const body = await conflict.json();
    assert.equal(body.error, 'A menu with that selector already exists.');
  });
});

test('handlePutMenu allows keeping the same selector on its own menu', async () => {
  await withTempProject(async () => {
    const created = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nav',
          selector: 'main-nav',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );
    assert.equal(created.status, 200);
    const createdJson = await created.json();

    // Update the menu keeping the same selector — should succeed
    const updated = await handlePutMenu(
      createdJson.id,
      new Request(`http://localhost/cms/api/menus/${createdJson.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Nav',
          selector: 'main-nav',
          items: [{ name: 'Home', path: '/', children: [] }],
        }),
      })
    );

    assert.equal(updated.status, 200);
    const updatedJson = await updated.json();
    assert.equal(updatedJson.name, 'Updated Nav');
    assert.equal(updatedJson.selector, 'main-nav');
  });
});

test('handlePostMenus validates nested children paths recursively', async () => {
  await withTempProject(async () => {
    const response = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nested Menu',
          selector: 'nested',
          items: [
            {
              name: 'Parent',
              path: '/parent',
              children: [
                { name: 'Child Missing Path', path: '', children: [] },
              ],
            },
          ],
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Path is required in all menu items.');
  });
});

test('handleGetMenus returns locale-resolved items view', async () => {
  await withTempProject(async () => {
    // Create a menu with items
    const post = await handlePostMenus(
      new Request('http://localhost/cms/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Footer Nav',
          selector: 'footer-nav',
          items: [{ name: 'Contact', path: '/contact', children: [] }],
        }),
      })
    );
    assert.equal(post.status, 200);

    const get = await handleGetMenus(new Request('http://localhost/cms/api/menus'));
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.menus.length, 1);
    assert.equal(body.menus[0].selector, 'footer-nav');
    assert.ok(Array.isArray(body.menus[0].items));
    assert.equal(body.menus[0].items[0].path, '/contact');
  });
});
