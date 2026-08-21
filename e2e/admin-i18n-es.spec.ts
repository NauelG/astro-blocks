/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * i18n E2E — an admin client module renders in the locale the page was rendered in (#119, ADR-0039).
 *
 * This spec REPLACES A NET that the ct() migration removes. Today `languages-editor` and
 * `users-editor` read `window.__cmsXI18n` through a cast with no runtime fallback: with no bridge,
 * `getI18n()` is undefined, the first property read throws, no row renders, and admin-xss.spec.ts
 * fails. That canary is accidental — and `ct()` does not throw. It returns the KEY as text, so a
 * broken i18n path would render `users.roleOwner` in the cell and leave every test green.
 *
 * The assertions are therefore in SPANISH on purpose. An English assertion cannot tell "resolved"
 * from "wrote the key": `users.roleOwner` is not Spanish, but it is not English either.
 *
 * Each target string is written by a client/*.ts module, never by the .astro — the SSR half of the
 * page would satisfy a naive assertion without proving anything about the client:
 *   - /cms/languages      → the status badge in #cms-languages-tbody   (languages-editor)
 *   - /cms/users          → the role badge in #cms-users-tbody         (users-editor)
 *   - /cms/import-export  → the initial status in #ie-status, empty in SSR (import-export-editor)
 *
 * NO COOKIE + `Accept-Language: es` is the only combination that exercises the header branch of
 * resolveUiLocale — a `cms-ui-locale` cookie short-circuits it. That is what makes this one spec
 * cover four invariants at once: the locale bridge exists, it runs before the editor module, SSR and
 * client agree on the language, and the key resolves instead of rendering raw.
 *
 * It passes BEFORE the migration, against the bridge — same catalog, same locale. That is what makes
 * it a net and not decoration.
 */

import { test, expect } from './fixtures/coverage';

const TEST_EMAIL = 'owner@example.com';
const TEST_PASSWORD = 'password123';

// Enabled, so the row renders the "active" status badge. Its own code, so a retry — or another
// spec's fixtures — cannot collide with it.
const CANARY_LANGUAGE = { code: 'de', label: 'Deutsch (i18n canary)' };

// Spanish values from src/routes/admin/i18n/es.ts. Each differs from its English counterpart
// ('Active', 'Owner', 'Ready.'), which is the whole point: the assertion discriminates the locale.
const ES = {
  languagesStatusActive: 'Activo',
  usersRoleOwner: 'Propietario',
  importExportStatusIdle: 'Listo.',
};

// `locale`, NOT `extraHTTPHeaders: { 'Accept-Language': … }`. Chromium owns that header and
// overrides the extra one, so the request arrives with the browser's own `en-US` and the page
// renders in English — verified against this very server, which answers `lang="es"` to a plain
// `curl -H 'Accept-Language: es'`. `locale` is the option that actually reaches the wire.
// `es-ES` (not `es`) also exercises the primary-subtag branch of parseAcceptLanguage.
test.use({ locale: 'es-ES' });

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-email-input').fill(TEST_EMAIL);
  await page.locator('#cms-password-input').fill(TEST_PASSWORD);
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

async function getAuthHeaders(
  page: import('@playwright/test').Page,
): Promise<Record<string, string>> {
  const token = await page.evaluate(() => sessionStorage.getItem('cms-token') || '');
  expect(token, 'bearer token must be present after login').not.toBe('');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe('admin UI i18n — client strings follow the SSR-resolved locale (#119)', () => {
  test('a language row renders its status badge in Spanish', async ({ page }) => {
    await login(page);
    const headers = await getAuthHeaders(page);

    // Drop a leftover from an earlier run so a retry stays clean, then plant through the real API.
    await page.request.delete(`/cms/api/languages/${CANARY_LANGUAGE.code}`, { headers });
    const created = await page.request.post('/cms/api/languages', {
      headers,
      data: { ...CANARY_LANGUAGE, enabled: true },
    });
    expect(created.ok(), 'seeding the canary language must succeed').toBeTruthy();

    await page.goto('/cms/languages');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    // SSR half: the page itself resolved Spanish from the header.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Client half: the badge is written by languages-editor.
    const tbody = page.locator('#cms-languages-tbody');
    await expect(tbody).toContainText(ES.languagesStatusActive, { timeout: 15_000 });
    await expect(tbody, 'the key must resolve, not render raw').not.toContainText(
      'languages.statusActive',
    );
  });

  test('the owner row renders its role badge in Spanish', async ({ page }) => {
    await login(page);

    await page.goto('/cms/users');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // The owner exists because login bootstrapped it, so this row needs no seeding.
    const tbody = page.locator('#cms-users-tbody');
    await expect(tbody).toContainText(ES.usersRoleOwner, { timeout: 15_000 });
    await expect(tbody, 'the key must resolve, not render raw').not.toContainText(
      'users.roleOwner',
    );
  });

  test('the import/export status region is filled in Spanish by its module', async ({ page }) => {
    await login(page);

    await page.goto('/cms/import-export');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // #ie-status is EMPTY in SSR — whatever is in it was put there by import-export-editor.
    const status = page.locator('#ie-status');
    await expect(status).toHaveText(ES.importExportStatusIdle, { timeout: 15_000 });
  });
});
