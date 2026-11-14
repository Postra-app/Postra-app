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

// The confirmation said "You keep full access until <today>" when a failed
// payment had just ended the plan, and a failed operator mail skipped it.
describe('POST /billing/cancel: the customer confirmation', () => {
  const run = async (result: object, operatorFails = false) => {
    const sendEmail = jest.fn(async (to: string, ..._rest: unknown[]) => {
      if (operatorFails && to !== 'owner@example.com') throw new Error('SES down');
    });
    const controller = new BillingController(
      {} as any,
      { setToCancel: jest.fn().mockResolvedValue(result) } as any,
      { sendEmail } as any,
      { record: jest.fn() } as any
    );
    await controller.cancel(
      { id: 'org-1', name: 'Acme' } as any,
      { id: 'user-1', email: 'owner@example.com' } as any,
      { feedback: 'x' } as any
    );
    return sendEmail.mock.calls.find((c) => c[0] === 'owner@example.com')?.[2] as string | undefined;
  };

  it('a plan ended at once says so, not "full access until today"', async () => {
    const text = await run({ cancel_at: new Date(), immediate: true });
    expect(text).toMatch(/your plan ended today/);
    expect(text).not.toMatch(/full access until/);
  });

  it('a plan ending later gives the date in UTC', async () => {
    const text = await run({ cancel_at: new Date('2026-12-14T23:30:00Z') });
    expect(text).toContain('You keep full access until 14 December 2026 (UTC).');
  });

  it('reaches the customer when the operator mail fails', async () => {
    expect(await run({ cancel_at: new Date('2026-12-14T12:00:00Z') }, true)).toContain('14 December 2026');
  });
});

// A second cancel from a stale tab changes nothing, so it must not send the
// customer a second "cancelled" mail, and the intent reaches the service.
describe('POST /billing/cancel: the intent', () => {
  const run = async (result: object, body: object) => {
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    const setToCancel = jest.fn().mockResolvedValue(result);
    const controller = new BillingController({} as any, { setToCancel } as any, { sendEmail } as any, { record: jest.fn() } as any);
    await controller.cancel({ id: 'org-1', name: 'Acme' } as any, { id: 'user-1', email: 'owner@example.com' } as any, body as any);
    return { sendEmail, setToCancel };
  };

  it('passes cancel: true / false on, and nothing else as an intent', async () => {
    expect((await run({}, { feedback: 'x', cancel: true })).setToCancel).toHaveBeenCalledWith('org-1', true);
    expect((await run({}, { feedback: '', cancel: false })).setToCancel).toHaveBeenCalledWith('org-1', false);
    expect((await run({}, { feedback: 'x', cancel: 'false' })).setToCancel).toHaveBeenCalledWith('org-1', undefined);
  });

  it('sends no mail when nothing changed', async () => {
    const { sendEmail } = await run({ cancel_at: new Date('2026-12-14T12:00:00Z'), unchanged: true }, { feedback: 'x', cancel: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
