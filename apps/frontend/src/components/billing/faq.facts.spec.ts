import { readFileSync } from 'fs';
import { join } from 'path';

// The Billing FAQ (shown on the paywall too) promised a "$2" hold
// while Stripe holds £1, and named Reddit, Dribbble and Pinterest, which no
// plan had then (Pinterest joined on 2026-10-27). The facts in the English text come from the code.

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
  'instagram-standalone': 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  // A company Page is LinkedIn too; the sentence names platforms.
  'linkedin-page': 'LinkedIn',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  telegram: 'Telegram',
  gmb: 'Google Business Profile',
  discord: 'Discord',
  pinterest: 'Pinterest',
  slack: 'Slack',
  wordpress: 'WordPress',
};

// The trial starts without a card: the FAQ said a card is held
// for £1 and charged when the trial ends.
it('says the free trial needs no card and charges nothing when it ends', () => {
  expect(en.faq_free_trial_no_card).toContain('needs no card');
  expect(en.faq_free_trial_no_card).toContain('so nothing is charged when it ends');
  expect(en.faq_free_trial_no_card).not.toMatch(/£1|hold/);
  expect(stripe).toContain("missing_payment_method: 'cancel'");
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
  // Pinterest is on since 2026-10-27 (Standard access approved).
  for (const missing of ['Reddit', 'Dribbble']) {
    expect(text).not.toContain(missing);
  }
});

// The trial note names every trial limit (pricing.ts
// TRIAL_LIMITS); it used to name only channels and AI, so a Business trial met
// a 402 at the 31st post or the second webhook without having been told.
it('names every trial limit in the trial note, in English and Polish', () => {
  const pl = JSON.parse(
    read('libraries/react-shared-libraries/src/translation/locales/pl/translation.json')
  );
  const note = read('apps/frontend/src/components/billing/trial.limits.note.tsx');
  for (const text of [en.billing_free_trial_limits, pl.billing_free_trial_limits]) {
    for (const value of ['days', 'channels', 'posts', 'webhooks', 'feeds', 'images', 'videos']) {
      expect(text).toContain(`{{${value}}}`);
      expect(note).toMatch(new RegExp(`\\b${value}: `));
    }
    expect(text).not.toMatch(/[–—]/);
  }
});

// It sent people to Settings to cancel; "Cancel my subscription" is on the
// Billing page, its own menu entry.
it('sends people to Billing to cancel, where the button is', () => {
  const pl = JSON.parse(
    read('libraries/react-shared-libraries/src/translation/locales/pl/translation.json')
  );
  const page = read('apps/frontend/src/components/billing/main.billing.component.tsx');
  expect(page).toContain("'cancel_my_subscription'");
  expect(en.faq_free_trial_no_card).toContain(`cancel any time in ${en.billing}`);
  expect(pl.faq_free_trial_no_card).toContain(`w zakładce ${pl.billing}`);
});
