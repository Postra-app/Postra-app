import { Body, Controller, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { BillingAddSubscriptionDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.add.subscription.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { bustAuthContextCache } from '@gitroom/backend/services/auth/auth.middleware';
import dayjs from 'dayjs';

// Billing mutations change what the org's card is charged — restrict to org
// admins/owner (ADMIN section = ADMIN/SUPERADMIN role). A regular invited
// member must not be able to change the tier, cancel, or redeem codes.
const BILLING_ADMIN = [AuthorizationActions.Create, Sections.ADMIN] as [
  AuthorizationActions,
  Sections
];

@ApiTags('Billing')
@Controller('/billing')
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService
  ) {}

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') body: string
  ) {
    const status = await this._stripeService.checkSubscription(org.id, body);
    // The frontend re-fetches /user/self exactly once when this turns 2 — that
    // request must not be served the pre-payment FREE context from the 30s
    // auth cache (the webhook busts it too, but this poll can win that race).
    if (status === 2) {
      await bustAuthContextCache(user.id);
    }
    return { status };
  }

  @Get('/check-discount')
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await this._stripeService.checkDiscount(org.paymentId))
        ? false
        : AuthService.signJWT({ discount: true }),
    };
  }

  @Post('/apply-discount')
  @CheckPolicies(BILLING_ADMIN)
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    await this._stripeService.applyDiscount(org.paymentId);
  }

  @Post('/finish-trial')
  @CheckPolicies(BILLING_ADMIN)
  async finishTrial(@GetOrgFromRequest() org: Organization) {
    try {
      await this._stripeService.finishTrial(org.paymentId);
    } catch (err) {}
    return {
      finish: true,
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
  embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    const uniqueId = req?.cookies?.track;
    return this._stripeService.embedded(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Post('/subscribe')
  @CheckPolicies(BILLING_ADMIN)
  subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    const uniqueId = req?.cookies?.track;
    return this._stripeService.subscribe(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Get('/portal')
  @CheckPolicies(BILLING_ADMIN)
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    const customer = await this._stripeService.getCustomerByOrganizationId(
      org.id
    );
    const { url } = await this._stripeService.createBillingPortalLink(customer);
    return {
      portal: url,
    };
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._subscriptionService.getSubscriptionByOrganizationId(org.id);
  }

  @Post('/cancel')
  @CheckPolicies(BILLING_ADMIN)
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: { feedback: string }
  ) {
    const result = await this._stripeService.setToCancel(org.id);

    // setToCancel is a toggle — cancel_at is only set on an actual
    // cancellation, not when the user re-activates. Emails are best-effort:
    // the cancellation itself must not 500 on an SES hiccup.
    if (result?.cancel_at) {
      try {
        // Operator notification (cancellation feedback). Must go to a
        // monitored inbox — EMAIL_FROM_ADDRESS (no-reply@) has no mailbox and
        // sits on the SES suppression list, so mail to it silently bounces.
        await this._notificationService.sendEmail(
          process.env.EMAIL_ADMIN_ADDRESS || process.env.EMAIL_FROM_ADDRESS,
          'Subscription Cancelled',
          `Organization ${org.name} has cancelled their subscription because: ${body.feedback}`,
          user.email
        );

        // Written confirmation for the customer (chargeback evidence + the
        // upcoming UK DMCCA cancellation-confirmation requirement).
        await this._notificationService.sendEmail(
          user.email,
          'Your Postra subscription is cancelled',
          `Your subscription has been cancelled and you will not be charged again. You keep full access until ${dayjs(
            result.cancel_at
          ).format(
            'D MMMM YYYY'
          )}. Changed your mind? You can re-activate any time from Billing.`
        );
      } catch (e) {
        /* the subscription is cancelled either way */
      }
    }

    return result;
  }

  @Post('/prorate')
  @CheckPolicies(BILLING_ADMIN)
  prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    return this._stripeService.prorate(org.id, body);
  }

  @Post('/lifetime')
  @CheckPolicies(BILLING_ADMIN)
  async lifetime(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { code: string }
  ) {
    return this._stripeService.lifetimeDeal(org.id, body.code);
  }

  @Get('/charges')
  async getCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.getCharges(org.id);
  }

  @Post('/refund-charges')
  async refundCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Body() body: { chargeIds: string[] }
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.refundCharges(org.id, body.chargeIds);
  }

  @Post('/cancel-subscription')
  async cancelSubscription(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.cancelSubscription(org.id);
  }

  @Post('/add-subscription')
  async addSubscription(
    @Body() body: BillingAddSubscriptionDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    await this._subscriptionService.addSubscription(
      org.id,
      user.id,
      body.subscription
    );
  }

}
