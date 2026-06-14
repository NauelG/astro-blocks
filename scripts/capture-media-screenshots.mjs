/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * capture-media-screenshots.mjs
 *
 * Regenerates the two media-feature screenshots from the VERSIONED playground demo:
 *   img/media-library.png  — /cms/media library page
 *   img/image-picker.png   — image-field picker modal cropped to the panel
 *
 * The MediaShowcase demo (placeholder images + responsive variants + ready media
 * registry + a pages.json page with a MediaShowcase block) is committed to git
 * under playgrounds/basic/. This script no longer fabricates that state — it relies
 * on the committed demo and only captures screenshots against it.
 *
 * Steps (idempotent — safe to re-run):
 *   1. Restore the versioned demo (pages.json + media.json + public/uploads) to its
 *      committed state via `git checkout`, so capture starts from a known baseline.
 *   2. Start the playground dev server; handle localhost/IPv6 quirks on macOS.
 *   3. Authenticate as owner (sessionStorage token) for the CMS UI.
 *   4. Capture both screenshots with Playwright (1440×900, Chromium, light theme).
 *   5. Tear down the dev server cleanly — even on error.
 *   6. Restore the versioned demo again, so the ONLY working-tree change left by
 *      this script is the regenerated img/*.png (the demo must never show dirty).
 *
 * Usage:
 *   node scripts/capture-media-screenshots.mjs
 *
 * Prerequisites:
 *   npx playwright install chromium
 */

import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { TextEncoder } from 'node:util';
import { SignJWT } from 'jose';
import { chromium } from 'playwright';

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const PLAYGROUND_DIR = path.join(ROOT, 'playgrounds', 'basic');

const IMG_DIR = path.join(ROOT, 'img');
const MEDIA_LIBRARY_PATH = path.join(IMG_DIR, 'media-library.png');
const IMAGE_PICKER_PATH = path.join(IMG_DIR, 'image-picker.png');

// The versioned demo files this script must leave untouched (restored if mutated).
// Paths are relative to ROOT so `git checkout` resolves them correctly.
const VERSIONED_DEMO_PATHS = [
  'playgrounds/basic/data/pages.json',
  'playgrounds/basic/data/media.json',
  'playgrounds/basic/public/uploads',
];

// ── Auth ─────────────────────────────────────────────────────────────────────

// This secret must match CMS_JWT_SECRET passed to the dev server below.
// capture-readme-screenshots.mjs uses the same value — keep them in sync.
const JWT_SECRET = 'astro-blocks-readme-screenshots';

const SCREENSHOT_USER = {
  id: 'readme-screenshots',
  email: 'screenshots@astroblocks.local',
  role: 'owner',
};

// ── Server config ─────────────────────────────────────────────────────────────

// 127.0.0.1 rather than 'localhost': on macOS, Astro resolves 'localhost' to
// the IPv6 loopback (::1) and binds there. Fetch calls to 127.0.0.1 then hit a
// different interface and get ECONNREFUSED. Pinning to 127.0.0.1 everywhere
// avoids the mismatch. See also the --host flag passed to `astro dev` below.
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4328; // One above capture-readme-screenshots.mjs (4327) to avoid port collisions.
const SERVER_READY_TIMEOUT_MS = 120_000;

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1/6 — Restore the versioned demo to its committed state
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Restore the versioned MediaShowcase demo (pages.json + media.json + uploads) to
 * the committed HEAD state via `git checkout`. Runs before capture (clean baseline)
 * and after capture (so the only working-tree change is img/*.png).
 *
 * `git checkout -- <paths>` discards working-tree modifications for tracked files;
 * untracked files inside public/uploads are NOT removed (the demo only ever reads
 * those files during capture, so nothing new should appear). Errors are logged but
 * not fatal — a missing git or detached state should not abort the screenshot run.
 */
async function restoreVersionedDemo(label) {
  // Restore each path independently: `git checkout` aborts the whole command if any
  // single pathspec is unknown to git (e.g. before the demo is first committed), so
  // restoring per-path keeps tracked files clean even when others are still untracked.
  for (const p of VERSIONED_DEMO_PATHS) {
    try {
      await runCommand('git', ['checkout', '--', p], { cwd: ROOT });
    } catch {
      // Path not tracked yet (or git unavailable) — non-fatal. The working-tree copy
      // of the demo is used as-is; capture only reads it and must not mutate it.
    }
  }
  console.log(`[media-screenshots] Restored versioned demo (${label})`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Dev server lifecycle (mirrors capture-readme-screenshots.mjs)
// ═══════════════════════════════════════════════════════════════════════════════

async function findOpenPort(start) {
  let port = start;
  while (port < start + 30) {
    const isOpen = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, HOST, () => server.close(() => resolve(true)));
    });
    if (isOpen) return port;
    port += 1;
  }
  throw new Error(`No free port found from ${start} to ${start + 29}`);
}

async function waitForServer(baseUrl, timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/cms`);
      // 200, 401, and 302 all indicate the server is up and routing correctly.
      if (res.ok || res.status === 401 || res.status === 302) return;
      lastError = new Error(`Unexpected status: ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }

  throw new Error(`Timeout waiting for server at ${baseUrl}: ${String(lastError)}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`Command failed (${command} ${args.join(' ')}), exit code: ${code ?? 'null'}`));
    });
  });
}

async function closeDevServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  const timeout = sleep(5000).then(() => {
    if (!child.killed) child.kill('SIGKILL');
  });
  await Promise.race([once(child, 'exit'), timeout]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Auth
// ═══════════════════════════════════════════════════════════════════════════════

async function createAuthToken() {
  return new SignJWT({ email: SCREENSHOT_USER.email, role: SCREENSHOT_USER.role })
    .setSubject(SCREENSHOT_USER.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Playwright capture
// ═══════════════════════════════════════════════════════════════════════════════

async function openCmsPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#admin-content:not(.cms-hidden)', { timeout: 20000 });
  await page.waitForSelector('.cms-topbar', { timeout: 15000 });
}

async function captureScreenshots(baseUrl, token) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });

  // Inject auth into sessionStorage before any page navigation.
  await context.addInitScript(
    ({ authToken, user }) => {
      sessionStorage.setItem('cms-token', authToken);
      sessionStorage.setItem('cms-user', JSON.stringify(user));
    },
    { authToken: token, user: SCREENSHOT_USER }
  );

  const page = await context.newPage();

  try {
    // ── Screenshot 1: /cms/media ─────────────────────────────────────────────
    console.log('[media-screenshots] Navigating to /cms/media ...');
    await openCmsPage(page, `${baseUrl}/cms/media`);

    // Wait for at least one media card to appear in the grid.
    await page.waitForSelector('#cms-media-grid .cms-media-card', { timeout: 20000 });

    // Wait until at least half the thumbnails have actually loaded (naturalWidth > 0).
    // This prevents capturing broken-image icons instead of real thumbnails.
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('#cms-media-grid .cms-media-card-img');
      if (imgs.length === 0) return false;
      const loaded = Array.from(imgs).filter(img => img.naturalWidth > 0);
      return loaded.length >= Math.ceil(imgs.length * 0.5);
    }, { timeout: 20000 });

    // Allow any CSS enter-transitions to settle.
    await sleep(800);

    await page.screenshot({ path: MEDIA_LIBRARY_PATH, type: 'png', fullPage: false });
    console.log(`[media-screenshots] Saved ${path.relative(ROOT, MEDIA_LIBRARY_PATH)}`);

    // ── Screenshot 2: image-field picker modal ───────────────────────────────
    console.log('[media-screenshots] Navigating to /cms/pages ...');
    await openCmsPage(page, `${baseUrl}/cms/pages`);

    // Wait for the client-side JS to populate the table with at least one edit button.
    // refreshPages() fires on init and may replace the SSR-rendered rows, so we wait
    // for the edit button to be stable rather than just the tbody container.
    await page.waitForSelector('#cms-pages-tbody .cms-page-edit', { timeout: 20000 });

    // Open the editor for the page that contains the MediaShowcase block. The
    // versioned demo pages.json ships a "media-showcase-page" whose default-locale
    // (es) slug is "/galeria"; we match the row by that slug so we don't depend on
    // row ordering or on the localized title shown in the CMS table.
    const mediaPageRow = page
      .locator('#cms-pages-tbody tr')
      .filter({ hasText: '/galeria' });
    const editBtn = (await mediaPageRow.count()) > 0
      ? mediaPageRow.first().locator('.cms-page-edit')
      : page.locator('.cms-page-edit').first();
    await editBtn.click();

    // Wait for the editor modal to open (showModal() sets the [open] attribute).
    await page.waitForSelector('#page-detail-modal[open]', { timeout: 15000 });
    // Wait for the block list to be populated. openEdit() calls renderBlocksList()
    // before showModal(), so .cms-block-item should appear shortly after open.
    await page.waitForSelector('#page-detail-blocks-list .cms-block-item', { timeout: 15000 });

    // Expand the MediaShowcase block so its image fields (and [data-picker-for]
    // buttons) become visible. The toggle click sets openBlockIndex and re-renders.
    const mediaBlockToggle = page
      .locator('.cms-block-item')
      .filter({ has: page.locator('.cms-block-item-name', { hasText: 'Media Showcase' }) })
      .locator('.cms-block-item-toggle');

    if (await mediaBlockToggle.count() > 0) {
      await mediaBlockToggle.first().click();
      // Wait until the block body loses the cms-hidden class (i.e. is expanded).
      await page.waitForFunction(() => {
        const names = document.querySelectorAll('.cms-block-item-name');
        for (const name of names) {
          if (name.textContent?.includes('Media Showcase')) {
            const body = name.closest('.cms-block-item')?.querySelector('.cms-block-item-body');
            return body && !body.classList.contains('cms-hidden');
          }
        }
        return false;
      }, { timeout: 10000 });
      // Brief settle to let any transition animations complete.
      await sleep(300);
    } else {
      // Fallback: expand blocks one by one until a picker button appears.
      // This path should not be reached when the versioned demo page is in use.
      const allToggles = page.locator('.cms-block-item-toggle');
      const toggleCount = await allToggles.count();
      for (let i = 0; i < toggleCount; i++) {
        await allToggles.nth(i).click();
        await sleep(200);
        if (await page.locator('[data-picker-for]').count() > 0) break;
      }
    }

    // At this point the expanded block body must contain at least one [data-picker-for]
    // button (the "Choose image" button rendered by block-form.ts for each image field).
    if (await page.locator('[data-picker-for]').count() === 0) {
      throw new Error(
        'No image picker button found after expanding MediaShowcase block. ' +
        'Ensure the versioned pages.json still contains a MediaShowcase block with image fields.'
      );
    }

    // Open the image picker modal.
    await page.locator('[data-picker-for]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-picker-for]').first().click();

    await page.waitForSelector('#cms-media-picker[open]', { timeout: 15000 });
    await page.waitForSelector('.cms-media-picker-grid', { timeout: 20000 });

    // Wait for picker thumbnails to load before capturing.
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('.cms-media-picker-grid .cms-media-picker-img');
      if (imgs.length === 0) return false;
      const loaded = Array.from(imgs).filter(img => img.naturalWidth > 0);
      return loaded.length >= Math.ceil(imgs.length * 0.5);
    }, { timeout: 20000 });

    await sleep(800);

    // Crop to the picker panel for a clean, focused screenshot.
    const pickerPanel = page.locator('.cms-media-picker-panel');
    if (await pickerPanel.count() > 0) {
      await pickerPanel.screenshot({ path: IMAGE_PICKER_PATH, type: 'png' });
    } else {
      await page.screenshot({ path: IMAGE_PICKER_PATH, type: 'png', fullPage: false });
    }
    console.log(`[media-screenshots] Saved ${path.relative(ROOT, IMAGE_PICKER_PATH)}`);

  } finally {
    await context.close();
    await browser.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  // ── Step 1: Restore the versioned demo to a known baseline ─────────────────
  console.log('[media-screenshots] Restoring versioned demo baseline...');
  await restoreVersionedDemo('pre-capture');

  try {
    // ── Step 2: Prepare package + start dev server ───────────────────────────
    console.log('[media-screenshots] Preparing playground package...');
    await runCommand('npm', ['run', 'prepare:playground'], { cwd: ROOT, env: process.env });

    const port = await findOpenPort(DEFAULT_PORT);
    const baseUrl = `http://${HOST}:${port}`;

    console.log(`[media-screenshots] Starting playground at ${baseUrl}...`);

    // We spawn `astro dev` directly (same pattern as capture-readme-screenshots.mjs)
    // rather than `npm run dev:playground` so we control host/port precisely.
    //
    // macOS: passing --host 127.0.0.1 forces Astro to bind on the IPv4 loopback.
    // Without it, Astro resolves 'localhost' to the IPv6 address (::1) on macOS
    // and our fetch calls to 127.0.0.1 hit a different interface → ECONNREFUSED.
    const devServer = spawn('npx', ['astro', 'dev', '--host', HOST, '--port', String(port)], {
      cwd: PLAYGROUND_DIR,
      env: {
        ...process.env,
        // The JWT we sign must be verifiable server-side with the same key.
        // Both sides must agree; this env var is what the CMS reads at startup.
        CMS_JWT_SECRET: JWT_SECRET,
      },
      stdio: 'inherit',
    });

    try {
      await waitForServer(baseUrl);

      // Short settle — let HMR stabilise before we start driving the UI.
      await sleep(2000);

      // ── Step 3: Auth ──────────────────────────────────────────────────────
      console.log('[media-screenshots] Creating auth token...');
      const token = await createAuthToken();

      // ── Step 4: Playwright ────────────────────────────────────────────────
      console.log('[media-screenshots] Capturing screenshots...');
      await fs.mkdir(IMG_DIR, { recursive: true });
      await captureScreenshots(baseUrl, token);

    } catch (err) {
      if (String(err).includes("Executable doesn't exist")) {
        console.error('[media-screenshots] Chromium is not installed.');
        console.error('[media-screenshots] Run: npx playwright install chromium');
      }
      throw err;
    } finally {
      // ── Step 5: Tear down server — always runs, even on error ──────────────
      console.log('[media-screenshots] Stopping dev server...');
      await closeDevServer(devServer);
    }

  } finally {
    // ── Step 6: Restore the versioned demo — always runs, even on error ───────
    // Guarantees the only working-tree change left behind is the regenerated
    // img/*.png. The versioned demo (pages.json + media.json + uploads) must
    // never show as modified after this script runs.
    console.log('[media-screenshots] Restoring versioned demo...');
    await restoreVersionedDemo('post-capture');
  }

  console.log('[media-screenshots] Done.');
}

main().catch((err) => {
  console.error('[media-screenshots] Fatal:', err);
  process.exit(1);
});
