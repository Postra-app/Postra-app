import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { autopostAccess } from '@gitroom/frontend/components/autopost/autopost.access';

describe('autopostAccess', () => {
  it('Starter does not include Auto Post', () => {
    expect(autopostAccess(pricing.STANDARD, 0)).toMatchObject({
      included: false,
      atLimit: false,
    });
  });

  it('Pro allows three feeds, then is at its limit', () => {
    expect(autopostAccess(pricing.PRO, 2)).toMatchObject({
      included: true,
      limit: 3,
      atLimit: false,
    });
    expect(autopostAccess(pricing.PRO, 3).atLimit).toBe(true);
  });

  it('Business allows ten', () => {
    expect(autopostAccess(pricing.ULTIMATE, 9).atLimit).toBe(false);
    expect(autopostAccess(pricing.ULTIMATE, 10).atLimit).toBe(true);
  });

  it('a flag without a feed allowance is not access', () => {
    expect(autopostAccess({ autoPost: true, autoPostLimit: 0 }, 0).included).toBe(false);
    expect(autopostAccess(undefined, 0).included).toBe(false);
  });
});
