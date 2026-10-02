import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { BACKEND_URL, stateFile } from './helpers';
import { ACCOUNTS, resetAndSeed } from './seed';

// Fresh data for every run, then one sign-in per seeded user through the real
// login endpoint. Specs reuse the saved cookies instead of logging in again.
export default async function globalSetup() {
  await resetAndSeed(process.env.DATABASE_URL!, process.env.REDIS_URL!);
  mkdirSync(`${__dirname}/.auth`, { recursive: true });

  for (const [index, [key, account]] of ACCOUNTS.entries()) {
    // Login allows 5 attempts per address per 15 minutes, and auth.spec.ts
    // spends two of its own; each seeded account signs in from its own
    // (documentation-range) address so the seed never eats that budget.
    const api = await request.newContext({
      baseURL: BACKEND_URL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${index + 1}` },
    });
    const res = await api.post('/auth/login', {
      data: {
        email: account.email,
        password: account.password,
        provider: 'LOCAL',
      },
    });
    if (res.status() !== 200) {
      throw new Error(
        `sign-in as ${key} failed: ${res.status()} ${await res.text()}`
      );
    }
    await api.storageState({ path: stateFile(key) });
    await api.dispose();
  }
}
