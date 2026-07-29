import { expect, test } from '@playwright/test';

/**
 * R7 / ADR-0037 — an admin page ships no content data.
 *
 * The behavioural half of the rule. tests/admin-ssr-no-data-guard.test.js proves no page CALLS a
 * loader; this proves the HTML the server actually emits carries no content.
 *
 * Deliberately NOT asserted here: that these routes answer 200 unauthenticated. That question is
 * explicitly left open by ADR-0037, and encoding it would turn a known gap into something that
 * reads like a requirement — which the future session-cookie work would then have to delete.
 */

const ADMIN_ROUTES = [
  '/cms',
  '/cms/media',
  '/cms/global-blocks',
  '/cms/pages',
  '/cms/redirects',
  '/cms/configs',
  '/cms/settings',
  '/cms/cache',
  '/cms/menus',
  '/cms/languages',
  '/cms/users',
  '/cms/import-export',
];

const STAMP = String(Date.now());
const SEEDED = {
  pageTitle: `LeakCanaryPage${STAMP}`,
  pageSlug: `/leak-canary-${STAMP}`,
  configKey: `leak_canary_${STAMP}`,
  redirectFrom: `/leak-canary-from-${STAMP}`,
  languageLabel: `LeakCanaryLang${STAMP}`,
};

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#cms-email-input').fill('owner@example.com');
  await page.locator('#cms-password-input').fill('password123');
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

// Seeded once for the whole file: every test needs the canaries present, and running any one of
// them alone must still be meaningful. Without this, an isolated run would assert an absence
// against an empty instance and prove nothing.
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);

  // Seed through the authenticated API from inside the page, so the real session token is used.
  const statuses = await page.evaluate(async (seeded) => {
    const token = sessionStorage.getItem('cms-token');
    const post = (url: string, body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.status);

    return {
      page: await post('/cms/api/pages', {
        title: seeded.pageTitle,
        slug: seeded.pageSlug,
        status: 'published',
        blocks: [],
      }),
      config: await post('/cms/api/configs', {
        key: seeded.configKey,
        value: 'canary',
        description: 'canary',
      }),
      redirect: await post('/cms/api/redirects', {
        from: seeded.redirectFrom,
        to: '/leak-canary-to',
      }),
      language: await post('/cms/api/languages', {
        code: 'zz',
        label: seeded.languageLabel,
        enabled: true,
      }),
    };
  }, SEEDED);

  // If seeding failed, an "absence" assertion would pass while proving nothing.
  expect(statuses.page, 'seed page').toBe(200);
  expect(statuses.config, 'seed config').toBe(200);
  expect(statuses.redirect, 'seed redirect').toBe(200);
  expect(statuses.language, 'seed language').toBe(200);

  await context.close();
});

test.describe('Admin pages ship no content data', () => {
  test('no seeded value appears in any admin route served without a session', async ({
    request,
  }) => {
    const canaries = Object.values(SEEDED);

    for (const route of ADMIN_ROUTES) {
      const response = await request.get(route);
      const html = await response.text();
      for (const canary of canaries) {
        // Assert on the VALUE, not on markup: a class can be renamed, the value is the leak.
        expect(html, `${route} leaked ${canary}`).not.toContain(canary);
      }
    }
  });

  test('the same data still renders once authenticated', async ({ page }) => {
    // "Ships no data" must not be satisfiable by a broken page.
    await login(page);

    await page.goto('/cms/pages');
    await expect(page.locator('#cms-pages-tbody')).toContainText(SEEDED.pageTitle, {
      timeout: 15_000,
    });

    await page.goto('/cms/configs');
    await expect(page.locator('#cms-configs-tbody')).toContainText(SEEDED.configKey, {
      timeout: 15_000,
    });

    await page.goto('/cms/redirects');
    await expect(page.locator('#cms-redirects-tbody')).toContainText(SEEDED.redirectFrom, {
      timeout: 15_000,
    });

    await page.goto('/cms/languages');
    await expect(page.locator('#cms-languages-tbody')).toContainText(SEEDED.languageLabel, {
      timeout: 15_000,
    });
  });

  test('the dashboard renders its counts and recent activity from the API', async ({ page }) => {
    await login(page);
    await page.goto('/cms');

    // A count that never resolves stays on its em-dash placeholder, so this also catches a
    // silently failed fetch rather than only a wrong number.
    await expect(page.locator('#cms-dash-published')).not.toHaveText('—', { timeout: 15_000 });
    await expect(page.locator('#cms-dash-recent-tbody')).toContainText(SEEDED.pageTitle, {
      timeout: 15_000,
    });
    await expect(page.locator('#cms-dash-indexables')).not.toHaveText('—');
    await expect(page.locator('#cms-dash-last-edit')).not.toHaveText('—');
  });
});
