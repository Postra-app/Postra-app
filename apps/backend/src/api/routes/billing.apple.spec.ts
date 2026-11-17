import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
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
  ])('%s: the same three products, no free week said', async (_, over, offered) => {
    process.env.APPLE_IAP_ENABLED = '1';
    const { controller, stripe } = build();
    stripe.trialOffered.mockResolvedValue(offered);
    const result = await controller.applePlans({ ...webOrg, ...over }, person);
    expect(result.trial).toBe(false);
    // One product per plan for everyone: two copies of each plan made Apple's
    // own subscription sheet list every plan twice.
    expect(result.plans.map((p: any) => p.productId)).toEqual([
      'uk.co.postra.app.starter.monthly',
      'uk.co.postra.app.pro.monthly',
      'uk.co.postra.app.business.monthly',
    ]);
    expect(result.plans.map((p: any) => p.tier)).toEqual(['STANDARD', 'PRO', 'ULTIMATE']);
  });

  // Apple's free week is switched off for a purchase by a statement the
  // server signs with the In-App Purchase key (StoreKit's
  // introductoryOfferEligibility); Apple checks it against that key.
  describe('POST /billing/apple/offer', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const offer = { productId: 'uk.co.postra.app.pro.monthly', appTransactionId: '704289572311229970' };
    const signing = () => {
      process.env.APPLE_IAP_ENABLED = '1';
      process.env.APPLE_IAP_SIGNING_KEY = Buffer.from(pem).toString('base64');
      process.env.APPLE_IAP_KEY_ID = 'KEY123ABCD';
      process.env.APPLE_IAP_ISSUER_ID = '57246542-96fe-1a63-e053-0824d011072a';
    };

    it.each([
      ['the organisation has had its trial', { allowTrial: false }, true],
      ['the email had a trial elsewhere', { allowTrial: true }, false],
    ])('%s: signs "no free week" for this product and this Apple ID', async (_, over, offered) => {
      signing();
      const { controller, stripe } = build();
      stripe.trialOffered.mockResolvedValue(offered);
      const { eligibility } = await controller.appleOffer({ ...webOrg, ...over }, person, offer);
      const decoded = jwt.verify(eligibility, publicPem, {
        algorithms: ['ES256'],
        audience: 'introductory-offer-eligibility',
        issuer: '57246542-96fe-1a63-e053-0824d011072a',
        complete: true,
      });
      expect(decoded.header.kid).toBe('KEY123ABCD');
      expect(decoded.payload).toMatchObject({
        productId: 'uk.co.postra.app.pro.monthly',
        allowIntroductoryOffer: false,
        transactionId: '704289572311229970',
        bid: 'uk.co.postra.app',
      });
    });

    it('an organisation that may still have a trial gets nothing to sign: Apple decides', async () => {
      signing();
      await expect(build().controller.appleOffer(webOrg, person, offer)).resolves.toEqual({
        eligibility: null,
      });
    });

    it('the key also works as the PEM itself', async () => {
      signing();
      process.env.APPLE_IAP_SIGNING_KEY = pem.replace(/\n/g, '\\n');
      const { eligibility } = await build().controller.appleOffer(
        { ...webOrg, allowTrial: false },
        person,
        offer
      );
      expect(jwt.verify(eligibility, publicPem, { algorithms: ['ES256'] })).toMatchObject({
        allowIntroductoryOffer: false,
      });
    });

    it('without the key an organisation past its trial cannot buy (503), never a second free week', async () => {
      signing();
      delete process.env.APPLE_IAP_SIGNING_KEY;
      await expect(
        build().controller.appleOffer({ ...webOrg, allowTrial: false }, person, offer)
      ).rejects.toMatchObject({ status: 503 });
    });

    it('a product that is not ours is refused (400)', async () => {
      signing();
      await expect(
        build().controller.appleOffer({ ...webOrg, allowTrial: false }, person, {
          ...offer,
          productId: 'uk.co.postra.app.pro.monthly.notrial',
        })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('is 404 while the feature is off', async () => {
      signing();
      delete process.env.APPLE_IAP_ENABLED;
      await expect(build().controller.appleOffer(webOrg, person, offer)).rejects.toMatchObject({
        status: 404,
      });
    });
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
