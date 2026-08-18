/**
 * Security E2E — stored XSS in the admin panel (issue #99).
 *
 * Plants an XSS payload into languages.label and users.email, then asserts in a
 * real browser that:
 *   1. no script executes (window.__xss stays undefined, no dialog fires), and
 *   2. the payload renders as LITERAL TEXT — the positive half. Without it, a row
 *      that simply failed to render would also pass "no execution".
 *
 * How the payloads are planted (changed by #108, field-validation.md):
 *   - languages.label goes through the REAL API. The label grammar deliberately
 *     admits markup — it is the grammar of a name, not an XSS defense — so the
 *     write path still accepts it, which is exactly why this sink coverage must
 *     stay alive.
 *   - users.email is REJECTED by the API now (WHATWG grammar — asserted here as
 *     the #108 regression), so the malicious user is planted by writing
 *     .e2e-data/data/users.json directly. The sink must hold on its own for any
 *     value that reaches the store, however it got there (defense in depth).
 *
 * Coverage of the three sinks fixed in #99:
 *   - /cms/languages  → languages-editor row rendering
 *   - /cms/users      → users-editor row rendering
 *   - /cms/pages      → layout.astro content-locale <option> (renders language data
 *                       on EVERY admin page — the widest sink)
 *
 * The payload is LOWERCASE on purpose: users.ts lowercases email, so an `onError`
 * variant would neutralize itself and pass for the wrong reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/coverage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E2E_DATA_FILE = path.join(__dirname, '..', '.e2e-data', 'data', 'users.json');

const TEST_EMAIL = 'owner@example.com';
const TEST_PASSWORD = 'password123';

// Breaks out of an attribute (">) and out of text content (<img>). onerror sets a
// global flag we can assert on. Lowercase — see the file header.
const PAYLOAD = '"><img src=x onerror="window.__xss=1">';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-email-input').fill(TEST_EMAIL);
  await page.locator('#cms-password-input').fill(TEST_PASSWORD);
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

async function getToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem('cms-token') || '');
  expect(token, 'bearer token must be present after login').not.toBe('');
  return token;
}

test.describe('stored XSS — admin renders API data as text, never as markup (#99)', () => {
  test('malicious language label and user email do not execute on any admin page', async ({
    page,
  }) => {
    // Fail loudly if any payload triggers a dialog (alert/confirm/prompt).
    page.on('dialog', async (dialog) => {
      throw new Error(`XSS executed: unexpected ${dialog.type()} dialog "${dialog.message()}"`);
    });

    await login(page);
    const token = await getToken(page);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Plant the language through the real write path. The label grammar admits
    // markup by design (#108) — drop a leftover 'xx' first so retries stay clean.
    await page.request.delete('/cms/api/languages/xx', { headers: authHeaders });
    const langRes = await page.request.post('/cms/api/languages', {
      headers: authHeaders,
      data: { code: 'xx', label: PAYLOAD, enabled: true },
    });
    expect(langRes.ok(), 'planting the malicious language must succeed').toBeTruthy();

    // #108 regression: the entry door refuses a markup email outright.
    const userRes = await page.request.post('/cms/api/users', {
      headers: authHeaders,
      data: { email: PAYLOAD, password: 'irrelevant-but-required-123', role: 'user' },
    });
    expect(userRes.status(), 'the API must reject the malicious email (#108)').toBe(400);

    // Plant the user behind the door, straight into the store: the sink must hold
    // for any value that reaches it, however it got there.
    const usersData = JSON.parse(fs.readFileSync(E2E_DATA_FILE, 'utf-8')) as {
      users: Array<Record<string, unknown>>;
    };
    usersData.users = usersData.users.filter((user) => user['email'] !== PAYLOAD);
    usersData.users.push({
      id: 'xss-planted-user',
      email: PAYLOAD,
      passwordHash: 'not-a-real-hash',
      role: 'user',
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(E2E_DATA_FILE, JSON.stringify(usersData, null, 2));

    // Sink A — /cms/languages row rendering.
    await page.goto('/cms/languages');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(page.locator('#cms-languages-tbody')).toContainText(PAYLOAD, { timeout: 15_000 });
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

    // Sink B — /cms/users row rendering.
    await page.goto('/cms/users');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(page.locator('#cms-users-tbody')).toContainText(PAYLOAD, { timeout: 15_000 });
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

    // Sink C — layout content-locale <option>, rendered on every admin page.
    await page.goto('/cms/pages');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(page.locator('#cms-content-locale-select')).toContainText(PAYLOAD, {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  });
});
