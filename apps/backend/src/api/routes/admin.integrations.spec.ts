// Importing the controller drags the integration manager in with it, and that
// pulls `nostr-tools`, which ships ESM jest will not parse.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { AdminController } from '@gitroom/backend/api/routes/admin.controller';
import { HttpException } from '@nestjs/common';

/**
 * The sixth customer request: "my channel keeps disconnecting" (05-gaps §1e).
 *
 * Two things here cannot be clicked into existence on production. One is that
 * the response carries no credential — the table this feature reads is the
 * same table whose tokens leaked into `Errors` (E2E-09-01), so the absence is
 * asserted on the serialised body rather than trusted to a select list
 * somebody may extend later. The other is that the header counts the whole
 * filtered set: production has twelve channels and one page, so a summary
 * built from the page would look correct here forever.
 */

const admin = { id: 'admin-1', isSuperAdmin: true } as any;
const notAdmin = { id: 'user-1', isSuperAdmin: false } as any;

const NOW = Date.now();
const hours = (n: number) => new Date(NOW + n * 3600 * 1000);

const row = (overrides: any = {}) => ({
  id: 'int-1',
  internalId: '17841400000000000',
  name: 'Acme on Instagram',
  picture: null,
  providerIdentifier: 'instagram',
  profile: 'acme',
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
  tokenExpiration: hours(2),
  grantedScopes: JSON.stringify(['instagram_basic']),
  createdAt: hours(-1000),
  updatedAt: hours(-1),
  deletedAt: null,
  customer: null,
  organization: { id: 'org-1', name: 'Acme' },
  ...overrides,
});

const build = (rows: any[] = [row()], counts: number[] = [], errorRows: any[] = []) => {
  let countCall = 0;
  const integration = {
    findMany: jest.fn(async (_args?: any) => rows),
    // First call is the list total; the rest are the summary's per-state
    // counts, in CHANNEL_STATES order, then expired-and-unwatched.
    count: jest.fn(async (_args?: any) => counts[countCall++] ?? rows.length),
    groupBy: jest.fn(async () => [
      { providerIdentifier: 'instagram', _count: { _all: 2 } },
      { providerIdentifier: 'threads', _count: { _all: 1 } },
    ]),
  };

  const manager = {
    getAllowedSocialsIntegrations: () => ['instagram', 'threads', 'youtube'],
    getSocialIntegration: (id: string) =>
      ({
        instagram: { comment: true, commentScope: 'instagram_manage_comments' },
        threads: { comment: false, refreshCron: true },
        youtube: { comment: true },
      }[id] ?? null),
  };

  const queryRaw = jest.fn(async (..._args: any[]) => errorRows);

  const controller = new AdminController(
    {} as any,
    {} as any,
    { integration, $queryRaw: queryRaw } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    manager as any
  );

  return { controller, integration, queryRaw };
};

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : 500;
  }
};

describe('GET /admin/integrations', () => {
  it('is closed to anyone who is not a superadmin', async () => {
    const { controller } = build();
    expect(await status(() => controller.listIntegrations(notAdmin))).toBe(400);
    expect(
      await status(() => controller.listIntegrationProviders(notAdmin))
    ).toBe(400);
  });

  it('never hands back a token, in the body or anywhere under it', async () => {
    // The assertion is on the serialised response on purpose. A select list is
    // easy to extend by accident; this fails whatever route the value took.
    const { controller } = build();
    const result: any = await controller.listIntegrations(admin);
    const body = JSON.stringify(result);

    expect(body).not.toMatch(/"token"/);
    expect(body).not.toMatch(/refreshToken/);
    expect(body).not.toContain('enc::');
    expect(Object.keys(result.items[0])).not.toContain('token');
  });

  it('does not ask the database for the token either', async () => {
    const { controller, integration } = build();
    await controller.listIntegrations(admin);
    const select = integration.findMany.mock.calls[0][0].select;
    expect(select.token).toBeUndefined();
    expect(select.refreshToken).toBeUndefined();
  });

  it('says which state each channel is in, and whether to act on it', async () => {
    const { controller } = build([
      row({ id: 'a', tokenExpiration: hours(1) }),
      row({ id: 'b', refreshNeeded: true }),
      row({ id: 'c', providerIdentifier: 'threads', tokenExpiration: hours(-5) }),
      row({ id: 'd', providerIdentifier: 'youtube', tokenExpiration: hours(-5) }),
    ]);
    const result: any = await controller.listIntegrations(admin);
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));

    expect(byId.a.state).toBe('expiring');
    expect(byId.a.actionable).toBe(false);
    expect(byId.b.state).toBe('needs-reconnect');
    expect(byId.b.actionable).toBe(true);
    // Threads has refreshCron, so a workflow is watching this one.
    expect(byId.c.state).toBe('expired');
    expect(byId.c.scheduled).toBe(true);
    expect(byId.c.actionable).toBe(false);
    // YouTube has none — this is the combination worth a phone call.
    expect(byId.d.scheduled).toBe(false);
    expect(byId.d.actionable).toBe(true);
  });

  it('renders a missing expiry as no expiry rather than as unknown', async () => {
    const { controller } = build([row({ tokenExpiration: null })]);
    const result: any = await controller.listIntegrations(admin);
    expect(result.items[0].state).toBe('ok');
    expect(result.items[0].expiresInSeconds).toBeNull();
  });

  it('keeps "never recorded" apart from "granted nothing"', async () => {
    // null is a channel connected before the column existed, and a reconnect
    // would fix it. An empty array is a platform that granted nothing, and a
    // reconnect would not.
    const { controller } = build([
      row({ id: 'old', grantedScopes: null }),
      row({ id: 'none', grantedScopes: '[]' }),
    ]);
    const result: any = await controller.listIntegrations(admin);
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));

    expect(byId.old.grantedScopes).toBeNull();
    expect(byId.none.grantedScopes).toEqual([]);
    expect(byId.old.commentCapable).toBe(false);
    expect(byId.none.commentCapable).toBe(false);
  });

  it('reports first-comment capability per channel, not per provider', async () => {
    const { controller } = build([
      row({
        id: 'can',
        grantedScopes: JSON.stringify(['instagram_manage_comments']),
      }),
      row({ id: 'cannot', grantedScopes: JSON.stringify(['instagram_basic']) }),
    ]);
    const result: any = await controller.listIntegrations(admin);
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));

    expect(byId.can.commentCapable).toBe(true);
    expect(byId.cannot.commentCapable).toBe(false);
  });

  it('counts the whole filtered set, not the page', async () => {
    // One row comes back, and the counts say there are far more behind it.
    const counts = [40, 3, 1, 2, 4, 9, 21, 0, 2];
    const { controller, integration } = build([row()], counts);
    const result: any = await controller.listIntegrations(admin, '0', '1');

    expect(result.total).toBe(40);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.summary['needs-reconnect']).toBe(3);
    // needs-reconnect + setup-incomplete + expired-and-unwatched.
    expect(result.summary.actionable).toBe(3 + 1 + 2);
    // Every count is its own query against the same base filter.
    expect(integration.count).toHaveBeenCalledTimes(counts.length);
  });

  it('refuses a state it does not know instead of returning everything', async () => {
    const { controller } = build();
    expect(
      await status(() => controller.listIntegrations(admin, '0', '25', '', '', 'broken'))
    ).toBe(400);
  });

  it('shows deleted channels when the filter asks for them by name', async () => {
    // Found by running it: picking "Deleted" answered with an empty table,
    // because the visibility rule and the state filter contradicted each
    // other and only the separate checkbox could reconcile them.
    const { controller, integration } = build();
    await controller.listIntegrations(admin, '0', '25', '', '', 'deleted');
    expect(
      integration.findMany.mock.calls[0][0].where.AND[0].deletedAt
    ).toBeUndefined();
  });

  it('counts the deleted ones truthfully beside the filter', async () => {
    // The count sits next to the option. Leaving the visibility rule in would
    // print "Deleted (0)" over a table that does have deleted channels.
    const { controller, integration } = build();
    await controller.listIntegrations(admin);

    const deletedCount = integration.count.mock.calls.find(
      (call: any) => call[0].where.AND[1]?.deletedAt?.not === null
    );
    expect(deletedCount[0].where.AND[0].deletedAt).toBeUndefined();
  });

  it('hides deleted channels unless asked for them', async () => {
    const { controller, integration } = build();
    await controller.listIntegrations(admin);
    expect(integration.findMany.mock.calls[0][0].where.AND[0].deletedAt).toBeNull();

    await controller.listIntegrations(
      admin, '0', '25', '', '', '', '', 'true'
    );
    expect(
      integration.findMany.mock.calls[1][0].where.AND[0].deletedAt
    ).toBeUndefined();
  });

  it('puts the state filter beside the base filter instead of over it', async () => {
    // Both carry `deletedAt`, and both can carry `OR` — spreading them into one
    // object would drop whichever came first and quietly widen the query.
    const { controller, integration } = build();
    await controller.listIntegrations(
      admin, '0', '25', 'org-1', '', 'needs-reconnect', 'acme'
    );
    const where = integration.findMany.mock.calls[0][0].where;

    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].organizationId).toBe('org-1');
    expect(where.AND[0].OR).toHaveLength(2);
    expect(where.AND[1].refreshNeeded).toBe(true);
  });
});

describe('the failure history beside each channel', () => {
  it('counts failures for this channel, not for every channel on the provider', async () => {
    // Errors carries the provider name and the organization, not the channel,
    // so counting from that side makes one bad channel look like five.
    const { controller } = build(
      [row({ id: 'noisy' }), row({ id: 'quiet' })],
      [],
      [
        {
          integrationId: 'noisy',
          message: 'The session has been invalidated',
          at: hours(-3),
          count: BigInt(14),
        },
      ]
    );
    const result: any = await controller.listIntegrations(admin);
    const byId = Object.fromEntries(result.items.map((i: any) => [i.id, i]));

    expect(byId.noisy.recentErrors).toBe(14);
    expect(byId.noisy.lastError.message).toContain('invalidated');
    expect(byId.quiet.recentErrors).toBe(0);
    expect(byId.quiet.lastError).toBeNull();
  });

  it('redacts the message, because refreshed tokens have reached that column', async () => {
    const { controller } = build(
      [row({ id: 'leaky' })],
      [],
      [
        {
          integrationId: 'leaky',
          message: '{"error":"bad","token":"EAAG-real-secret"}',
          at: hours(-1),
          count: BigInt(1),
        },
      ]
    );
    const result: any = await controller.listIntegrations(admin);
    expect(result.items[0].lastError.message).not.toContain('EAAG-real-secret');
  });

  it('asks for the history once for the whole page, not once per channel', async () => {
    const { controller, queryRaw } = build([
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c' }),
    ]);
    await controller.listIntegrations(admin);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not query at all when the page is empty', async () => {
    // Prisma.join on an empty list produces `IN ()`, which is a syntax error.
    const { controller, queryRaw } = build([]);
    const result: any = await controller.listIntegrations(admin);
    expect(result.items).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('GET /admin/integrations/providers', () => {
  it('lists what is connected, and which of them a workflow watches', async () => {
    const { controller } = build();
    const result: any = await controller.listIntegrationProviders(admin);

    expect(result).toEqual([
      { provider: 'instagram', channels: 2, scheduled: false },
      { provider: 'threads', channels: 1, scheduled: true },
    ]);
  });
});
