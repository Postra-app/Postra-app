import { Throttle } from '@nestjs/throttler';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  channelLimitFor,
  channelsInUse,
  pricing,
  trialAiAllowance,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AppleIapService } from '@gitroom/nestjs-libraries/services/apple/apple.iap.service';
import {
  appleIapEnabled,
  appleOffered,
  appleOfferSigner,
  applePlans,
} from '@gitroom/nestjs-libraries/services/apple/apple.iap';
import { BillingAppleTransactionDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.apple.transaction.dto';
import { BillingAppleOfferDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.apple.offer.dto';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { BillingAddSubscriptionDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.add.subscription.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { bustAuthContextCache } from '@gitroom/backend/services/auth/auth.middleware';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { escapeHtml } from '@gitroom/helpers/utils/escape.html';

dayjs.extend(utc);

// Billing mutations change what the org's card is charged — restrict to org
// admins/owner (ADMIN section = ADMIN/SUPERADMIN role). A regular invited
// member must not be able to change the tier, cancel, or redeem codes.
const BILLING_ADMIN = [AuthorizationActions.Create, Sections.ADMIN] as [
  AuthorizationActions,
  Sections
];

// A plan Apple bills cannot also be bought through Stripe: the organisation
// would pay twice and the two would overwrite each other's plan.
const refuseAppleBilled = (org: Organization) => {
  // @ts-ignore the request's organisation is loaded with its subscription
  if (org?.subscription?.appleOriginalTransactionId) {
    throw new HttpException(
      'This account subscribes through the App Store. Manage the plan in your Apple ID settings.',
      409
    );
  }
};

@ApiTags('Billing')
@Controller('/billing')
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService,
    private _auditService: AuditService,
    private _appleIapService: AppleIapService,
    private _postsService: PostsService,
    private _integrationService: IntegrationService
  ) {}

  @Get('/check/:id')
  @Throttle({ default: { ttl: 300_000, limit: 300 } })
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') body: string
  ) {
    const status = await this._stripeService.checkSubscription(org.id, body);
    // The frontend re-fetches /user/self exactly once when this turns 2 — that
    // request must not be served the pre-payment FREE context from the 30s
    // auth cache (the webhook busts it too, but this poll can win that race).
    // A refused repeat trial (3, 4) ended the trial offer: same reason.
    if (status >= 2) {
      await bustAuthContextCache(user.id);
    }
    return { status };
  }

  @Get('/check-discount')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await this._stripeService.checkDiscount(org.paymentId))
        ? false
        : AuthService.signJWT({ discount: true }),
    };
  }

  @Post('/apply-discount')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    await this._stripeService.applyDiscount(org.paymentId);
  }

  @Get('/finish-trial/preview')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async finishTrialPreview(@GetOrgFromRequest() org: Organization) {
    if (!org.paymentId) {
      return null;
    }
    try {
      return await this._stripeService.finishTrialPreview(org.paymentId);
    } catch (err) {
      Logger.error(
        `finish-trial preview failed for org ${org.id}: ${(err as Error)?.message}`,
        'Billing'
      );
      return null;
    }
  }

  @Post('/finish-trial')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async finishTrial(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    if (!org.paymentId) {
      return { finish: false, reason: 'no-trial' };
    }
    try {
      const result = await this._stripeService.finishTrial(org.paymentId);
      // It charges the card: who ended the trial and when could not be told
      // afterwards.
      this._auditService.record({
        action: 'billing.finish-trial',
        organizationId: org.id,
        userId: user?.id,
        metadata: { finish: result.finish, reason: result.reason },
      });
      return result;
    } catch (err) {
      Logger.error(
        `finish-trial failed for org ${org.id}: ${(err as Error)?.message}`,
        'Billing'
      );
      return { finish: false, reason: 'error' };
    }
  }

  // The trial bar: days left, whether a card keeps the plan, and how much of
  // the trial is used. Numbers from the same rules the limits use.
  @Get('/trial')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async trial(@GetOrgFromRequest() org: Organization) {
    if (!org.isTrailing || !org.paymentId) {
      return { trial: false };
    }
    const status = await this._stripeService.trialStatus(org.paymentId);
    if (!status) {
      return { trial: false };
    }
    const cap = await this._subscriptionService.postCap(org.id, org.createdAt);
    const [posts, channels, images] = await Promise.all([
      cap ? this._postsService.countedPostsNow(org.id, cap.anchor) : 0,
      this._integrationService.getIntegrationsList(org.id),
      this._subscriptionService.checkCredits(org, 'ai_images'),
    ]);
    const tier =
      // @ts-ignore the request's organisation is loaded with its subscription
      org.subscription?.subscriptionTier || 'STANDARD';
    return {
      trial: true,
      endsAt: status.endsAt,
      hasCard: status.hasCard,
      channels: {
        used: channelsInUse(channels),
        // @ts-ignore the request's organisation is loaded with its subscription
        limit: channelLimitFor(org),
      },
      posts: { used: posts, limit: cap?.limit ?? 0 },
      images: {
        used: Math.max(
          0,
          trialAiAllowance(
            pricing[tier]?.image_generation_count || 0,
            true,
            'image_generation_count'
          ) - (images?.credits ?? 0)
        ),
        limit: trialAiAllowance(
          pricing[tier]?.image_generation_count || 0,
          true,
          'image_generation_count'
        ),
      },
    };
  }

  @Get('/is-trial-finished')
  async isTrialFinished(@GetOrgFromRequest() org: Organization) {
    return {
      finished: !org.isTrailing,
    };
  }

  @Post('/embedded')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    refuseAppleBilled(org);
    const uniqueId = req?.cookies?.track;
    return this._stripeService.embedded(uniqueId, org.id, user.id, body);
  }

  // The free trial starts without a card: one click on the plan screen. The
  // page then waits on /billing/check/<id>, as after a checkout.
  @Post('/start-trial')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  startTrial(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    refuseAppleBilled(org);
    const uniqueId = req?.cookies?.track;
    return this._stripeService.startTrial(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Post('/subscribe')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    refuseAppleBilled(org);
    const uniqueId = req?.cookies?.track;
    return this._stripeService.subscribe(uniqueId, org.id, user.id, body);
  }

  // Billing history on the Billing page (upstream 3bd88cee9).
  @Get('/invoices')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  getInvoices(@GetOrgFromRequest() org: Organization) {
    return this._stripeService.getInvoices(org.id);
  }

  @Get('/portal')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async modifyPayment(
    @GetOrgFromRequest() org: Organization,
    @Query('flow') flow?: string
  ) {
    const customer = await this._stripeService.getCustomerByOrganizationId(
      org.id
    );
    if (!customer) {
      throw new BadRequestException('This organization has no billing account yet.');
    }
    // `?flow=card`: straight to adding a card (a trial without one);
    // `card-now` then back to ending the trial.
    const { url } = await this._stripeService.createBillingPortalLink(
      customer,
      flow === 'card' || flow === 'card-now' ? flow : undefined
    );
    return {
      portal: url,
    };
  }

  // The plans the iOS app may sell, by App Store product id. The app asks
  // the store for the price and shows these only to an organisation that has
  // no plan.
  @Get('/apple/plans')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async applePlans(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    if (!appleIapEnabled()) {
      throw new HttpException('Not found', 404);
    }
    const trial = await this.appleTrialAllowed(org, user);
    return { plans: applePlans(), trial };
  }

  // Asked by the app just before Apple's purchase sheet opens. For an
  // organisation that has had its trial: Apple's free week is switched off
  // for this purchase by a statement the server signs (StoreKit's
  // introductoryOfferEligibility), and Apple charges the full price from the
  // first day. Otherwise null, and Apple decides by Apple ID as usual.
  @Post('/apple/offer')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 20 } })
  async appleOffer(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingAppleOfferDto
  ) {
    if (!appleIapEnabled()) {
      throw new HttpException('Not found', 404);
    }
    if (!appleOffered(body.productId)) {
      throw new HttpException('This plan is not available right now.', 400);
    }
    if (await this.appleTrialAllowed(org, user)) {
      return { eligibility: null };
    }
    const signer = appleOfferSigner();
    if (!signer) {
      throw new HttpException('This plan is not available right now.', 503);
    }
    return {
      eligibility: signer.createSignature(
        body.productId,
        false,
        body.appTransactionId
      ),
    };
  }

  // One trial, wherever it is taken. The offer the web's plan page reads
  // (the organisation's, and not for an email that already had a trial)
  // decides whether the app shows the free week and whether Apple's free
  // week is switched off for the purchase, and whether a free week bought in
  // the app is accepted. A plan bought in the app ends the offer in turn.
  private async appleTrialAllowed(org: Organization, user: User) {
    return (
      !!org.allowTrial &&
      // @ts-ignore the request's organisation is loaded with its subscription
      !org.subscription &&
      !!(await this._stripeService.trialOffered(
        org.id,
        org.paymentId,
        user.email,
        true
      ))
    );
  }

  // The app's purchase (or "restore purchases"): the transaction as StoreKit
  // signed it, for the organisation that is signed in.
  @Post('/apple/transaction')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 20 } })
  async appleTransaction(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingAppleTransactionDto
  ) {
    if (!appleIapEnabled()) {
      throw new HttpException('Not found', 404);
    }
    return this._appleIapService.attach(org.id, body.signedTransaction, {
      trialAllowed: await this.appleTrialAllowed(org, user),
    });
  }

  // A lower plan waiting for the next billing period.
  // Two Stripe reads per call, on every visit to Billing.
  @Get('/pending-change')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  pendingChange(@GetOrgFromRequest() org: Organization) {
    return this._stripeService.pendingChange(org.id);
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._subscriptionService.getSubscriptionByOrganizationId(org.id);
  }

  @Post('/cancel')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: { feedback: string; cancel?: boolean }
  ) {
    const result = await this._stripeService.setToCancel(
      org.id,
      typeof body?.cancel === 'boolean' ? body.cancel : undefined
    );

    // cancel_at is only set on a cancellation, not when the user
    // re-activates; a request that changed nothing (already cancelled) sends
    // no second mail. Emails are best-effort: the cancellation itself must
    // not 500 on an SES hiccup.
    if (result?.cancel_at && !(result as { unchanged?: boolean }).unchanged) {
      // Written confirmation for the customer (chargeback evidence + the
      // upcoming UK DMCCA cancellation-confirmation requirement). Sent
      // first and on its own: a failed operator mail skipped it. A failed
      // payment ends the plan at once (`immediate`), and "You keep full
      // access until <today>" was wrong; the date is the server's, in UTC.
      try {
        await this._notificationService.sendEmail(
          user.email,
          'Your Postra subscription is cancelled',
          (result as { immediate?: boolean }).immediate
            ? 'Your subscription has been cancelled and you will not be charged again. As the last payment did not go through, your plan ended today. You can choose a plan again any time from Billing.'
            : `Your subscription has been cancelled and you will not be charged again. You keep full access until ${dayjs
                .utc(result.cancel_at)
                .format(
                  'D MMMM YYYY'
                )} (UTC). Changed your mind? You can re-activate any time from Billing.`
        );
      } catch (e) {
        /* the subscription is cancelled either way */
      }
      try {
        // Operator notification (cancellation feedback). Must go to a
        // monitored inbox — EMAIL_FROM_ADDRESS (no-reply@) has no mailbox and
        // sits on the SES suppression list, so mail to it silently bounces.
        await this._notificationService.sendEmail(
          process.env.EMAIL_ADMIN_ADDRESS || process.env.EMAIL_FROM_ADDRESS,
          'Subscription Cancelled',
          // Both are the customer's text: escaped, and the feedback capped.
          `Organization ${escapeHtml(org.name)} has cancelled their subscription because: ${escapeHtml(
            String(body?.feedback ?? '').slice(0, 2000)
          )}`,
          user.email
        );
      } catch (e) {
        /* the subscription is cancelled either way */
      }
    }

    return result;
  }

  @Post('/prorate')
  @CheckPolicies(BILLING_ADMIN)
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    return this._stripeService.prorate(org.id, body);
  }

  // POST /billing/lifetime redeemed codes nothing in Postra issues, and about
  // 1 random string in 250 passed as one (AES-CBC without a MAC): a free plan
  // for good. Plans without payment are an administrator's grant.

  // The admin-only charge, refund and cancel routes used to live here, reading
  // the organization from the session. That made them usable only from inside
  // an impersonated session — the pattern that let add-subscription overwrite
  // an organization's Stripe customer id with a user id — and they
  // had no caller at all once the impersonation panel was replaced. They are
  // now GET /admin/charges, POST /admin/refund-charges and POST
  // /admin/cancel-subscription, each naming the organization in the request
  // and each writing an audit row.

  @Post('/add-subscription')
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async addSubscription(
    @Body() body: BillingAddSubscriptionDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Only Postra administrators can do this');
    }

    await this._subscriptionService.addSubscription(
      org.id,
      user.id,
      body.subscription,
      (customer) => this._stripeService.hasOpenSubscription(customer)
    );
  }

}
