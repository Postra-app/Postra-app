import { randomUUID } from 'crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  APPLE_EXPIRY_MARGIN_MS,
  appleAccountTokenFor,
  appleIapEnabled,
  AppleRenewal,
  appleSandboxAllowedFor,
  appleStateOf,
  AppleTransaction,
} from '@gitroom/nestjs-libraries/services/apple/apple.iap';
import { AppleIapVerifier } from '@gitroom/nestjs-libraries/services/apple/apple.iap.verifier';
import { AppleNotificationStore } from '@gitroom/nestjs-libraries/services/apple/apple.notification.store';
import { StripeOpenCheckouts } from '@gitroom/nestjs-libraries/services/apple/stripe.open.checkouts';

/**
 * Plans bought in the iOS app and billed by Apple.
 *
 * The app hands over the transaction StoreKit gave it (`attach`), which ties
 * the purchase to the organisation that was signed in. From then on Apple's
 * notifications (`notify`) keep the plan in step: renewals, a trial turning
 * into a paid plan, a change of plan, cancellation, a failed payment, a
 * refund. Stripe is not involved and its code paths are not touched; an
 * organisation is billed by one or the other, never both.
 */
@Injectable()
export class AppleIapService {
  constructor(
    private _verifier: AppleIapVerifier,
    private _store: AppleNotificationStore,
    private _subscriptionService: SubscriptionService,
    private _subscriptionRepository: SubscriptionRepository,
    private _openCheckouts: StripeOpenCheckouts
  ) {}

  /**
   * The app's purchase, or its "restore purchases", for the signed-in
   * organisation. `trialAllowed` is the rule the app's plan list went by:
   * whether this organisation may still have a free trial.
   */
  async attach(
    organizationId: string,
    signedTransaction: string,
    { trialAllowed }: { trialAllowed: boolean }
  ) {
    if (!appleIapEnabled()) {
      throw new HttpException('Not found', 404);
    }

    let transaction: AppleTransaction;
    try {
      transaction = await this._verifier.transaction(signedTransaction);
    } catch (err) {
      // Not signed by the App Store for this app: the caller's mistake.
      throw new HttpException('This purchase could not be verified.', 400);
    }

    const id = transaction.originalTransactionId;
    if (!id) {
      throw new HttpException('This purchase could not be verified.', 400);
    }
    if (
      transaction.environment !== 'Production' &&
      !appleSandboxAllowedFor(organizationId)
    ) {
      throw new HttpException(
        'Test purchases are not available on this account.',
        403
      );
    }
    // Family Sharing is off for every product in App Store Connect; should it
    // ever be switched on, a family member's copy of someone else's purchase
    // is not a plan of its own here.
    if (transaction.inAppOwnershipType === 'FAMILY_SHARED') {
      throw new HttpException(
        'This App Store subscription is shared with you by a family member and cannot be used here.',
        409
      );
    }
    // Bought for another organisation: on a shared device, or by someone
    // signed in to two accounts, the Apple ID's subscription must not end up
    // paying for an organisation it was not bought for. A purchase without a
    // token (an offer code redeemed in the App Store) is not bound to one.
    if (
      transaction.appAccountToken &&
      transaction.appAccountToken.toLowerCase() !==
        appleAccountTokenFor(organizationId)
    ) {
      throw new HttpException(
        'This App Store subscription belongs to another Postra account.',
        409
      );
    }

    // One write at a time for the purchase and for the organisation: two
    // different purchases handed over for one organisation in the same moment
    // would otherwise both find it without a plan, and the second would
    // overwrite the first while Apple billed both.
    const holder = randomUUID();
    const orgLease = `org:${organizationId}`;
    if (!(await this._store.lease(id, holder))) {
      throw new HttpException('This purchase is being processed.', 409);
    }
    if (!(await this._store.lease(orgLease, holder))) {
      await this._store.release(id, holder);
      throw new HttpException('This purchase is being processed.', 409);
    }
    try {
      const state = appleStateOf(transaction, undefined, Date.now());
      if (state.state !== 'active') {
        throw new HttpException(
          'This App Store subscription is no longer active.',
          409
        );
      }

      // A refunded purchase leaves the transaction the app first received
      // validly signed and unexpired. Apple has since said it is over; what
      // was signed before that is not a plan any more, here or anywhere.
      const signedAt = new Date(transaction.signedDate || 0);
      const endedAt = await this._store.endedAt(id);
      if (endedAt && endedAt >= signedAt) {
        throw new HttpException(
          'This App Store subscription is no longer active.',
          409
        );
      }

      // One purchase, one organisation. A purchase still paying for another
      // organisation's plan stays there; an ended one may move.
      const owner = await this._subscriptionRepository.findByAppleTransaction(
        id
      );
      if (owner && owner.organizationId !== organizationId) {
        if (!owner.deletedAt) {
          throw new HttpException(
            'This App Store subscription is already used by another Postra account.',
            409
          );
        }
        await this._subscriptionRepository.releaseEndedAppleTransaction(id);
      }

      // One trial, wherever it is taken. The app is given the products with
      // the free week only while the organisation may have one; a free week
      // bought anyway (an old plan list, a tampered request) is not a plan
      // here. A purchase already tied to this organisation was counted when
      // it was first handed over, so restoring it again is fine.
      if (
        state.isTrailing &&
        !trialAllowed &&
        owner?.organizationId !== organizationId
      ) {
        throw new HttpException(
          'This account has already had its free trial.',
          409
        );
      }

      // Billed by one or the other: a plan from Stripe, a comp or a lifetime
      // grant is not replaced by a purchase in the app.
      const current = await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      );
      if (current && current.appleOriginalTransactionId !== id) {
        throw new HttpException(
          'This account already has a plan. Cancel the App Store subscription in your Apple ID settings.',
          409
        );
      }

      await this.apply(
        organizationId,
        id,
        transaction,
        undefined,
        transaction.signedDate
      );

      // A Stripe checkout opened before this purchase must not be paid after
      // it. Not worth failing the purchase over: it is logged and the plan
      // stands.
      try {
        await this._openCheckouts.expire(
          await this._subscriptionRepository.getPaymentId(organizationId)
        );
      } catch (err) {
        Logger.error(
          `Open Stripe checkouts of ${organizationId} were not expired after an App Store purchase`,
          err instanceof Error ? err.stack : String(err)
        );
      }
      return { ok: true, tier: state.tier, isTrailing: state.isTrailing };
    } finally {
      await this._store.release(orgLease, holder);
      await this._store.release(id, holder);
    }
  }

  /**
   * An App Store Server Notification. Returns normally when there is nothing
   * to do; throws a 400 for a payload Apple did not sign and a 409 or 500
   * when Apple should deliver it again.
   */
  async notify(signedPayload: string) {
    if (!appleIapEnabled()) {
      throw new HttpException('Not found', 404);
    }

    let notification: Awaited<ReturnType<AppleIapVerifier['notification']>>;
    try {
      notification = await this._verifier.notification(signedPayload);
    } catch (err) {
      throw new HttpException('Invalid signature', 400);
    }

    const { transaction, renewal, notificationUUID } = notification;
    const type = `${notification.notificationType || 'UNKNOWN'}${
      notification.subtype ? `:${notification.subtype}` : ''
    }`;
    const id = transaction?.originalTransactionId;
    // A TEST ping from App Store Connect, or a type that carries no purchase.
    if (!transaction || !id || !notificationUUID) {
      return { ok: true };
    }

    if (await this._store.isDone(notificationUUID)) {
      return { ok: true, duplicate: true };
    }
    if (!(await this._store.lease(id, notificationUUID))) {
      throw new HttpException(
        'Another notification of this purchase is being handled',
        409
      );
    }
    try {
      if (await this._store.isDone(notificationUUID)) {
        return { ok: true, duplicate: true };
      }

      // Not tied to an organisation (yet): the first notification can outrun
      // the app, which then brings the transaction itself and carries the
      // state the notification would have set.
      const owner = await this._subscriptionRepository.findByAppleTransaction(
        id
      );
      // Kept even when nobody has handed the purchase over: a refund that
      // outruns the app must still stop the original transaction from
      // becoming a plan later.
      // A refund of an earlier, finished period ('stale') is not the end of
      // the purchase: the period in force is still paid for.
      if (appleStateOf(transaction, renewal, Date.now()).state === 'ended') {
        await this._store.markEnded(
          id,
          new Date(notification.signedDate || Date.now())
        );
      }
      if (owner) {
        await this.apply(
          owner.organizationId,
          id,
          transaction,
          renewal,
          notification.signedDate,
          owner
        );
      }
      await this._store.markDone(notificationUUID, type);
      return { ok: true, ...(owner ? {} : { unknown: true }) };
    } catch (err) {
      Logger.error(
        `App Store notification ${type} (${notificationUUID}) failed`,
        err instanceof Error ? err.stack : String(err)
      );
      throw err instanceof HttpException
        ? err
        : new HttpException('Notification handler failed', 500);
    } finally {
      await this._store.release(id, notificationUUID);
    }
  }

  private async apply(
    organizationId: string,
    originalTransactionId: string,
    transaction: AppleTransaction,
    renewal: AppleRenewal | undefined,
    signedDate: number | undefined,
    owner?: { deletedAt: Date | null; appleSignedAt: Date | null } | null
  ) {
    const signedAt = new Date(signedDate || Date.now());
    const known =
      owner === undefined
        ? await this._subscriptionRepository.findByAppleTransaction(
            originalTransactionId
          )
        : owner;
    // Apple does not promise an order. What was signed before the state
    // already written is old news: a renewal delivered after the refund that
    // followed it must not bring the plan back.
    if (known?.appleSignedAt && known.appleSignedAt > signedAt) {
      return;
    }

    const state = appleStateOf(transaction, renewal, Date.now());
    if (state.state === 'stale') {
      return;
    }
    if (state.state === 'ended') {
      await this._subscriptionService.endAppleSubscription(
        organizationId,
        originalTransactionId,
        signedAt
      );
      return;
    }

    // A notification about a purchase whose plan ended here and was since
    // replaced (a comp, a Stripe plan) has nothing to write to.
    if (known?.deletedAt) {
      const current = await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      );
      if (current) {
        return;
      }
    }

    // isTrailing puts the free week under the same trial limits as a trial
    // started on the web (planLimits).
    await this._subscriptionService.createOrUpdateSubscription(
      state.isTrailing,
      originalTransactionId,
      '', // no Stripe customer: addressed by organisation
      pricing[state.tier].channel!,
      state.tier,
      'MONTHLY',
      state.cancelAt,
      undefined,
      organizationId,
      state.periodAnchor,
      undefined,
      { originalTransactionId, signedAt, expiresAt: state.endsAt }
    );
  }

  /**
   * Plans whose paid period (and grace period) ended more than a day ago
   * with nothing from Apple to say they renewed. Normally the EXPIRED
   * notification ends them; this is for when it never arrives (the
   * notification address misconfigured, a long outage). Run daily by
   * housekeeping. Nothing is recorded as ended for the purchase itself, and
   * the row keeps the date Apple last signed: a renewal delivered late, or
   * the app's next sync, brings the plan back.
   */
  async expireLapsed(now = new Date()) {
    if (!appleIapEnabled()) {
      return [];
    }
    const cutoff = new Date(now.getTime() - APPLE_EXPIRY_MARGIN_MS);
    const due = await this._subscriptionRepository.listLapsedApple(cutoff);
    const ended: string[] = [];
    for (const row of due) {
      const id = row.appleOriginalTransactionId!;
      const holder = randomUUID();
      // A notification being handled for this purchase decides; next run.
      if (!(await this._store.lease(id, holder))) {
        continue;
      }
      try {
        // Read again under the lease: a renewal written since moved the date.
        const current = await this._subscriptionRepository.getSubscriptionByOrgId(
          row.organizationId
        );
        if (
          current?.appleOriginalTransactionId !== id ||
          !current.appleExpiresAt ||
          current.appleExpiresAt > cutoff
        ) {
          continue;
        }
        const { revoked } = await this._subscriptionService.endAppleSubscription(
          row.organizationId,
          id,
          current.appleSignedAt || new Date(0)
        );
        if (revoked) {
          ended.push(row.organizationId);
        }
      } catch (err) {
        Logger.error(
          `Lapsed App Store plan of ${row.organizationId} was not ended`,
          err instanceof Error ? err.stack : String(err)
        );
      } finally {
        await this._store.release(id, holder);
      }
    }
    return ended;
  }
}
