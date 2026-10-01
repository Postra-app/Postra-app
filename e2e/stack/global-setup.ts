import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { BACKEND_URL, stateFile } from './helpers';
import { resetAndSeed, UserKey, USERS } from './seed';

// Fresh data for every run, then one sign-in per seeded user through the real
// login endpoint. Specs reuse the saved cookies instead of logging in again.
export default async function globalSetup() {
  await resetAndSeed(process.env.DATABASE_URL!, process.env.REDIS_URL!);
  mkdirSync(`${__dirname}/.auth`, { recursive: true });

  for (const key of Object.keys(USERS) as UserKey[]) {
    const api = await request.newContext({ baseURL: BACKEND_URL });
    const res = await api.post('/auth/login', {
      data: {
        email: USERS[key].email,
        password: USERS[key].password,
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
