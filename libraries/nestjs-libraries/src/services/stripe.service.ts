import Stripe from 'stripe';
import { Injectable } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { isMissingCustomerError } from '@gitroom/nestjs-libraries/services/stripe.errors';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing');

@Injectable()
export class StripeService {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    private _notificationService: NotificationService
  ) {}
  validateRequest(rawBody: Buffer, signature: string, endpointSecret: string) {
    return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  }

  async checkValidCard(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    if (event.data.object.status === 'incomplete') {
      return false;
    }

    const getOrgFromCustomer =
      await this._organizationService.getOrgByCustomerId(
        event.data.object.customer as string
      );

    if (!getOrgFromCustomer?.allowTrial) {
      return true;
    }

    console.log('Checking card');

    const paymentMethods = await stripe.paymentMethods.list({
      customer: event.data.object.customer as string,
    });

    // find the last one created
    const latestMethod = paymentMethods.data.reduce(
      (prev, current) => {
        if (prev.created < current.created) {
          return current;
        }
        return prev;
      },
      { created: -100 } as Stripe.PaymentMethod
    );

    if (!latestMethod.id) {
      return false;
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 100,
        currency: 'gbp',
        payment_method: latestMethod.id,
        customer: event.data.object.customer as string,
        off_session: true,
        capture_method: 'manual', // Authorize without capturing
        confirm: true, // Confirm the PaymentIntent
      });

      // requires_action is not a bad card — the issuer wants 3-D Secure, which
      // an off-session £1 probe can never complete. The card already passed
      // on-session SCA at Checkout; if the bank asks again at invoice time,
      // the invoice.payment_action_required handler sends the customer a link.
      if (paymentIntent.status === 'requires_action') {
        await stripe.paymentIntents.cancel(paymentIntent.id);
        return true;
      }

      if (paymentIntent.status !== 'requires_capture') {
        console.error('Cant charge');
        await stripe.paymentMethods.detach(latestMethod.id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
        return false;
      }

      await stripe.paymentIntents.cancel(paymentIntent.id as string);
      return true;
    } catch (err) {
      // Same case as requires_action above, except stripe-node reports it by
      // throwing when confirm happens off-session.
      if ((err as Stripe.errors.StripeError)?.code === 'authentication_required') {
        const intent = (err as Stripe.errors.StripeCardError)?.payment_intent;
        if (intent?.id) {
          try {
            await stripe.paymentIntents.cancel(intent.id);
          } catch (cancelErr) {
            /*dont do anything*/
          }
        }
        return true;
      }
      try {
        await stripe.paymentMethods.detach(latestMethod.id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
      } catch (err) {
        /*dont do anything*/
      }
      return false;
    }
  }

  async createSubscription(event: Stripe.CustomerSubscriptionCreatedEvent) {
    const {
      uniqueId,
      billing,
      period,
    } = event.data.object.metadata as {
      billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    // A subscription created by hand in the Stripe dashboard can carry
    // service metadata with a missing/invalid billing tier — indexing
    // pricing[billing] would 500 and Stripe would retry the event forever.
    if (!billing || !pricing[billing]) {
      return { ok: false };
    }

    try {
      const check = await this.checkValidCard(event);
      if (!check) {
        return { ok: false };
      }
    } catch (err) {
      return { ok: false };
    }

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );
  }
  async updateSubscription(event: Stripe.CustomerSubscriptionUpdatedEvent) {
    const {
      uniqueId,
      billing,
      period,
    } = event.data.object.metadata as {
      billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    // A subscription created by hand in the Stripe dashboard can carry
    // service metadata with a missing/invalid billing tier — indexing
    // pricing[billing] would 500 and Stripe would retry the event forever.
    if (!billing || !pricing[billing]) {
      return { ok: false };
    }

    const check = await this.checkValidCard(event);
    if (!check) {
      return { ok: false };
    }

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );
  }

  async paymentFailed(event: Stripe.InvoicePaymentFailedEvent) {
    const customer = event.data.object.customer as string;
    const org = await this._organizationService.getOrgByCustomerId(customer);
    if (!org) {
      return { ok: true };
    }

    // Stripe Smart Retries re-attempt automatically; if they all fail Stripe
    // fires customer.subscription.deleted (handled -> downgrade). Here we alert
    // the customer so they can fix their card before it gets that far.
    await this._notificationService.inAppNotification(
      org.id,
      'Payment failed',
      `We couldn't process your latest payment. Please update your payment method at ${process.env.FRONTEND_URL}/billing to keep your subscription active.`,
      true,
      false,
      'info'
    );

    return { ok: true };
  }

  async paymentActionRequired(event: Stripe.InvoicePaymentActionRequiredEvent) {
    const customer = event.data.object.customer as string;
    const org = await this._organizationService.getOrgByCustomerId(customer);
    if (!org) {
      return { ok: true };
    }

    // The bank demanded 3-D Secure on an automatic charge, so the payment sits
    // in requires_action until the customer authenticates — Stripe won't retry
    // its way out of this one. The hosted invoice page is where they finish it.
    const url =
      event.data.object.hosted_invoice_url ||
      `${process.env.FRONTEND_URL}/billing`;
    await this._notificationService.inAppNotification(
      org.id,
      'Confirm your payment',
      `Your bank needs you to confirm your latest payment before it goes through. Please complete the verification at ${url} to keep your subscription active.`,
      true,
      false,
      'info'
    );

    return { ok: true };
  }

  async deleteSubscription(event: Stripe.CustomerSubscriptionDeletedEvent) {
    await this._subscriptionService.deleteSubscription(
      event.data.object.customer as string
    );
  }

  async createOrGetCustomer(organization: Organization) {
    if (organization.paymentId && (await this.customerExists(organization))) {
      return organization.paymentId;
    }

    const users = await this._organizationService.getTeam(organization.id);
    const customer = await stripe.customers.create({
      email: users.users[0].user.email.indexOf('@') > -1 ? users.users[0].user.email : `${users.users[0].user.email}@postra.co.uk`,
      name: organization.name,
    });
    await this._subscriptionService.updateCustomerId(
      organization.id,
      customer.id
    );
    return customer.id;
  }

  /**
   * Is the customer we stored still in this Stripe account?
   *
   * Asked before checkout, because a stored id Stripe has forgotten would make
   * every later call fail the same way and leave the org unable to pay at all.
   * Only a definitive "no such customer" answers false — a network blip or any
   * other Stripe failure is re-thrown, so a hiccup never creates a duplicate
   * customer.
   */
  private async customerExists(organization: Organization) {
    try {
      const customer = await stripe.customers.retrieve(organization.paymentId!);
      if (!customer.deleted) {
        return true;
      }
    } catch (err) {
      if (!isMissingCustomerError(err)) {
        throw err;
      }
    }

    console.warn(
      `[stripe] organization ${organization.id} points at customer ${
        organization.paymentId
      }, which Stripe no longer has — creating a new one`
    );
    return false;
  }

  // Resolve the Stripe product for a plan tier. Matched by metadata.tier first
  // so the product's display name can be a customer-facing label (e.g. "Postra
  // Starter") without breaking the STANDARD/PRO/ULTIMATE lookup; falls back to
  // the legacy name === tier match for products that predate the metadata tag.
  // New products are created carrying metadata.tier so they stay renameable.
  private async findOrCreateProduct(billing: string) {
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    return (
      allProducts.data.find((p) => p.metadata?.tier === billing) ||
      allProducts.data.find(
        (p) => p.name.toUpperCase() === billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: billing,
        metadata: { tier: billing },
      }))
    );
  }

  async prorate(organizationId: string, body: BillingSubscribeDto) {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const priceData = pricing[body.billing];

    const findProduct = await this.findOrCreateProduct(body.billing);

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.currency === 'gbp' &&
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.nickname === body.billing + ' ' + body.period &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'gbp',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const proration_date = Math.floor(Date.now() / 1000);

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      const price = await stripe.invoices.createPreview({
        customer,
        subscription: currentUserSubscription?.data?.[0]?.id,
        subscription_details: {
          proration_behavior: 'create_prorations',
          billing_cycle_anchor: 'now',
          items: [
            {
              id: currentUserSubscription?.data?.[0]?.items?.data?.[0]?.id,
              price: findPrice?.id!,
              quantity: 1,
            },
          ],
          proration_date: proration_date,
        },
      });

      return {
        price: price?.amount_remaining ? price?.amount_remaining / 100 : 0,
      };
    } catch (err) {
      return { price: 0 };
    }
  }

  /**
   * Every subscription Stripe holds for this customer — or none, when Stripe
   * no longer has the customer at all.
   *
   * One place, because three callers ask the same question and all three used
   * to answer it with a 500: the poll after checkout, cancelling a plan, and
   * deleting an account.
   */
  private async listSubscriptions(
    customer: string,
    organizationId: string
  ): Promise<Stripe.Subscription[]> {
    try {
      return (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data;
    } catch (err) {
      if (isMissingCustomerError(err)) {
        console.warn(
          `[stripe] organization ${organizationId} points at customer ${customer}, which Stripe no longer has — reading it as no subscriptions`
        );
        return [];
      }
      throw err;
    }
  }

  async getCustomerSubscriptions(
    organizationId: string
  ): Promise<{ data: Stripe.Subscription[] }> {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customer = org.paymentId;
    // No customer means no subscriptions. Passing an empty one to Stripe asks
    // for every subscription in the account instead.
    if (!customer) {
      return { data: [] };
    }

    return { data: await this.listSubscriptions(customer, organizationId) };
  }

  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.latest_invoice'],
        })
      ).data.filter((f) => f.status !== 'canceled'),
    };

    const sub = currentUserSubscription.data[0];

    // If the user is toggling back (un-cancelling), just remove the cancel
    if (sub.cancel_at_period_end) {
      const { cancel_at } = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: false,
        metadata: { service: 'gitroom', id },
      });

      await this._subscriptionService.setCancelAt(organizationId, null);

      return {
        id,
        cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
      };
    }

    // Check if the latest invoice has a failed payment
    const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      sub.status === 'past_due' ||
      latestInvoice?.status === 'open' ||
      latestInvoice?.status === 'uncollectible';

    if (hasFailedPayment) {
      // Payment already failed — cancel immediately and delete subscription
      await stripe.subscriptions.cancel(sub.id);
      await this._subscriptionService.deleteSubscription(customer);

      return {
        id,
        cancel_at: new Date(),
      };
    }

    // Payment succeeded — cancel at end of billing period
    const { cancel_at } = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
      metadata: { service: 'gitroom', id },
    });

    const cancelAt = cancel_at ? new Date(cancel_at * 1000) : null;
    await this._subscriptionService.setCancelAt(organizationId, cancelAt);

    return {
      id,
      cancel_at: cancelAt ?? undefined,
    };
  }

  async getCustomerByOrganizationId(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    return org.paymentId;
  }

  async createBillingPortalLink(customer: string) {
    return stripe.billingPortal.sessions.create({
      customer,
      return_url: process.env['FRONTEND_URL'] + '/billing',
    });
  }

  /**
   * Find an active promotion code with autoapply: true metadata
   * Only returns codes that are active and not expired
   * Returns the promotion code string (not the ID) for frontend auto-apply
   */
  private async findAutoApplyPromotionCode(): Promise<string | null> {
    try {
      const promotionCodes = await stripe.promotionCodes.list({
        active: true,
        limit: 100,
      });

      const now = Math.floor(Date.now() / 1000);

      for (const promoCode of promotionCodes.data) {
        const coupon =
          typeof promoCode.promotion.coupon === 'string'
            ? null
            : promoCode.promotion.coupon;

        // Check if it has autoapply metadata set to true (check both promo and coupon metadata)
        const autoApply = Object.assign(
          {},
          promoCode.metadata,
          coupon?.metadata
        )?.autoapply;
        if (autoApply !== 'true') continue;

        // Check if the promotion code has expired
        if (promoCode.expires_at && promoCode.expires_at < now) continue;

        // Check if the coupon has expired (redeem_by)
        if (coupon?.redeem_by && coupon.redeem_by < now) continue;

        // Check if max redemptions reached
        if (
          promoCode.max_redemptions &&
          promoCode.times_redeemed >= promoCode.max_redemptions
        )
          continue;

        // Found a valid auto-apply promotion code - return the code string for frontend
        return promoCode.code;
      }

      return null;
    } catch (err) {
      console.error('Error finding auto-apply promotion code:', err);
      return null;
    }
  }

  private async createEmbeddedCheckout(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const user = await this._userService.getUserById(userId);

    try {
      await stripe.customers.update(customer, {
        email: user.email.indexOf('@') > -1 ? user.email : `${user.email}@postra.co.uk`,
        ...(body.dub
          ? {
              metadata: {
                dubCustomerExternalId: userId,
                dubClickId: body.dub,
              },
            }
          : {}),
      });
    } catch (err) {}

    // Check for auto-apply promotion code (only for monthly plans)
    let autoApplyPromoCode: string | null = null;
    if (body.period === 'MONTHLY') {
      autoApplyPromoCode = await this.findAutoApplyPromotionCode();
    }

    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';
    const { client_secret } = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      customer,
      return_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 7 } : {}),
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      ...(body.datafast_session_id && body.datafast_visitor_id
        ? {
            metadata: {
              datafast_visitor_id: body.datafast_visitor_id,
              datafast_session_id: body.datafast_session_id,
            },
          }
        : {}),
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    // Return auto-apply promo code for frontend to apply
    return {
      client_secret,
      ...(autoApplyPromoCode ? { auto_apply_coupon: autoApplyPromoCode } : {}),
    };
  }

  private async createCheckoutSession(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';

    if (body.dub) {
      await stripe.customers.update(customer, {
        metadata: {
          dubCustomerExternalId: userId,
          dubClickId: body.dub,
        },
      });
    }

    const { url } = await stripe.checkout.sessions.create({
      customer,
      cancel_url: process.env['FRONTEND_URL'] + `/billing?cancel=true${isUtm}`,
      success_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 7 } : {}),
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    return { url };
  }

  async finishTrial(paymentId: string) {
    const list = (
      await stripe.subscriptions.list({
        customer: paymentId,
      })
    ).data.filter((f) => f.status === 'trialing');

    return stripe.subscriptions.update(list[0].id, {
      trial_end: 'now',
    });
  }

  async checkDiscount(customer: string) {
    if (!process.env.STRIPE_DISCOUNT_ID || !customer) {
      return false;
    }

    let list: Stripe.ApiList<Stripe.Charge>;
    try {
      list = await stripe.charges.list({
        customer,
        limit: 1,
      });
    } catch (err) {
      // Same stale id as in getCustomerSubscriptions: no customer, no charges,
      // so there is nothing to discount. The billing page must still open.
      if (isMissingCustomerError(err)) {
        return false;
      }
      throw err;
    }

    if (!list.data.filter((f) => f.amount > 1000).length) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    // Guard the inner value, not the always-truthy wrapper object — otherwise
    // no-active-subscription falls through and applyDiscount later dereferences
    // `.data.id` (500).
    if (!currentUserSubscription.data) {
      return false;
    }

    if (
      currentUserSubscription.data?.items.data[0]?.price.recurring?.interval ===
        'year' ||
      currentUserSubscription.data?.discounts.length
    ) {
      return false;
    }

    return true;
  }

  async applyDiscount(customer: string) {
    const check = await this.checkDiscount(customer);
    if (!check) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    if (!currentUserSubscription.data) {
      return false;
    }

    await stripe.subscriptions.update(currentUserSubscription.data.id, {
      discounts: [
        {
          coupon: process.env.STRIPE_DISCOUNT_ID!,
        },
      ],
    });

    return true;
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    const orgValue = await this._subscriptionService.checkSubscription(
      organizationId,
      subscriptionId
    );

    if (orgValue) {
      return 2;
    }

    const getCustomerSubscriptions = await this.getCustomerSubscriptions(
      organizationId
    );
    if (getCustomerSubscriptions.data.length === 0) {
      return 0;
    }

    if (
      getCustomerSubscriptions.data.find(
        (p) => p.metadata.uniqueId === subscriptionId
      )?.canceled_at
    ) {
      return 1;
    }

    return 0;
  }

  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const findProduct = await this.findOrCreateProduct(body.billing);

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          // stale USD prices exist in the account — a $29 price must not
          // match PRO £29 and check out in the wrong currency
          p?.currency === 'gbp' &&
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'gbp',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    return this.createEmbeddedCheckout(
      uniqueId,
      id,
      customer,
      body,
      findPrice!.id,
      userId,
      allowTrial
    );
  }

  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const findProduct = await this.findOrCreateProduct(body.billing);

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          // stale USD prices exist in the account — a $29 price must not
          // match PRO £29 and check out in the wrong currency
          p?.currency === 'gbp' &&
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'gbp',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const getCurrentSubscriptions =
      await this._subscriptionService.getSubscription(organizationId);

    if (!getCurrentSubscriptions) {
      return this.createCheckoutSession(
        uniqueId,
        id,
        customer,
        body,
        findPrice!.id,
        userId,
        allowTrial
      );
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      await stripe.subscriptions.update(currentUserSubscription.data[0].id, {
        cancel_at_period_end: false,
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          id,
          ud: uniqueId,
        },
        proration_behavior: 'always_invoice',
        items: [
          {
            id: currentUserSubscription.data[0].items.data[0].id,
            price: findPrice!.id,
            quantity: 1,
          },
        ],
      });

      return { id };
    } catch (err) {
      const { url } = await this.createBillingPortalLink(customer);
      return {
        portal: url,
      };
    }
  }

  async paymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent) {
    // get subscription from payment
    const subscriptionId =
      event.data.object.parent?.subscription_details?.subscription;
    if (!subscriptionId) {
      return { ok: true };
    }
    const subscription = await stripe.subscriptions.retrieve(
      typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
    );

    const { userId, ud } = subscription.metadata;
    const user = await this._userService.getUserById(userId);
    if (user && user.ip && user.agent) {
      this._trackService.track(ud, user.ip, user.agent, TrackEnum.Purchase, {
        value: event.data.object.amount_paid / 100,
      });
    }

    return { ok: true };
  }

  async getCharges(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return [];
    }

    let charges: Stripe.ApiList<Stripe.Charge>;
    try {
      charges = await stripe.charges.list({
        customer: org.paymentId,
        limit: 100,
      });
    } catch (err) {
      // A customer Stripe has forgotten has no invoices either — show an empty
      // billing history instead of breaking the page.
      if (isMissingCustomerError(err)) {
        return [];
      }
      throw err;
    }

    const chargeList = charges.data
      .filter((f) => f.status === 'succeeded')
      .map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        created: charge.created,
        status: charge.status,
        refunded: charge.refunded,
        amount_refunded: charge.amount_refunded,
        description: charge.description,
        receipt_url: charge.receipt_url || null,
        invoice: (charge as any).invoice || null,
      }));

    const invoiceIds = chargeList
      .map((c) => c.invoice)
      .filter((id): id is string => !!id && typeof id === 'string');

    const invoicePdfMap: Record<string, string> = {};
    for (const invoiceId of invoiceIds) {
      try {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.invoice_pdf) {
          invoicePdfMap[invoiceId] = inv.invoice_pdf;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    return chargeList.map((charge) => ({
      ...charge,
      invoice_pdf:
        charge.invoice && invoicePdfMap[charge.invoice as string]
          ? invoicePdfMap[charge.invoice as string]
          : null,
    }));
  }

  async refundCharges(organizationId: string, chargeIds: string[]) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const refunded: string[] = [];
    const failed: string[] = [];

    for (const chargeId of chargeIds) {
      try {
        // Never refund a charge that isn't this org's — chargeIds come from
        // the client and must be bound to the org's Stripe customer.
        const charge = await stripe.charges.retrieve(chargeId);
        if (charge.customer !== org.paymentId) {
          failed.push(chargeId);
          continue;
        }
        await stripe.refunds.create({ charge: chargeId });
        refunded.push(chargeId);
      } catch (err) {
        failed.push(chargeId);
      }
    }

    return { refunded, failed };
  }

  async cancelSubscription(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const customer = org.paymentId;

    const subscriptions = (
      await this.listSubscriptions(customer, organizationId)
    ).filter((f) => f.status !== 'canceled');

    if (!subscriptions.length) {
      throw new Error('No active subscription found');
    }

    await stripe.subscriptions.cancel(subscriptions[0].id);
    await this._subscriptionService.deleteSubscription(customer);

    return { cancelled: true };
  }

  // Account-deletion path. Unlike cancelSubscription() it is a no-op when the
  // organization has no Stripe customer or no live subscription, and it cancels
  // immediately (no cancel_at_period_end) — the account is about to be erased,
  // so nothing may keep charging the card. DB Subscription rows are not touched
  // here; they cascade away with the organization.
  async cancelAllSubscriptionsForDeletedAccount(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return;
    }

    const subscriptions = (
      await this.listSubscriptions(org.paymentId, organizationId)
    ).filter((f) => f.status !== 'canceled');

    for (const subscription of subscriptions) {
      await stripe.subscriptions.cancel(subscription.id);
    }
  }

  async lifetimeDeal(organizationId: string, code: string) {
    const getCurrentSubscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    if (getCurrentSubscription && !getCurrentSubscription?.isLifetime) {
      throw new Error('You already have a non lifetime subscription');
    }

    try {
      const testCode = AuthService.fixedDecryption(code);
      const findCode = await this._subscriptionService.getCode(testCode);
      if (findCode) {
        return {
          success: false,
        };
      }

      const nextPackage = !getCurrentSubscription ? 'STANDARD' : 'PRO';
      const findPricing = pricing[nextPackage];

      await this._subscriptionService.createOrUpdateSubscription(
        false,
        makeId(10),
        organizationId,
        getCurrentSubscription?.subscriptionTier === 'PRO'
          ? getCurrentSubscription.totalChannels + 5
          : findPricing.channel!,
        nextPackage,
        'MONTHLY',
        null,
        testCode,
        organizationId
      );
      return {
        success: true,
      };
    } catch (err) {
      console.log(err);
      return {
        success: false,
      };
    }
  }
}
