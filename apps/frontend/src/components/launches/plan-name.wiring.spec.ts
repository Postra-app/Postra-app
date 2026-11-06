import { readFileSync } from 'fs';
import { join } from 'path';
import { planLabel } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Read as source: the calendar shell pulls SWR, the user context and drag and
// drop, and jsdom does not start in this repo.
//
// The tier enum is not what customers buy: ULTIMATE is sold as Business and
// STANDARD as Starter. The channel picker already said "Business" while the
// sidebar under the channel list said "Ultimate tier" for the same account.
const src = readFileSync(join(__dirname, 'launches.component.tsx'), 'utf8');

describe('plan name under the channel list', () => {
  it('uses the plan name customers buy, not the tier enum', () => {
    expect(src).not.toMatch(/capitalize\(\s*user\?\.tier\?\.current/);
    expect(src).toMatch(/planLabel\(user\?\.tier\?\.current\)\} tier/);
  });

  it('names every paid tier as it is sold', () => {
    expect(planLabel('ULTIMATE')).toBe('Business');
    expect(planLabel('STANDARD')).toBe('Starter');
    expect(planLabel('PRO')).toBe('Pro');
  });
});
