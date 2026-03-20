/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { TextEncoder } from 'node:util';
import { SignJWT } from 'jose';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PLAYGROUND_DIR = path.join(ROOT, 'playgrounds', 'basic');
const PLAYGROUND_REDIRECTS_PATH = path.join(PLAYGROUND_DIR, 'data', 'redirects.json');
const DASHBOARD_PATH = path.join(ROOT, 'img', 'dashboard.jpg');
const PAGE_EDITOR_PATH = path.join(ROOT, 'img', 'page_editor.jpg');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4327;
const JWT_SECRET = 'astro-blocks-readme-screenshots';
const SCREENSHOT_USER = {
  id: 'readme-screenshots',
  email: 'screenshots@astroblocks.local',
  role: 'owner',
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`Command failed (${command} ${args.join(' ')}), exit code: ${code ?? 'null'}`));
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

async function createAuthToken(secret) {
  return new SignJWT({ email: SCREENSHOT_USER.email, role: SCREENSHOT_USER.role })
    .setSubject(SCREENSHOT_USER.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

async function openCmsPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#admin-content:not(.cms-hidden)', { timeout: 15000 });
  await page.waitForSelector('.cms-topbar', { timeout: 15000 });
}

async function captureReadmeScreenshots(baseUrl, token) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1720, height: 1100 },
    deviceScaleFactor: 1,
  });

  await context.addInitScript(
    ({ authToken, user }) => {
      sessionStorage.setItem('cms-token', authToken);
      sessionStorage.setItem('cms-user', JSON.stringify(user));
    },
    { authToken: token, user: SCREENSHOT_USER }
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
  } finally {
    await context.close();
    await browser.close();
  }
}

async function closeDevServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  const timeout = sleep(5000).then(() => {
    if (!child.killed) child.kill('SIGKILL');
  });
  await Promise.race([once(child, 'exit'), timeout]);
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
  const devServer = spawn('npx', ['astro', 'dev', '--host', HOST, '--port', String(port)], {
    cwd: PLAYGROUND_DIR,
    env: {
      ...process.env,
      CMS_JWT_SECRET: JWT_SECRET,
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(baseUrl);
    const token = await createAuthToken(JWT_SECRET);
    console.log('[screenshots] Capturing README images...');
    await captureReadmeScreenshots(baseUrl, token);
    console.log(`[screenshots] Updated ${path.relative(ROOT, DASHBOARD_PATH)}`);
    console.log(`[screenshots] Updated ${path.relative(ROOT, PAGE_EDITOR_PATH)}`);
  } catch (error) {
    if (String(error).includes('Executable doesn\'t exist')) {
      console.error('[screenshots] Chromium browser is not installed for Playwright.');
      console.error('[screenshots] Run: npx playwright install chromium');
    }
    throw error;
  } finally {
    await closeDevServer(devServer);
    if (!redirectsFileExistedBefore) {
      await fs.rm(PLAYGROUND_REDIRECTS_PATH, { force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error('[screenshots] Failed:', error);
  process.exit(1);
});
