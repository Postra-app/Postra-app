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

  it('GET /billing/apple/plans is 404 while the feature is off', () => {
    delete process.env.APPLE_IAP_ENABLED;
    expect(() => build().controller.applePlans()).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('GET /billing/apple/plans lists the three monthly products with their plans', () => {
    process.env.APPLE_IAP_ENABLED = '1';
    expect(build().controller.applePlans()).toEqual({
      plans: [
        { productId: 'uk.co.postra.app.starter.monthly', tier: 'STANDARD', channels: 4 },
        { productId: 'uk.co.postra.app.pro.monthly', tier: 'PRO', channels: 8 },
        { productId: 'uk.co.postra.app.business.monthly', tier: 'ULTIMATE', channels: 15 },
      ],
    });
  });

  it('POST /billing/apple/transaction hands the signed transaction over for the signed-in organisation', async () => {
    const { controller, apple } = build();
    await controller.appleTransaction(webOrg, { signedTransaction: 'a.b.c' });
    expect(apple.attach).toHaveBeenCalledWith('org-2', 'a.b.c');
  });
});
