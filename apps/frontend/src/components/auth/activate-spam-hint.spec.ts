import { readFileSync } from 'fs';
import { join } from 'path';

// A first mail from a young sending domain can land in spam even when SPF,
// DKIM and DMARC all pass; the page after sign-up says where else to look.
describe('after sign-up', () => {
  const root = join(__dirname, '..', '..', '..', '..', '..');
  it('the activation page points to the spam folder', () => {
    const page = readFileSync(join(__dirname, 'activate.tsx'), 'utf8');
    expect(page).toContain("'activation_check_spam'");
    for (const lang of ['en', 'pl', 'de', 'es', 'fr']) {
      const file = join(
        root,
        'libraries/react-shared-libraries/src/translation/locales',
        lang,
        'translation.json'
      );
      const text = JSON.parse(readFileSync(file, 'utf8')).activation_check_spam;
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(10);
    }
  });
});
