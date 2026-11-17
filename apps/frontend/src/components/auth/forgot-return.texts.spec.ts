import en from '@gitroom/react/translation/locales/en/translation.json';
import pl from '@gitroom/react/translation/locales/pl/translation.json';
import { readFileSync } from 'fs';
import { join } from 'path';

// After a password reset the page said "You can now login with your" and
// stopped: the sentence ends now, in both languages.
describe('password reset done', () => {
  const key = 'we_successfully_reset_your_password_you_can_now_login_with_your';
  it('ends its sentence', () => {
    expect((en as Record<string, string>)[key]).toMatch(/new password\.$/);
    expect((pl as Record<string, string>)[key]).toMatch(/nowym hasłem\.$/);
    expect(readFileSync(join(__dirname, 'forgot-return.tsx'), 'utf8')).toContain(
      'You can now log in with your new password.'
    );
  });
});

// The Bluesky provider never reads a thread finisher, so the composer
// must not offer one.
describe('Bluesky settings', () => {
  it('offer no thread finisher the provider would ignore', () => {
    const front = readFileSync(
      join(__dirname, '../new-launch/providers/bluesky/bluesky.provider.tsx'),
      'utf8'
    );
    const back = readFileSync(
      join(__dirname, '../../../../../libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts'),
      'utf8'
    );
    expect(back).not.toMatch(/finisher/i);
    expect(front).not.toContain('<ThreadFinisher');
  });
});
