// Importing the controller drags the integration manager in with it, and that
// pulls `nostr-tools`, which ships ESM that jest will not parse. Mocked here so
// the test can exercise the real controller rather than reading its source.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { AdminController } from '@gitroom/backend/api/routes/admin.controller';
import { HttpException } from '@nestjs/common';

/**
 * The six customer requests the panel could not answer are in
 * e2e/admin/05-gaps.md §1. Three of them are here: a refund, a cancellation
 * and an erasure. What these guard is the part that cannot be clicked into
 * existence on production — refusing an action that would otherwise be a
 * confident no-op, and naming the organization outright instead of inferring
 * it from whoever the session is wearing, which is the shape that made
 * E2E-09-09 possible.
 */
const admin = { id: 'admin-1', isSuperAdmin: true } as any;
const notAdmin = { id: 'user-1', isSuperAdmin: false } as any;

const build = (overrides: any = {}) => {
  const audit = { record: jest.fn() };
  const stripe = {
    getCharges: jest.fn(async () => []),
    refundCharges: jest.fn(async () => ({ refunded: ['ch_1'], failed: [] })),
    cancelSubscription: jest.fn(async () => ({ cancelled: true })),
    cancelAllSubscriptionsForDeletedAccount: jest.fn(async () => undefined),
    ...overrides.stripe,
  };
  const users = {
    getSoleOwnedOrganizations: jest.fn(async () => ['org-1']),
    deleteAccount: jest.fn(async () => ({ deleted: true })),
    deleteOrganization: jest.fn(async () => ({ mediaRemoved: 3 })),
    ...overrides.users,
  };
  const prisma = {
    organization: {
      findUnique: jest.fn(async () => ({
        id: 'org-1',
        name: 'Acme',
        paymentId: 'cus_123',
      })),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: 'user-9',
        email: 'client@example.com',
      })),
    },
    userOrganization: { count: jest.fn(async () => 2) },
    ...overrides.prisma,
  };

  const controller = new AdminController(
    {} as any,
    {} as any,
    prisma as any,
    {} as any,
    audit as any,
    {} as any,
    stripe as any,
    users as any,
    {
      getAllowedSocialsIntegrations: (): string[] => [],
      getSocialIntegration: (): null => null,
    } as any
  );

  return { controller, audit, stripe, users, prisma };
};

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : 500;
  }
};

const message = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof HttpException ? String(e.getResponse()) : null;
  }
};

describe('GET /admin/charges', () => {
  it('refuses a caller who is not an admin', async () => {
    const { controller } = build();
    await expect(
      status(() => controller.listCharges(notAdmin, 'org-1'))
    ).resolves.toBe(400);
  });

  it('refuses a missing organization id', async () => {
    const { controller } = build();
    await expect(status(() => controller.listCharges(admin, ''))).resolves.toBe(
      400
    );
  });

  it('refuses an organization that does not exist', async () => {
    const { controller } = build({
      prisma: { organization: { findUnique: jest.fn(async () => null) } },
    });
    await expect(
      status(() => controller.listCharges(admin, 'nope'))
    ).resolves.toBe(400);
  });

  it('says whether there is a Stripe customer at all', async () => {
    const { controller } = build({
      prisma: {
        organization: {
          findUnique: jest.fn(async () => ({
            id: 'org-1',
            name: 'Comped Co',
            paymentId: null,
          })),
        },
      },
    });

    await expect(controller.listCharges(admin, 'org-1')).resolves.toMatchObject(
      { hasStripeCustomer: false, organizationName: 'Comped Co' }
    );
  });
});

describe('POST /admin/refund-charges', () => {
  it('refuses an empty selection instead of reporting a refund of nothing', async () => {
    const { controller, stripe } = build();
    await expect(
      status(() => controller.refundCharges(admin, 'org-1', []))
    ).resolves.toBe(400);
    expect(stripe.refundCharges).not.toHaveBeenCalled();
  });

  it('refuses a charge id that is not a string', async () => {
    const { controller, stripe } = build();
    await expect(
      status(() => controller.refundCharges(admin, 'org-1', [null as any]))
    ).resolves.toBe(400);
    expect(stripe.refundCharges).not.toHaveBeenCalled();
  });

  it('explains itself when the organization never paid', async () => {
    const { controller } = build({
      prisma: {
        organization: {
          findUnique: jest.fn(async () => ({
            id: 'org-1',
            name: 'Comped Co',
            paymentId: null,
          })),
        },
      },
    });

    await expect(
      message(() => controller.refundCharges(admin, 'org-1', ['ch_1']))
    ).resolves.toContain('no Stripe customer');
  });

  it('records the refund against the organization', async () => {
    const { controller, audit } = build();

    await controller.refundCharges(admin, 'org-1', ['ch_1']);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.refund',
        userId: 'admin-1',
        organizationId: 'org-1',
      })
    );
  });
});

describe('POST /admin/cancel-subscription', () => {
  it('turns the service saying no into a 400 the operator can read', async () => {
    // cancelSubscription throws plain Errors for "no customer" and "no active
    // subscription"; both are answers, not crashes.
    const { controller } = build({
      stripe: {
        cancelSubscription: jest.fn(async () => {
          throw new Error('No active subscription found');
        }),
      },
    });

    await expect(
      status(() => controller.cancelSubscriptionForOrg(admin, 'org-1'))
    ).resolves.toBe(400);
    await expect(
      message(() => controller.cancelSubscriptionForOrg(admin, 'org-1'))
    ).resolves.toContain('No active subscription');
  });

  it('points a comped organization at revoke instead', async () => {
    const { controller, stripe } = build({
      prisma: {
        organization: {
          findUnique: jest.fn(async () => ({
            id: 'org-1',
            name: 'Comped Co',
            paymentId: null,
          })),
        },
      },
    });

    await expect(
      message(() => controller.cancelSubscriptionForOrg(admin, 'org-1'))
    ).resolves.toContain('Revoke subscription');
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
  });

  it('records the cancellation', async () => {
    const { controller, audit } = build();

    await controller.cancelSubscriptionForOrg(admin, 'org-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subscription.cancel',
        organizationId: 'org-1',
      })
    );
  });
});

describe('POST /admin/delete-user', () => {
  it('will not let an admin erase themselves from here', async () => {
    const { controller, users } = build();
    await expect(
      status(() => controller.deleteUser(admin, 'admin-1'))
    ).resolves.toBe(400);
    expect(users.deleteAccount).not.toHaveBeenCalled();
  });

  it('cancels Stripe before the rows that hold the customer id are gone', async () => {
    const order: string[] = [];
    const { controller } = build({
      stripe: {
        cancelAllSubscriptionsForDeletedAccount: jest.fn(async () => {
          order.push('stripe');
        }),
      },
      users: {
        getSoleOwnedOrganizations: jest.fn(async () => ['org-1']),
        deleteAccount: jest.fn(async () => {
          order.push('delete');
          return { deleted: true };
        }),
      },
    });

    await controller.deleteUser(admin, 'user-9');

    expect(order).toEqual(['stripe', 'delete']);
  });

  it('writes the address down before it stops resolving', async () => {
    const order: string[] = [];
    const { controller, audit } = build({
      users: {
        deleteAccount: jest.fn(async () => {
          order.push('delete');
          return { deleted: true };
        }),
      },
    });
    audit.record.mockImplementation(() => {
      order.push('audit');
    });

    await controller.deleteUser(admin, 'user-9');

    expect(order).toEqual(['audit', 'delete']);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.delete-user',
        metadata: expect.objectContaining({ email: 'client@example.com' }),
      })
    );
  });

  it('refuses a user who is not there', async () => {
    const { controller } = build({
      prisma: { user: { findUnique: jest.fn(async () => null) } },
    });
    await expect(
      status(() => controller.deleteUser(admin, 'ghost'))
    ).resolves.toBe(400);
  });
});

describe('POST /admin/delete-organization', () => {
  it('cancels billing, records it, and reports the files removed', async () => {
    const { controller, audit, stripe } = build();

    await expect(
      controller.deleteOrganization(admin, 'org-1')
    ).resolves.toMatchObject({ deleted: true, mediaRemoved: 3 });

    expect(
      stripe.cancelAllSubscriptionsForDeletedAccount
    ).toHaveBeenCalledWith('org-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.delete-organization' })
    );
  });

  it('refuses a caller who is not an admin', async () => {
    const { controller, users } = build();
    await expect(
      status(() => controller.deleteOrganization(notAdmin, 'org-1'))
    ).resolves.toBe(400);
    expect(users.deleteOrganization).not.toHaveBeenCalled();
  });
});
