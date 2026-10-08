import { readFileSync } from 'fs';
import { join } from 'path';

// E2E-07-37: the Billing FAQ (shown on the paywall too) promised a "$2" hold
// while Stripe holds £1, and named Reddit, Dribbble and Pinterest, which no
// plan has. The facts in the English text come from the code.

const root = join(__dirname, '..', '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const en = JSON.parse(
  read('libraries/react-shared-libraries/src/translation/locales/en/translation.json')
);
const stripe = read('libraries/nestjs-libraries/src/services/stripe.service.ts');
const manager = read('libraries/nestjs-libraries/src/integrations/integration.manager.ts');

const NAMES: Record<string, string> = {
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  telegram: 'Telegram',
  discord: 'Discord',
};

it('names the card hold Stripe actually places', () => {
  const hold = stripe.match(/amount: (\d+),\s*currency: '(\w+)'/);
  expect(hold).toBeTruthy();
  const [, pence, currency] = hold!;
  expect(currency).toBe('gbp');
  expect(en.faq_to_confirm_credit_card_information_postra_will_hold).toContain(`£${+pence / 100}`);
  expect(en.faq_to_confirm_credit_card_information_postra_will_hold).not.toMatch(/\$/);
});

it('lists exactly the platforms a channel can be connected to', () => {
  const block = manager.match(/const enabledProviders = new Set\(\[([\s\S]*?)\]\)/)![1];
  const enabled = [...block.replace(/\/\/.*$/gm, '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect(enabled.length).toBeGreaterThan(5);
  const text: string = en.faq_postra_gitroom_allows_you_to_schedule_posts;
  for (const id of enabled) {
    expect(NAMES[id]).toBeTruthy();
    expect(text).toContain(NAMES[id]);
  }
  for (const missing of ['Reddit', 'Dribbble', 'Pinterest']) {
    expect(text).not.toContain(missing);
  }
});
