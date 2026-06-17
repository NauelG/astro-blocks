/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadLanguages } from '../dist/api/data.js';
import {
  handleDeleteLanguage,
  handleGetLanguages,
  handlePostLanguages,
  handlePutLanguage,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-languages-'));

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

test('handleGetLanguages returns default language list', async () => {
  await withTempProject(async () => {
    const response = await handleGetLanguages();

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.languages));
    // The default setup ships with Spanish as the only language
    assert.equal(body.languages.length, 1);
    assert.equal(body.languages[0].code, 'es');
    assert.equal(body.languages[0].isDefault, true);
  });
});

test('language handlers support full CRUD lifecycle', async () => {
  await withTempProject(async () => {
    // Add a new language
    const postResponse = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'EN', label: 'English', enabled: true }),
      })
    );

    assert.equal(postResponse.status, 200);
    const created = await postResponse.json();
    // Code should be normalized to lowercase
    assert.equal(created.code, 'en');
    assert.equal(created.label, 'English');
    assert.equal(created.enabled, true);

    // List — should now have 2 (es + en)
    const getResponse = await handleGetLanguages();
    const listed = await getResponse.json();
    assert.equal(listed.languages.length, 2);
    assert.ok(listed.languages.some((lang) => lang.code === 'en'));

    // Update the language label
    const putResponse = await handlePutLanguage(
      'en',
      new Request('http://localhost/cms/api/languages/en', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'English (US)' }),
      })
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.label, 'English (US)');
    assert.equal(updated.code, 'en');

    // Verify persisted state via data loader
    const persisted = await loadLanguages();
    const enEntry = persisted.languages.find((lang) => lang.code === 'en');
    assert.ok(enEntry);
    assert.equal(enEntry.label, 'English (US)');

    // Delete the added language
    const deleteResponse = await handleDeleteLanguage('en');
    assert.equal(deleteResponse.status, 200);
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteBody.ok, true);
    assert.equal(deleteBody.deletedLocale, 'en');

    // Verify only the default (es) remains
    const afterDelete = await loadLanguages();
    assert.equal(afterDelete.languages.length, 1);
    assert.equal(afterDelete.languages[0].code, 'es');
  });
});

test('handlePostLanguages rejects missing code', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'No Code' }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Language code is required.');
  });
});

test('handlePostLanguages rejects invalid code format', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'invalid code!', label: 'Bad' }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid language code. Use format like "es" or "pt-br".');
  });
});

test('handlePostLanguages rejects duplicate language code', async () => {
  await withTempProject(async () => {
    // 'es' is already in the default data
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'es', label: 'Español Duplicado' }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'A language with that code already exists.');
  });
});

test('handlePostLanguages normalizes code to lowercase before duplicate check', async () => {
  await withTempProject(async () => {
    // 'es' exists as default; sending 'ES' should still be a duplicate
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ES', label: 'Español Upper' }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'A language with that code already exists.');
  });
});

test('handleDeleteLanguage returns 404 for unknown code', async () => {
  await withTempProject(async () => {
    const response = await handleDeleteLanguage('xx');
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handleDeleteLanguage refuses to delete the last language', async () => {
  await withTempProject(async () => {
    // Only 'es' exists — cannot delete it
    const response = await handleDeleteLanguage('es');
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Cannot delete the last language.');
  });
});

test('handlePutLanguage returns 404 for unknown code', async () => {
  await withTempProject(async () => {
    const response = await handlePutLanguage(
      'xx',
      new Request('http://localhost/cms/api/languages/xx', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Does not exist' }),
      })
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handlePutLanguage refuses to disable the only enabled language', async () => {
  await withTempProject(async () => {
    // 'es' is the only language and the only enabled one
    const response = await handlePutLanguage(
      'es',
      new Request('http://localhost/cms/api/languages/es', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'At least one enabled language must exist.');
  });
});

test('handlePutLanguage can disable a non-last enabled language', async () => {
  await withTempProject(async () => {
    // Add English first
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      })
    );
    assert.equal(post.status, 200);

    // Now disable Spanish — 'en' is still enabled so this should pass
    const put = await handlePutLanguage(
      'es',
      new Request('http://localhost/cms/api/languages/es', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
    );

    assert.equal(put.status, 200);
    const body = await put.json();
    assert.equal(body.enabled, false);

    // Persisted state — 'en' should still be enabled
    const persisted = await loadLanguages();
    const en = persisted.languages.find((lang) => lang.code === 'en');
    assert.ok(en);
    assert.equal(en.enabled, true);
  });
});

test('handleDeleteLanguage reports affected pages and menus counts', async () => {
  await withTempProject(async () => {
    // Add English
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      })
    );
    assert.equal(post.status, 200);

    // Delete it — no pages or menus have 'en' content, so counts should be 0
    const deleteResponse = await handleDeleteLanguage('en');
    assert.equal(deleteResponse.status, 200);
    const body = await deleteResponse.json();
    assert.equal(body.ok, true);
    assert.equal(body.deletedLocale, 'en');
    assert.ok(typeof body.affectedPages === 'number');
    assert.ok(typeof body.affectedMenus === 'number');
    assert.equal(body.affectedPages, 0);
    assert.equal(body.affectedMenus, 0);
  });
});

test('handlePostLanguages with isDefault:true promotes the new language as default', async () => {
  await withTempProject(async () => {
    // Add English and mark it as default
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true, isDefault: true }),
      })
    );
    assert.equal(post.status, 200);
    const created = await post.json();
    assert.equal(created.isDefault, true);

    // Verify persisted: 'en' is now default, 'es' should no longer be
    const persisted = await loadLanguages();
    const en = persisted.languages.find((lang) => lang.code === 'en');
    const es = persisted.languages.find((lang) => lang.code === 'es');
    assert.ok(en);
    assert.ok(es);
    assert.equal(en.isDefault, true);
    assert.equal(es.isDefault, false);
  });
});

test('handlePutLanguage can update isDefault to promote a language', async () => {
  await withTempProject(async () => {
    // Add English
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      })
    );
    assert.equal(post.status, 200);

    // Promote English to default via PUT
    const put = await handlePutLanguage(
      'en',
      new Request('http://localhost/cms/api/languages/en', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })
    );
    assert.equal(put.status, 200);
    const body = await put.json();
    assert.equal(body.isDefault, true);

    // Persisted — 'es' should no longer be default
    const persisted = await loadLanguages();
    const es = persisted.languages.find((lang) => lang.code === 'es');
    assert.ok(es);
    assert.equal(es.isDefault, false);
  });
});

test('handlePostLanguages accepts valid BCP-47 subtag codes like pt-br', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'pt-br', label: 'Português (Brasil)', enabled: true }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.code, 'pt-br');
  });
});
