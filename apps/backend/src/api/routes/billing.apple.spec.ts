import { BillingController } from '@gitroom/backend/api/routes/billing.controller';

// The same organisation must not be billed by Stripe and by Apple at once,
// and the App Store routes do not exist while the feature is off.
describe('billing: plans bought in the iOS app', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  const build = () => {
    const stripe = {
      subscribe: jest.fn().mockResolvedValue({ url: 'https://checkout' }),
      embedded: jest.fn().mockResolvedValue({ client_secret: 'cs' }),
      trialOffered: jest.fn().mockResolvedValue(true),
    };
    const apple = { attach: jest.fn().mockResolvedValue({ ok: true, tier: 'PRO' }) };
    const controller = new BillingController(
      {} as any,
      stripe as any,
      {} as any,
      { record: jest.fn() } as any,
      apple as any
    );
    return { controller, stripe, apple };
  };
  const appleOrg = {
    id: 'org-1',
    allowTrial: false,
    subscription: { appleOriginalTransactionId: '2000000000000001' },
  } as any;
  const webOrg = { id: 'org-2', allowTrial: true, subscription: null } as any;
  const body = { period: 'MONTHLY', billing: 'PRO' } as any;
  const req = { cookies: {} } as any;

  it.each(['subscribe', 'embedded'] as const)(
    'POST /billing/%s is refused (409) for an organisation Apple bills, before Stripe is called',
    (route) => {
      const { controller, stripe } = build();
      expect(() => controller[route](appleOrg, { id: 'u' } as any, body, req)).toThrow(
        expect.objectContaining({ status: 409 })
      );
      expect(stripe[route]).not.toHaveBeenCalled();
    }
  );

  it.each(['subscribe', 'embedded'] as const)(
    'POST /billing/%s still reaches Stripe for everyone else',
    async (route) => {
      const { controller, stripe } = build();
      await controller[route](webOrg, { id: 'u' } as any, body, req);
      expect(stripe[route]).toHaveBeenCalledWith(undefined, 'org-2', 'u', body, true);
    }
  );

  const person = { id: 'u', email: 'owner@example.com' } as any;

  it('GET /billing/apple/plans is 404 while the feature is off', async () => {
    delete process.env.APPLE_IAP_ENABLED;
    await expect(build().controller.applePlans(webOrg, person)).rejects.toMatchObject({ status: 404 });
  });

  it('an organisation that may still have a trial is shown the products with the free week', async () => {
    process.env.APPLE_IAP_ENABLED = '1';
    const { controller, stripe } = build();
    await expect(controller.applePlans(webOrg, person)).resolves.toEqual({
      trial: true,
      plans: [
        { productId: 'uk.co.postra.app.starter.monthly', tier: 'STANDARD', channels: 4 },
        { productId: 'uk.co.postra.app.pro.monthly', tier: 'PRO', channels: 8 },
        { productId: 'uk.co.postra.app.business.monthly', tier: 'ULTIMATE', channels: 15 },
      ],
    });
    expect(stripe.trialOffered).toHaveBeenCalledWith('org-2', undefined, 'owner@example.com', true);
  });

  // One trial, wherever it was taken: on the web (the organisation's offer is
  // spent), or by this email before (Stripe says so).
  it.each([
    ['the organisation has had its trial', { allowTrial: false }, true],
    ['the email had a trial elsewhere', { allowTrial: true }, false],
  ])('%s: the products without a free week', async (_, over, offered) => {
    process.env.APPLE_IAP_ENABLED = '1';
    const { controller, stripe } = build();
    stripe.trialOffered.mockResolvedValue(offered);
    const result = await controller.applePlans({ ...webOrg, ...over }, person);
    expect(result.trial).toBe(false);
    expect(result.plans.map((p: any) => p.productId)).toEqual([
      'uk.co.postra.app.starter.monthly.notrial',
      'uk.co.postra.app.pro.monthly.notrial',
      'uk.co.postra.app.business.monthly.notrial',
    ]);
    expect(result.plans.map((p: any) => p.tier)).toEqual(['STANDARD', 'PRO', 'ULTIMATE']);
  });

  it('POST /billing/apple/transaction hands the signed transaction over for the signed-in organisation', async () => {
    process.env.APPLE_IAP_ENABLED = '1';
    const { controller, apple } = build();
    await controller.appleTransaction(webOrg, person, { signedTransaction: 'a.b.c' });
    expect(apple.attach).toHaveBeenCalledWith('org-2', 'a.b.c', { trialAllowed: true });
  });

  // The rule the plan list went by also decides whether a free week bought
  // in the app is accepted (the service refuses it when this is false).
  it.each([
    ['the organisation has had its trial', { allowTrial: false }, true],
    ['the email had a trial elsewhere', { allowTrial: true }, false],
    ['the organisation already has a plan', { subscription: { id: 's' } }, true],
  ])('POST /billing/apple/transaction: %s, so no free week', async (_, over, offered) => {
    process.env.APPLE_IAP_ENABLED = '1';
    const { controller, stripe, apple } = build();
    stripe.trialOffered.mockResolvedValue(offered);
    await controller.appleTransaction({ ...webOrg, ...over }, person, { signedTransaction: 'a.b.c' });
    expect(apple.attach).toHaveBeenCalledWith('org-2', 'a.b.c', { trialAllowed: false });
  });

  it('POST /billing/apple/transaction is 404 while the feature is off', async () => {
    delete process.env.APPLE_IAP_ENABLED;
    const { controller, apple } = build();
    await expect(
      controller.appleTransaction(webOrg, person, { signedTransaction: 'a.b.c' })
    ).rejects.toMatchObject({ status: 404 });
    expect(apple.attach).not.toHaveBeenCalled();
  });
});
