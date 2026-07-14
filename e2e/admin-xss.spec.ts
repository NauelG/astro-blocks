/**
 * Security E2E — stored XSS in the admin panel (issue #99).
 *
 * Plants an XSS payload through the REAL API into languages.label and users.email
 * (both accepted with no format validation: languages.ts trims label, users.ts only
 * lowercases email), then asserts in a real browser that:
 *   1. no script executes (window.__xss stays undefined, no dialog fires), and
 *   2. the payload renders as LITERAL TEXT — the positive half. Without it, a row
 *      that simply failed to render would also pass "no execution".
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

import { test, expect } from './fixtures/coverage';

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

    // Plant the payloads through the real write path.
    const langRes = await page.request.post('/cms/api/languages', {
      headers: authHeaders,
      data: { code: 'xx', label: PAYLOAD, enabled: true },
    });
    expect(langRes.ok(), 'planting the malicious language must succeed').toBeTruthy();

    const userRes = await page.request.post('/cms/api/users', {
      headers: authHeaders,
      data: { email: PAYLOAD, password: 'irrelevant-but-required-123', role: 'user' },
    });
    expect(userRes.ok(), 'planting the malicious user must succeed').toBeTruthy();

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
