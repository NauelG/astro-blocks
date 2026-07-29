/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { TextEncoder } from 'node:util';
import { SignJWT } from 'jose';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PLAYGROUND_DIR = path.join(ROOT, 'playgrounds', 'basic');
const USERS_PATH = path.join(PLAYGROUND_DIR, 'data', 'users.json');
const PLAYGROUND_REDIRECTS_PATH = path.join(PLAYGROUND_DIR, 'data', 'redirects.json');
const DASHBOARD_PATH = path.join(ROOT, 'src', 'img', 'dashboard.jpg');
const PAGE_EDITOR_PATH = path.join(ROOT, 'src', 'img', 'page_editor.jpg');
const IMPORT_EXPORT_PATH = path.join(ROOT, 'src', 'img', 'import-export.jpg');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4327;
const JWT_SECRET = 'astro-blocks-readme-screenshots';
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(
        new Error(`Command failed (${command} ${args.join(' ')}), exit code: ${code ?? 'null'}`),
      );
    });
  });
}

async function findOpenPort(start) {
  let port = start;
  while (port < start + 30) {
    const isOpen = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, HOST, () => {
        server.close(() => resolve(true));
      });
    });
    if (isOpen) return port;
    port += 1;
  }
  throw new Error(`No free port found from ${start} to ${start + 29}`);
}

async function waitForServer(baseUrl, timeoutMs = 120000) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/cms`);
      if (response.ok || response.status === 401) return;
      lastError = new Error(`Unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw new Error(`Timeout waiting for playground server at ${baseUrl}: ${String(lastError)}`);
}

/**
 * Resolve the user the screenshot token will speak for.
 *
 * getAuth reads the user fresh from the store on every request and rejects a token whose `sub` is
 * unknown or whose `tokenVersion` has moved (ADR-0027), so the token must name a user that really
 * exists. These scripts used to mint an id out of thin air and still worked, because the admin
 * pages server-render their data without authenticating — anything client-rendered needs a genuine
 * token. Read the owner from the playground's versioned store rather than hardcoding an id.
 */
async function resolveScreenshotUser() {
  const raw = JSON.parse(await fs.readFile(USERS_PATH, 'utf-8'));
  const users = Array.isArray(raw.users) ? raw.users : [];
  const owner = users.find((u) => u.role === 'owner') ?? users[0];
  if (!owner?.id) {
    throw new Error(`No user in ${USERS_PATH} to sign a screenshot token for.`);
  }
  return {
    id: owner.id,
    email: owner.email ?? 'owner@astroblocks.local',
    role: owner.role ?? 'owner',
    // Absent or malformed tokenVersion reads as 1 at the store boundary (ADR-0027).
    tokenVersion: typeof owner.tokenVersion === 'number' ? owner.tokenVersion : 1,
  };
}

async function createAuthToken(secret, user) {
  return new SignJWT({ email: user.email, role: user.role, tokenVersion: user.tokenVersion })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

async function openCmsPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#admin-content:not(.cms-hidden)', { timeout: 15000 });
  await page.waitForSelector('.cms-topbar', { timeout: 15000 });
}

async function captureReadmeScreenshots(baseUrl, token, screenshotUser) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1720, height: 1100 },
    deviceScaleFactor: 1,
    // Force English Accept-Language so the admin UI language detection falls back
    // to 'en' even before the cookie is set.
    locale: 'en-US',
  });

  // Force the admin UI language to English via the cms-ui-locale cookie.
  // The admin resolves the UI locale server-side on every SSR request; without
  // this cookie the rendered language would depend on the host machine's locale,
  // producing non-English screenshots on Spanish-locale CI runners.
  // Path=/cms must match the admin mount point so the cookie is sent on /cms/* requests.
  const parsedUrl = new URL(baseUrl);
  await context.addCookies([
    {
      name: 'cms-ui-locale',
      value: 'en',
      domain: parsedUrl.hostname,
      path: '/cms',
      sameSite: 'Lax',
      httpOnly: false,
      secure: false,
    },
  ]);

  await context.addInitScript(
    ({ authToken, user }) => {
      sessionStorage.setItem('cms-token', authToken);
      sessionStorage.setItem('cms-user', JSON.stringify(user));
    },
    { authToken: token, user: screenshotUser },
  );

  const page = await context.newPage();

  try {
    await openCmsPage(page, `${baseUrl}/cms`);
    await page.waitForSelector('.cms-dashboard-shell', { timeout: 15000 });
    await page.screenshot({
      path: DASHBOARD_PATH,
      type: 'jpeg',
      quality: 90,
    });

    await openCmsPage(page, `${baseUrl}/cms/pages`);
    await page.waitForSelector('#cms-pages-tbody', { timeout: 15000 });
    const firstEditButton = page.locator('.cms-page-edit').first();
    if (await firstEditButton.count()) {
      await firstEditButton.click();
    } else {
      await page.click('#cms-page-new-btn');
    }
    await page.waitForSelector('#page-detail-modal[open]', { timeout: 15000 });
    await page.waitForSelector('.cms-page-detail-layout', { timeout: 15000 });
    await page.screenshot({
      path: PAGE_EDITOR_PATH,
      type: 'jpeg',
      quality: 90,
    });

    await openCmsPage(page, `${baseUrl}/cms/import-export`);
    await page.waitForSelector('#ie-export-units', { timeout: 15000 });
    await page.waitForSelector('#ie-import-units', { timeout: 15000 });
    await page.screenshot({
      path: IMPORT_EXPORT_PATH,
      type: 'jpeg',
      quality: 90,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Run an `astro` subcommand in the playground and resolve its combined output.
 *
 * Not `run()`: these are expected to be uneventful (there may be no server to stop), and their
 * result is information here, not a failure.
 */
function astroCommand(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['astro', ...args], {
      cwd: PLAYGROUND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('exit', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

/**
 * Whether a dev server currently holds the playground's lock.
 *
 * Read from the OUTPUT, not the exit code: `astro dev status` exits 0 either way — it reports
 * "No dev server is running." just as successfully as it reports a running one. Matching the
 * positive signal means an unrecognised output format lets the run proceed rather than blocking
 * every invocation on a false alarm.
 */
async function isDevServerRunning() {
  return /Dev server running at/.test(await astroCommand(['dev', 'status']));
}

/**
 * Stop the dev server through Astro's own command, not by signalling the child we spawned.
 *
 * `spawn('npx', ['astro', 'dev', …])` produces TWO processes: npx, and the astro server it
 * launches. npx exits almost immediately, so signalling our child hits a process that is already
 * gone — `child.killed` stays false and the real server keeps running, orphaned. The scripts used
 * to print "Stopping dev server..." and believe it.
 *
 * That alone was survivable while ports differed. Astro's dev-server lock is per PROJECT, so a
 * surviving server makes the next `astro dev` for the same project refuse to start — it reports the
 * address of the running one and the caller then polls the port it asked for until it times out.
 * `npm version` chains screenshots:readme && screenshots:media, so the second always failed.
 *
 * `astro dev stop` stops the process and clears the lock, which is what the next run needs.
 */
/**
 * Refuse to run while another dev server owns the playground.
 *
 * We would otherwise stop it in the teardown — and if that server is the developer's own, running
 * for their own work, killing it silently is a nasty surprise. Failing here also replaces the
 * failure this used to produce: `astro dev` would report the running server's address, this script
 * would poll the port it asked for instead, and die on an opaque timeout that mentioned neither
 * the lock nor the other server.
 */
async function assertNoDevServerRunning(label) {
  if (!(await isDevServerRunning())) return;
  throw new Error(
    `${label} a dev server is already running for playgrounds/basic, and this script will not stop ` +
      "one it did not start. Astro's lock is per project, so no second server can start while it " +
      'holds it. Stop it first:\n\n  cd playgrounds/basic && npx astro dev stop\n',
  );
}

async function closeDevServer() {
  await astroCommand(['dev', 'stop']);
}

async function main() {
  const port = await findOpenPort(DEFAULT_PORT);
  const baseUrl = `http://${HOST}:${port}`;
  const redirectsFileExistedBefore = await fs
    .access(PLAYGROUND_REDIRECTS_PATH)
    .then(() => true)
    .catch(() => false);

  console.log('[screenshots] Preparing playground package...');
  await runCommand('npm', ['run', 'prepare:playground'], { cwd: ROOT, env: process.env });

  console.log(`[screenshots] Starting playground at ${baseUrl}...`);
  await assertNoDevServerRunning('[screenshots]');

  // Not bound: the teardown goes through `astro dev stop`, not through this handle. Signalling it
  // would hit npx, which exits immediately, leaving the real server orphaned.
  const devServer = spawn('npx', ['astro', 'dev', '--host', HOST, '--port', String(port)], {
    cwd: PLAYGROUND_DIR,
    env: {
      ...process.env,
      CMS_JWT_SECRET: JWT_SECRET,
    },
    stdio: 'inherit',
  });
  devServer.on('error', (err) => console.error('[screenshots] failed to spawn astro dev:', err));

  try {
    await waitForServer(baseUrl);
    const screenshotUser = await resolveScreenshotUser();
    const token = await createAuthToken(JWT_SECRET, screenshotUser);
    console.log('[screenshots] Capturing README images...');
    await captureReadmeScreenshots(baseUrl, token, screenshotUser);
    console.log(`[screenshots] Updated ${path.relative(ROOT, DASHBOARD_PATH)}`);
    console.log(`[screenshots] Updated ${path.relative(ROOT, PAGE_EDITOR_PATH)}`);
    console.log(`[screenshots] Updated ${path.relative(ROOT, IMPORT_EXPORT_PATH)}`);
  } catch (error) {
    if (String(error).includes("Executable doesn't exist")) {
      console.error('[screenshots] Chromium browser is not installed for Playwright.');
      console.error('[screenshots] Run: npx playwright install chromium');
    }
    throw error;
  } finally {
    await closeDevServer();
    if (!redirectsFileExistedBefore) {
      await fs.rm(PLAYGROUND_REDIRECTS_PATH, { force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error('[screenshots] Failed:', error);
  process.exit(1);
});
