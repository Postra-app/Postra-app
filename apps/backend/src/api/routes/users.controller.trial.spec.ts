jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsersController } = require('./users.controller');

// 18 X: the billing pages promise a trial from /user/self's allowTrial. An
// email that already had a trial was promised seven free days and charged.
describe('/user/self allowTrial', () => {
  const self = async (org: object, offered: boolean) => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const trialOffered = jest.fn().mockResolvedValue(offered);
    const controller = Object.create(UsersController.prototype);
    Object.assign(controller, { _stripeService: { trialOffered } });
    const res = await controller.getSelf({ id: 'u1', email: 'szyszka518@yahoo.co.uk' }, { id: 'org-1', paymentId: 'cus_1', users: [{ role: 'SUPERADMIN' }], ...org }, {});
    return { allowTrial: res.allowTrial, trialOffered };
  };

  it('asks whether the offer still stands for an organisation without a plan', async () => {
    const { allowTrial, trialOffered } = await self({ allowTrial: true }, false);
    expect(allowTrial).toBe(false);
    expect(trialOffered).toHaveBeenCalledWith('org-1', 'cus_1', 'szyszka518@yahoo.co.uk', true);
  });

  it('does not ask for a paying organisation or one whose offer ended', async () => {
    const paying = await self({ allowTrial: true, subscription: { subscriptionTier: 'PRO' } }, false);
    expect(paying.allowTrial).toBe(true);
    expect(paying.trialOffered).not.toHaveBeenCalled();
    const ended = await self({ allowTrial: false }, true);
    expect(ended.allowTrial).toBe(false);
    expect(ended.trialOffered).not.toHaveBeenCalled();
  });
});
