const listSubscriptions = jest.fn();
const listCharges = jest.fn();
const retrieveCustomer = jest.fn();
const createCustomer = jest.fn();
const deleteCustomer = jest.fn().mockResolvedValue({ deleted: true });
const updateCustomer = jest.fn().mockResolvedValue({});

jest.mock('stripe', () => {
  // Keep the real `errors` namespace on the mock: the rejections below have to
  // be built by the SDK, or they carry a shape production never produces.
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { list: listSubscriptions },
    charges: { list: listCharges },
    customers: {
      retrieve: retrieveCustomer,
      create: createCustomer,
      update: updateCustomer,
      del: deleteCustomer,
    },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
});

// The services below are only ever injected here, but importing them for real
// drags in integration.manager → nostr-tools, which is ESM and stops jest dead.
// Stubbing the modules keeps this a unit test of StripeService.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));

import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// A new Stripe customer is made in the name of the organisation's owner:
// invoices and receipts go to that address. It took the first member the
// team query returned, in no set order, so a member or an admin could get
// the owner's invoices; with ownership now handed over in Settings, the
// first member is often the former owner (E2E-11-85).

const team = (users: Array<{ role: string; email: string; disabled?: boolean }>) => ({
  users: users.map((u) => ({ role: u.role, disabled: !!u.disabled, user: { email: u.email } })),
});

const build = (users: Parameters<typeof team>[0], paymentId: string | null = null) => {
  const subscriptionService = {
    assignCustomerId: jest.fn().mockResolvedValue(true),
  };
  const organizationService = {
    getTeam: jest.fn().mockResolvedValue(team(users)),
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId }),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any,
    {} as any
  );
  return service;
};

const org = { id: 'org-1', paymentId: null, name: 'Acme' } as any;

beforeEach(() => {
  jest.clearAllMocks();
  createCustomer.mockResolvedValue({ id: 'cus_new' });
});

describe('a new Stripe customer', () => {
  it("takes the owner's email, not the first member's", async () => {
    const service = build([
      { role: 'USER', email: 'member@example.com' },
      { role: 'ADMIN', email: 'former-owner@example.com' },
      { role: 'SUPERADMIN', email: 'owner@example.com' },
    ]);
    await expect(service.createOrGetCustomer(org)).resolves.toBe('cus_new');
    expect(createCustomer.mock.calls[0][0].email).toBe('owner@example.com');
  });

  it('falls back to the first member when no active owner is listed', async () => {
    const service = build([
      { role: 'ADMIN', email: 'admin@example.com' },
      { role: 'SUPERADMIN', email: 'off@example.com', disabled: true },
    ]);
    await service.createOrGetCustomer(org);
    expect(createCustomer.mock.calls[0][0].email).toBe('admin@example.com');
  });
});

// Decision K. 2 XI: after Make owner, invoices go to the new owner.
describe('handing the organisation over', () => {
  it("moves the Stripe customer's email to the new owner", async () => {
    const service = build(
      [
        { role: 'ADMIN', email: 'former-owner@example.com' },
        { role: 'SUPERADMIN', email: 'new-owner@example.com' },
      ],
      'cus_live'
    );
    await service.followNewOwner('org-1');
    expect(updateCustomer).toHaveBeenCalledWith('cus_live', {
      email: 'new-owner@example.com',
    });
  });

  it('leaves Stripe alone without a customer, and never throws', async () => {
    const none = build([{ role: 'SUPERADMIN', email: 'o@example.com' }], null);
    await none.followNewOwner('org-1');
    expect(updateCustomer).not.toHaveBeenCalled();

    updateCustomer.mockRejectedValueOnce(new Error('Stripe is down'));
    const down = build([{ role: 'SUPERADMIN', email: 'o@example.com' }], 'cus_live');
    await expect(down.followNewOwner('org-1')).resolves.toBeUndefined();
  });
});
