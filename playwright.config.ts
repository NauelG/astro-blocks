import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',

  // Single Chromium project — expand to multi-browser later
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list']],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://127.0.0.1:4321',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: `cd ${path.join(__dirname, 'playgrounds', 'basic')} && node ./dist/server/entry.mjs`,
    url: 'http://127.0.0.1:4321/cms',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOST: '127.0.0.1',
      PORT: '4321',
      ASTRO_BLOCKS_PROJECT_ROOT: path.join(__dirname, '.e2e-data'),
      // The playground runs a production Astro build, so auth fails closed without a secret.
      ASTRO_BLOCKS_JWT_SECRET: 'e2e-test-secret-not-for-production',
      NODE_V8_COVERAGE: path.join(__dirname, '.coverage-v8'),
    },
  },
});
