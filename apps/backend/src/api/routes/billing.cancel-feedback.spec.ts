jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { BillingController } from './billing.controller';

// The cancellation notice to the operator carried the organisation's name and
// the customer's feedback into the mail's HTML as they were: a customer could
// put links, images or a fake form into a mail signed for postra.co.uk.
describe('POST /billing/cancel', () => {
  const run = async (name: string, feedback: unknown) => {
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    const controller = new BillingController(
      {} as any,
      { setToCancel: jest.fn().mockResolvedValue({ cancel_at: 1_800_000_000 }) } as any,
      { sendEmail } as any,
      { record: jest.fn() } as any
    );
    await controller.cancel(
      { id: 'org-1', name } as any,
      { id: 'user-1', email: 'owner@example.com' } as any,
      { feedback } as any
    );
    return sendEmail.mock.calls.find((c) => c[1] === 'Subscription Cancelled')![2] as string;
  };

  it('puts the name and the feedback in as text, not markup', async () => {
    const html = await run('<b>Acme</b>', '<a href="https://evil.example">Verify your account</a>');
    expect(html).not.toMatch(/<a |<b>/);
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
  });

  it('keeps the feedback to a readable length and survives a missing one', async () => {
    expect((await run('Acme', 'x'.repeat(10_000))).length).toBeLessThan(2_500);
    expect(await run('Acme', undefined)).toContain('Acme');
  });
});
