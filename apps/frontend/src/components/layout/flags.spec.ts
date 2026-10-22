import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { languages } from '@gitroom/react/translation/i18n.config';
import { getCountryCodeForFlag } from './flag.code';

// The language switcher shows a flag for every language in the list. The
// files live in public/flags so the browser never asks a third-party CDN
// (E2E-11-48), and each one must be the flag-icons package's copy, so a
// Dependabot bump of flag-icons fails here until the files are refreshed.
const publicFlags = join(__dirname, '..', '..', '..', 'public', 'flags');
const packageFlags = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'node_modules',
  'flag-icons',
  'flags',
  '4x3'
);
const source = readFileSync(join(__dirname, 'language.component.tsx'), 'utf8');

describe('language switcher flags', () => {
  it.each(languages)(
    '%s has its flag in public/flags, same as flag-icons',
    (language) => {
      const file = `${getCountryCodeForFlag(language).toLowerCase()}.svg`;
      expect(existsSync(join(publicFlags, file))).toBe(true);
      expect(readFileSync(join(publicFlags, file), 'utf8')).toBe(
        readFileSync(join(packageFlags, file), 'utf8')
      );
    }
  );

  it('never falls back to the component default CDN', () => {
    const flags = source.match(/<ReactCountryFlag/g) ?? [];
    const own = source.match(/cdnUrl=\{FLAGS_URL\}/g) ?? [];
    expect(flags.length).toBeGreaterThan(0);
    expect(own.length).toBe(flags.length);
  });
});

describe('flags are public', () => {
  // The proxy matcher only skips top-level `<name>.<ext>` paths, so
  // /flags/gb.svg reached the auth gate and answered 307 to /auth for a
  // signed-out browser (production, 22 X after the first deploy).
  it('proxy.ts lets /flags/ through without a session', () => {
    const proxy = readFileSync(join(__dirname, '..', '..', 'proxy.ts'), 'utf8');
    expect(proxy).toContain("nextUrl.pathname.startsWith('/flags/')");
  });
});
