// The services are fakes here; their real modules pull in every provider SDK.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/errors/errors.service',
  () => ({ ErrorsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({
    IntegrationService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({
    SubscriptionService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service',
  () => ({
    MaintenanceService: class {},
    DEFAULT_RETENTION: {
      errorsDays: 90,
      auditDays: 400,
      aiUsageDays: 400,
      stripeEventsDays: 90,
      mediaGraceDays: 30,
      pushTokenDays: 30,
    },
  })
);

import { BackfillGrantedScopes } from './backfill.granted.scopes';
import { BackfillMediaType } from './backfill.media.type';
import { EncryptTokens } from './encrypt.tokens';
import { GrandfatherSubscriptions } from './grandfather.subscriptions';
import { GrantLifetime } from './grant.lifetime';
import { PurgeOldRecords } from './purge.old.records';
import { RefreshTokens } from './refresh.tokens';
import { ScrubErrorSecrets } from './scrub.error.secrets';
import { SyncChannelSlots } from './sync.channel.slots';

// These commands are run by hand on production. Every one that writes is a
// dry run unless `--apply` is on the command line; `refresh` once wrote
// straight away, so the rule is guarded here for all of them: without the
// flag no service call gets `true`, with it at least one does.

type Call = { method: string; args: unknown[] };

// An empty list whose every other property is 0, so the commands can loop
// over and print whatever report they get back.
const report: any = new Proxy([], {
  get: (target, key) =>
    key === 'then'
      ? undefined
      : key in target
      ? (target as any)[key]
      : typeof key === 'string' && /s$/.test(key)
      ? []
      : 0,
});

const fakeService = (calls: Call[]) =>
  new Proxy(
    {},
    {
      get:
        (_t, method) =>
        (...args: unknown[]) => {
          calls.push({ method: String(method), args });
          return Promise.resolve(report);
        },
    }
  );

const commands: [
  string,
  (service: any) => { run: () => Promise<unknown> },
  string[]
][] = [
  ['backfill-granted-scopes', (s) => new BackfillGrantedScopes(s), []],
  ['backfill-media-type', (s) => new BackfillMediaType(s), []],
  [
    'encrypt-tokens',
    (s) => {
      const c = new EncryptTokens(s);
      return { run: () => c.encrypt() };
    },
    [],
  ],
  ['grandfather-subscriptions', (s) => new GrandfatherSubscriptions(s), []],
  [
    'grant-lifetime',
    (s) => new GrantLifetime(s),
    ['--email=someone@example.com'],
  ],
  ['purge-old-records', (s) => new PurgeOldRecords(s), []],
  [
    'refresh',
    (s) => {
      const c = new RefreshTokens(s);
      return { run: () => c.refresh() };
    },
    [],
  ],
  ['scrub-error-secrets', (s) => new ScrubErrorSecrets(s), []],
  ['sync-channel-slots', (s) => new SyncChannelSlots(s), []],
];

const runWith = async (
  make: (service: any) => { run: () => Promise<unknown> },
  argv: string[]
) => {
  const calls: Call[] = [];
  const saved = process.argv;
  process.argv = ['node', 'command.js', ...argv];
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    await make(fakeService(calls)).run();
  } catch {
    // Printing a fake report may throw; the service call is recorded by then.
  } finally {
    process.argv = saved;
    log.mockRestore();
    error.mockRestore();
  }
  return calls;
};

describe.each(commands)('%s', (_name, make, extra) => {
  it('changes nothing without --apply', async () => {
    const calls = await runWith(make, extra);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.args.includes(true))).toEqual([]);
  });

  it('passes apply to the service with --apply', async () => {
    const calls = await runWith(make, [...extra, '--apply']);
    expect(calls.some((c) => c.args.includes(true))).toBe(true);
  });
});
