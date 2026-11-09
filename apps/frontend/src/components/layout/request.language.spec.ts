import { readFileSync } from 'fs';
import { join } from 'path';

const jar: { cookie?: string; header?: string } = {};
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'i18next' && jar.cookie ? { value: jar.cookie } : undefined,
  }),
  headers: async () => ({
    get: (name: string) =>
      name === 'x-i18next-current-language' ? jar.header ?? null : null,
  }),
}));

import { requestLanguage } from './request.language';

describe('requestLanguage', () => {
  it('the saved choice wins over the device language', async () => {
    Object.assign(jar, { cookie: 'pl', header: 'en' });
    expect(await requestLanguage()).toBe('pl');
  });

  it('a first visit renders the device language', async () => {
    Object.assign(jar, { cookie: undefined, header: 'pl' });
    expect(await requestLanguage()).toBe('pl');
  });

  it('English when nothing is known', async () => {
    Object.assign(jar, { cookie: undefined, header: undefined });
    expect(await requestLanguage()).toBe('en');
  });

  // A language parked (German and twelve others held a third of the
  // texts) must not come back from a cookie saved before, nor from a device
  // that asks for it: English, like any language Postra does not offer.
  it('a saved or device language Postra no longer offers renders English', async () => {
    Object.assign(jar, { cookie: 'de', header: 'fr' });
    expect(await requestLanguage()).toBe('en');
    Object.assign(jar, { cookie: 'de', header: 'pl' });
    expect(await requestLanguage()).toBe('pl');
  });

  // (extension) passed language="en" (and (provider), since removed): the
  // server rendered English for a Polish browser, and the browser, starting
  // on the server's language, saved "en" over the visitor's choice.
  it('every layout renders the request language', () => {
    for (const group of ['(app)', '(extension)']) {
      const layout = readFileSync(
        join(__dirname, '..', '..', 'app', group, 'layout.tsx'),
        'utf8'
      );
      expect(layout).toContain('await requestLanguage()');
      expect(layout).toContain('language={language}');
      expect(layout).not.toMatch(/language="/);
    }
  });
});
