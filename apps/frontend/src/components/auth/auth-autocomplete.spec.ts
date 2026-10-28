import { readFileSync } from 'fs';
import { join } from 'path';

// WCAG 2.2 SC 1.3.5 (Identify Input Purpose, AA): fields that collect data
// about the user carry an autocomplete token, so browsers and password
// managers can fill them. Every password field had autoComplete="off", which
// also stops password managers from offering the saved password
// (2026-10-22). The HTML tokens: email, current-password,
// new-password, organization.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('auth forms identify their input purpose', () => {
  it.each([
    'login.tsx',
    'register.tsx',
    'forgot.tsx',
    'forgot-return.tsx',
    'activate.tsx',
  ])('%s has no autoComplete="off"', (file) => {
    expect(read(file)).not.toContain('autoComplete="off"');
  });

  it('login: email + current password', () => {
    const s = read('login.tsx');
    expect(s).toContain('autoComplete="email"');
    expect(s).toContain('autoComplete="current-password"');
  });

  it('register: email, two new passwords, organisation', () => {
    const s = read('register.tsx');
    expect(s).toContain('autoComplete="email"');
    expect(s.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(s).toContain('autoComplete="organization"');
  });

  it('reset: two new passwords; forgot and resend: email', () => {
    expect(
      read('forgot-return.tsx').match(/autoComplete="new-password"/g)
    ).toHaveLength(2);
    expect(read('forgot.tsx')).toContain('autoComplete="email"');
    expect(read('activate.tsx')).toContain('autoComplete="email"');
  });
});

describe('password reveal toggle', () => {
  it('is reachable with the keyboard (no tabIndex -1)', () => {
    const input = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'libraries',
        'react-shared-libraries',
        'src',
        'form',
        'input.tsx'
      ),
      'utf8'
    );
    expect(input).toContain(
      "aria-label={reveal ? 'Hide password' : 'Show password'}"
    );
    expect(input).not.toContain('tabIndex={-1}');
  });
});

describe('sign-in screens stay out of search results', () => {
  it('the auth layout sets robots noindex', () => {
    const layout = readFileSync(
      join(__dirname, '..', '..', 'app', '(app)', 'auth', 'layout.tsx'),
      'utf8'
    );
    expect(layout).toMatch(
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/
    );
  });
});
