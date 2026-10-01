import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Tests against a whole Postra running locally on throwaway stores
// (docker-compose.yml). Unlike e2e/playwright, which only ever drafts on
// production, these may create, publish and delete anything. See README.md.

const envKeys = (file: string) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/))
        .filter((match): match is RegExpMatchArray => !!match)
    : [];

// stack.env holds only local fakes; load it so the backend and the seed see
// the same values whether the run starts from a shell or from CI.
for (const [, key, value] of envKeys(`${__dirname}/stack.env`)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// Prisma Client loads the repo's .env into process.env for every variable not
// already set — so on a developer's machine the stack quietly ran with their
// Stripe, OpenAI and SMTP credentials, and behaved unlike CI (which has no
// .env). Blank every key it would add; a set variable, even empty, wins.
for (const [, key] of envKeys(`${__dirname}/../../.env`)) {
  if (process.env[key] === undefined) process.env[key] = '';
}

const repo = `${__dirname}/../..`;
const reuse = !process.env.CI;

// The UI layer also needs the built frontend and a browser; the API layer
// runs without both. `pnpm e2e:stack:ui` sets STACK_UI.
const withUi = !!process.env.STACK_UI;

// Server output goes to e2e/stack/.logs/<app>.log (CI uploads it when a run
// fails) — inline, the Temporal worker alone buries the test report.
mkdirSync(`${__dirname}/.logs`, { recursive: true });

const nodeApp = (app: string, url: string) => ({
  // Built by `pnpm build:<app>`; the run fails fast if dist is missing.
  command: `node --experimental-require-module ./dist/apps/${app}/src/main.js > ${__dirname}/.logs/${app}.log 2>&1`,
  cwd: `${repo}/apps/${app}`,
  url,
  reuseExistingServer: reuse,
  timeout: 120_000,
});

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './global-setup.ts',
  webServer: [
    {
      command: 'node e2e/stack/fake-mastodon.mjs',
      cwd: repo,
      url: 'http://localhost:58080/health',
      reuseExistingServer: reuse,
    },
    {
      command: 'node e2e/stack/fake-openai.mjs',
      cwd: repo,
      url: 'http://localhost:58090/health',
      reuseExistingServer: reuse,
    },
    nodeApp('backend', 'http://localhost:53000/monitor/queue/main'),
    // The Temporal worker: without it nothing scheduled ever publishes.
    // It has no HTTP port; wait on its Prometheus endpoint (fixed :9464).
    nodeApp('orchestrator', 'http://localhost:9464/metrics'),
    ...(withUi
      ? [
          {
            command: `npx next start -p 54200 > ${__dirname}/.logs/frontend.log 2>&1`,
            cwd: `${repo}/apps/frontend`,
            url: 'http://localhost:54200/auth/login',
            reuseExistingServer: reuse,
            timeout: 120_000,
          },
          {
            command: 'node e2e/stack/proxy.mjs',
            cwd: repo,
            url: 'http://localhost:54000/api/monitor/queue/main',
            reuseExistingServer: reuse,
          },
        ]
      : []),
  ],
  projects: [
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    ...(withUi
      ? [
          {
            name: 'ui',
            testMatch: /ui\/.*\.spec\.ts/,
            use: {
              baseURL: 'http://localhost:54000',
              browserName: 'chromium' as const,
              viewport: { width: 1440, height: 900 },
              locale: 'en-GB',
              storageState: `${__dirname}/.auth/a.json`,
              screenshot: 'only-on-failure' as const,
              trace: 'retain-on-failure' as const,
            },
          },
        ]
      : []),
  ],
});
