import { randomUUID } from 'crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  appleIapEnabled,
  AppleRenewal,
  appleSandboxAllowedFor,
  appleStateOf,
  AppleTransaction,
} from '@gitroom/nestjs-libraries/services/apple/apple.iap';
import { AppleIapVerifier } from '@gitroom/nestjs-libraries/services/apple/apple.iap.verifier';
import { AppleNotificationStore } from '@gitroom/nestjs-libraries/services/apple/apple.notification.store';

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
    private _subscriptionRepository: SubscriptionRepository
  ) {}

  /** The app's purchase, or its "restore purchases", for the signed-in organisation. */
  async attach(organizationId: string, signedTransaction: string) {
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

    const holder = randomUUID();
    if (!(await this._store.lease(id, holder))) {
      throw new HttpException('This purchase is being processed.', 409);
    }
    try {
      const state = appleStateOf(transaction, undefined, Date.now());
      if (state.state === 'ended') {
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
      return { ok: true, tier: state.tier, isTrailing: state.isTrailing };
    } finally {
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
      { originalTransactionId, signedAt }
    );
  }
}
