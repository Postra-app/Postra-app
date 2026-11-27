import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The free trial is 5 days and starts without a card from the plan screen;
// the checkout pays at once. Texts of the old 7-day trial in the checkout
// ("Your 7-day trial is 100% free ending…", "Pay £0 Today") were dead code
// that a translation update could have brought back on screen.
const LOCALES = join(__dirname, '../../../../../libraries/react-shared-libraries/src/translation/locales');
const GONE = [
  'billing_your_7_day_trial_is',
  'billing_100_percent_free',
  'billing_ending',
  'billing_cancel_anytime_short',
  'billing_pay_0_start_trial',
  'pay_nothing_for_the_first_7_days',
];

describe('texts of the old 7-day trial', () => {
  it.each(readdirSync(LOCALES))('are gone from %s', (lang) => {
    const strings = JSON.parse(readFileSync(join(LOCALES, lang, 'translation.json'), 'utf8'));
    for (const key of GONE) expect(strings).not.toHaveProperty(key);
  });

  it('are gone from the checkout', () => {
    const source = readFileSync(join(__dirname, 'embedded.billing.tsx'), 'utf8');
    for (const key of GONE) expect(source).not.toContain(key);
  });
});
