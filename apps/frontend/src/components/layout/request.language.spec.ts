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

  // (provider) and (extension) passed language="en": the server rendered
  // English for a Polish browser, and the browser, starting on the server's
  // language, saved "en" over the visitor's choice.
  it('every layout renders the request language', () => {
    for (const group of ['(app)', '(provider)', '(extension)']) {
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
