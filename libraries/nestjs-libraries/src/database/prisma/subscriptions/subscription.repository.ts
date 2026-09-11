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
    private readonly _prismaTransaction: PrismaTransaction
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
   * back through the product at all (E2E-09-41).
   */
  async softDeleteSubscriptionByOrg(orgId: string) {
    const { count } = await this._subscription.model.subscription.updateMany({
      where: { organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { revoked: count > 0 };
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
    org?: { id: string }
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
        // overwriting paymentId to make its own upsert fit (E2E-09-09).
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
        this._usedCodes.model.usedCodes.create({
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
    func: () => Promise<T>,
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
      return await func();
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

}
