import { HttpException, Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { Organization, Role } from '@prisma/client';

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>,
    private readonly _prismaTransaction: PrismaTransaction,
    private readonly _pendingGrant: PrismaRepository<'pendingGrant'>
  ) {}

  getUserAccount(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        account: true,
        connectedAccount: true,
      },
    });
  }

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  // One-off grandfathering support: every org with its current subscription
  // state and its count of live integrations (so we never grant fewer channels
  // than an account already uses).
  getAllOrganizationsForGrandfather() {
    return this._organization.model.organization.findMany({
      select: {
        id: true,
        name: true,
        subscription: {
          select: {
            subscriptionTier: true,
            isLifetime: true,
            deletedAt: true,
          },
        },
        Integration: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });
  }

  // Targeted comp: the org(s) OWNED (SUPERADMIN) by a given email, same shape as
  // the grandfather query above. Used to grant a lifetime plan to a tester /
  // influencer account by email. Case-insensitive on the email.
  getOwnedOrganizationsByEmail(email: string) {
    return this._organization.model.organization.findMany({
      where: {
        users: {
          some: {
            role: Role.SUPERADMIN,
            user: { email: { equals: email, mode: 'insensitive' } },
          },
        },
      },
      select: {
        id: true,
        name: true,
        subscription: {
          select: {
            subscriptionTier: true,
            isLifetime: true,
            deletedAt: true,
          },
        },
        Integration: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });
  }

  updateAccount(userId: string, account: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        account,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  updateConnectedStatus(account: string, accountCharges: boolean) {
    return this._user.model.user.updateMany({
      where: {
        account,
      },
      data: {
        connectedAccount: accountCharges,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  deleteSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  /**
   * Soft-delete an organization's subscription without going near Stripe.
   *
   * The only existing route out of a subscription is
   * POST /billing/cancel-subscription, which needs a resolvable Stripe customer
   * and a live subscription, and which bails on any lifetime row before it
   * deletes anything. A comped or granted account therefore could not be taken
   * back through the product at all.
   */
  // Comps whose end date has passed and that are still in force.
  listExpiredComps(now: Date) {
    return this._subscription.model.subscription.findMany({
      where: { deletedAt: null, isLifetime: false, compEndsAt: { lte: now } },
      select: {
        organizationId: true,
        subscriptionTier: true,
        compReason: true,
        compEndsAt: true,
        organization: { select: { name: true } },
      },
    });
  }

  // Every plan in force that nobody pays for: rows written by a comp, and
  // older comps from before the reason was kept (a non-lifetime plan on an
  // organization without a Stripe customer can only be one).
  listComps() {
    return this._subscription.model.subscription.findMany({
      where: {
        deletedAt: null,
        isLifetime: false,
        OR: [
          { compReason: { not: null } },
          { organization: { paymentId: null } },
          { organization: { NOT: { paymentId: { startsWith: 'cus_' } } } },
        ],
      },
      orderBy: [{ compEndsAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        organizationId: true,
        subscriptionTier: true,
        compReason: true,
        compEndsAt: true,
        createdAt: true,
        organization: { select: { name: true } },
      },
    });
  }

  findOpenPendingGrant(email: string) {
    return this._pendingGrant.model.pendingGrant.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOpenPendingGrants() {
    return this._pendingGrant.model.pendingGrant.findMany({
      where: { consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  listPendingGrants() {
    return this._pendingGrant.model.pendingGrant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  createPendingGrant(data: {
    email: string;
    tier: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
    months: number | null;
    reason: string;
    createdById: string;
  }) {
    return this._pendingGrant.model.pendingGrant.create({ data });
  }

  deleteOpenPendingGrantsByEmail(email: string) {
    return this._pendingGrant.model.pendingGrant.deleteMany({
      where: { email, consumedAt: null },
    });
  }

  async userExistsByEmail(email: string) {
    return !!(await this._user.model.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    }));
  }

  deleteOpenPendingGrant(id: string) {
    return this._pendingGrant.model.pendingGrant.deleteMany({
      where: { id, consumedAt: null },
    });
  }

  // Claims the grant for one organization: of two sign-ups racing on the same
  // address, only the first gets it.
  async consumePendingGrant(id: string, organizationId: string) {
    const { count } = await this._pendingGrant.model.pendingGrant.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date(), organizationId },
    });
    return count === 1;
  }

  // Only while it is still an ended comp: a write in between (an extension,
  // a Stripe plan, a lifetime grant) moves or clears compEndsAt.
  async softDeleteExpiredComp(orgId: string, now: Date) {
    const { count } = await this._subscription.model.subscription.updateMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isLifetime: false,
        compEndsAt: { lte: now },
      },
      data: { deletedAt: new Date() },
    });
    return { revoked: count > 0 };
  }

  async releasePendingGrant(id: string, organizationId: string) {
    await this._pendingGrant.model.pendingGrant.updateMany({
      where: { id, organizationId },
      data: { consumedAt: null, organizationId: null },
    });
  }

  async softDeleteSubscriptionByOrg(orgId: string) {
    const { count } = await this._subscription.model.subscription.updateMany({
      where: { organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { revoked: count > 0 };
  }

  // Writes the customer only over the one the caller saw, so of two
  // checkouts racing to create the first customer only one is stored.
  async assignCustomerId(
    organizationId: string,
    expected: string | null,
    customerId: string
  ) {
    const { count } = await this._organization.model.organization.updateMany({
      where: { id: organizationId, paymentId: expected },
      data: { paymentId: customerId },
    });
    return count === 1;
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  listActiveNonLifetime() {
    return this._subscription.model.subscription.findMany({
      where: { deletedAt: null, isLifetime: false },
      select: {
        id: true,
        subscriptionTier: true,
        totalChannels: true,
        organization: { select: { id: true, name: true } },
      },
    });
  }

  updateTotalChannels(id: string, totalChannels: number) {
    return this._subscription.model.subscription.update({
      where: { id },
      data: { totalChannels },
    });
  }

  setCancelAt(organizationId: string, cancelAt: Date | null) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { cancelAt },
    });
  }

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        deletedAt: null,
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getPaymentId(orgId: string) {
    const org = await this._organization.model.organization.findUnique({
      where: { id: orgId },
      select: { paymentId: true },
    });
    return org?.paymentId ?? null;
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: { id: string },
    periodAnchor?: Date,
    // Set only by an admin comp. Every other write (a Stripe webhook, a
    // lifetime grant) clears it: a plan the customer now pays for must not be
    // taken back on a comp's end date.
    comp?: { reason: string; endsAt: Date | null }
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId))!;

    if (!findOrg) {
      return;
    }

    const writes: any[] = [];
    writes.push(
      this._subscription.model.subscription.upsert({
      where: {
        organizationId: findOrg.id,
        // Narrowing by paymentId is the guard that a Stripe webhook is writing
        // to the org that customer really owns. When the caller named the org
        // outright — an admin comp, a lifetime grant — there is no customer to
        // match, and demanding one is what pushed `addSubscription` into
        // overwriting paymentId to make its own upsert fit.
        ...(!code && !org
          ? {
              organization: {
                paymentId: customerId,
              },
            }
          : {}),
      },
      update: {
        subscriptionTier: billing,
        totalChannels,
        period,
        identifier,
        isLifetime: !!code,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        ...(periodAnchor ? { periodAnchor } : {}),
        compReason: comp?.reason ?? null,
        compEndsAt: comp?.endsAt ?? null,
        deletedAt: null,
      },
      create: {
        organizationId: findOrg.id,
        subscriptionTier: billing,
        isLifetime: !!code,
        totalChannels,
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        identifier,
        ...(periodAnchor ? { periodAnchor } : {}),
        compReason: comp?.reason ?? null,
        compEndsAt: comp?.endsAt ?? null,
        deletedAt: null,
      },
      })
    );

    writes.push(
      this._organization.model.organization.update({
        where: {
          id: findOrg.id,
        },
        data: {
          isTrailing,
          allowTrial: false,
        },
      })
    );

    if (code) {
      writes.push(
        // A lifetime grant's `grandfather-<org>` is only a marker, one per
        // organisation, and comes back when lifetime is granted again after a
        // revoke: created twice it broke the unique code and the grant (500).
        // A real code stays create-only, so it still cannot be used twice.
        code.startsWith('grandfather-')
          ? this._usedCodes.model.usedCodes.upsert({
              where: { code },
              create: { code, orgId: findOrg.id },
              update: {},
            })
          : this._usedCodes.model.usedCodes.create({
              data: {
                code,
                orgId: findOrg.id,
              },
            })
      );
    }

    // A Stripe webhook write must be all-or-nothing: a crash between the
    // subscription upsert and the org update left paying orgs marked trialing.
    await this._prismaTransaction.model.$transaction(writes);
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  deleteCreditsFrom(organizationId: string, from: dayjs.Dayjs, type: string) {
    return this._credits.model.credits.deleteMany({
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'ai_images'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
      _sum: {
        credits: true,
      },
    });

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'ai_images',
    // Gets the reserved credit row, so work that outlives this call (an AI
    // video finished by another process after a restart) can hand it back.
    func: (reservation: { id: string }) => Promise<T>,
    enforce?: { limit: number; cycleStart: Date }
  ) {
    // Reserve-then-verify: check-then-insert (checkCredits -> useCredit as two
    // awaits) lets N parallel requests at limit-1 all pass. Inserting the
    // usage row and counting inside one transaction makes the loser roll back.
    const data = enforce
      ? await this._prismaTransaction.model.$transaction(async (tx) => {
          // Serialize credit reservations for this org: READ COMMITTED alone
          // lets two concurrent txns each miss the other's uncommitted usage
          // row and both pass the limit check (overspend by up to N-1). The
          // advisory xact lock (auto-released on commit/rollback) makes the
          // loser wait, then see the winner's committed row in the aggregate.
          // The ::text cast is load-bearing: pg_advisory_xact_lock returns
          // void, which Prisma's $queryRaw cannot deserialize (P2010 on every
          // call — took prod AI down on 2026-07-08).
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:${org.id}`})::bigint)::text`;
          const row = await tx.credits.create({
            data: {
              organizationId: org.id,
              credits: 1,
              type,
            },
          });
          const used = await tx.credits.aggregate({
            _sum: { credits: true },
            where: {
              organizationId: org.id,
              type,
              createdAt: { gte: enforce.cycleStart },
            },
          });
          if ((used._sum.credits ?? 0) > enforce.limit) {
            throw new HttpException(
              'No generation credits remaining for this billing cycle',
              402
            );
          }
          return row;
        })
      : await this._credits.model.credits.create({
          data: {
            organizationId: org.id,
            credits: 1,
            type,
          },
        });

    try {
      return await func({ id: data.id });
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

  /** Hands back one reserved credit (by its row), when the work it paid for
   *  failed after the call that reserved it was gone. */
  async refundCredit(id: string) {
    await this._credits.model.credits.deleteMany({ where: { id } });
  }
}
