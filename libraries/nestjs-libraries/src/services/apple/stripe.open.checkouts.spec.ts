const list = jest.fn();
const expire = jest.fn();
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ checkout: { sessions: { list, expire } } })),
}));

import { StripeOpenCheckouts } from '@gitroom/nestjs-libraries/services/apple/stripe.open.checkouts';

describe('StripeOpenCheckouts', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  });
  afterAll(() => {
    process.env = env;
  });

  it('expires every open checkout of the customer', async () => {
    list.mockResolvedValue({ data: [{ id: 'cs_1' }, { id: 'cs_2' }] });
    await expect(new StripeOpenCheckouts().expire('cus_1')).resolves.toBe(2);
    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', status: 'open', limit: 100 });
    expect(expire.mock.calls).toEqual([['cs_1'], ['cs_2']]);
  });

  it('asks Stripe nothing without a Stripe customer or without Stripe', async () => {
    const service = new StripeOpenCheckouts();
    await expect(service.expire(null)).resolves.toBe(0);
    await expect(service.expire('user-id-not-a-customer')).resolves.toBe(0);
    delete process.env.STRIPE_SECRET_KEY;
    await expect(service.expire('cus_1')).resolves.toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});
