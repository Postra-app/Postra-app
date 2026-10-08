import { defineConfig, devices } from '@playwright/test';

// Local proofs on production after a deploy. Not committed.
export default defineConfig({
  testDir: '.',
  testMatch: /proof\..*\.ts/,
  outputDir: './.results-proof',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'https://app.postra.pl',
    trace: 'off',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'session', testMatch: /proof\.session\.ts/ },
    {
      name: 'proof',
      testMatch: /proof\..*\.spec\.ts/,
      dependencies: ['session'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
