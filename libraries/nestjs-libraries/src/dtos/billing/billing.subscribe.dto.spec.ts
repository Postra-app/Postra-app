import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BillingSubscribeDto } from './billing.subscribe.dto';

// E2E-11-64: these strings go into the Stripe subscription's metadata, where
// a value over 500 characters is refused. A longer one was a Stripe 400, our
// 500 and a Sentry event per request, from any signed-in account.
describe('BillingSubscribeDto', () => {
  const base = { period: 'MONTHLY', billing: 'PRO' };
  const errorsFor = async (extra: object) =>
    (await validate(plainToInstance(BillingSubscribeDto, { ...base, ...extra }))).map(
      (e) => e.property
    );

  it('takes the usual tracking values', async () => {
    expect(
      await errorsFor({ utm: 'newsletter', dub: 'abc123', datafast_session_id: 's', datafast_visitor_id: 'v' })
    ).toEqual([]);
  });

  it.each(['utm', 'dub', 'datafast_session_id', 'datafast_visitor_id'])(
    'refuses a %s longer than Stripe metadata takes',
    async (field) => {
      expect(await errorsFor({ [field]: 'x'.repeat(501) })).toEqual([field]);
    }
  );
});
