import { defineConfig, devices } from '@playwright/test';
import { STATE_FILE } from './env';

// Browser tests that run against a live Postra (production by default).
// They only ever create drafts: "Post now" and "Schedule" publish to real
// channels, so nothing here may click them. See e2e/playwright/README.md.
export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // A retry would log in again, and sign-in is capped at 5 attempts per
  // 15 minutes per IP.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://app.postra.pl',
    // A trace records request headers, session cookie included, and CI
    // artifacts of this public repo are downloadable — no traces there.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: STATE_FILE,
      },
    },
    // Safari on a desktop: the nightly canary only, the deploy gate stays on
    // Chromium to stay fast.
    {
      name: 'smoke-webkit',
      testMatch: /smoke\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        storageState: STATE_FILE,
      },
    },
    // AI on the real OpenAI key: the nightly canary only (it costs tokens).
    {
      name: 'ai-canary',
      testMatch: /ai\.canary\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STATE_FILE },
    },
    // Real publishing on the technical channels: the nightly canary only.
    {
      name: 'publish-canary',
      testMatch: /publish\.canary\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STATE_FILE },
    },
    // The UK landing: public, no sign-in.
    {
      name: 'landing',
      testMatch: /landing\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_LANDING_URL || 'https://postra.co.uk',
      },
    },
  ],
});
