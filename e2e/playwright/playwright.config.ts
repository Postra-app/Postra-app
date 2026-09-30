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
      testMatch: /\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: STATE_FILE,
      },
    },
  ],
});
