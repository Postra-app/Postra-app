jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { BillingController } from './billing.controller';

// E2E-07-41: ending the trial charges the card, and nothing recorded who did
// it or when — on Kris Company (2026-10-09) it could not be told whether the
// button was clicked.
describe('POST /billing/finish-trial', () => {
  it('records who ended the trial and the result', async () => {
    const record = jest.fn();
    const controller = new BillingController(
      {} as any,
      { finishTrial: jest.fn().mockResolvedValue({ finish: true }) } as any,
      {} as any,
      { record } as any
    );

    await expect(
      controller.finishTrial({ id: 'org-1', paymentId: 'cus_1' } as any, { id: 'user-1' } as any)
    ).resolves.toEqual({ finish: true });

    expect(record).toHaveBeenCalledWith({
      action: 'billing.finish-trial',
      organizationId: 'org-1',
      userId: 'user-1',
      metadata: { finish: true, reason: undefined },
    });
  });
});
