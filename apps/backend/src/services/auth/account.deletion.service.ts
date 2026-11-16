import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Provider } from '@prisma/client';
import {
  AccountChangedError,
  UsersService,
} from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { bustAuthContextCache } from '@gitroom/nestjs-libraries/redis/auth-context.cache';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  authEmailFooter,
  authEmails,
  EmailLang,
} from '@gitroom/backend/services/auth/auth.emails';

export const DELETE_ACCOUNT_PURPOSE = 'delete-account';
export const WRONG_PASSWORD = 'The password is not correct.';
export const DELETE_LINK_INVALID =
  'This link is not valid or has expired. Ask for a new one in Settings.';
export const ACCOUNT_CHANGED =
  'Your account changed while we were deleting it, so nothing was deleted. Please try again.';
export const DELETE_IN_PROGRESS =
  'Your account is already being deleted. Try again in a minute if it is still there.';
export const DELETE_MAIL_NOT_SENT =
  'We could not send the confirmation email. Please try again.';

export type DeletionRequest = { deleted: true } | { confirm: 'email' };

/**
 * Deleting an account is permanent, so a session alone does not do it.
 *
 * A stolen session (a laptop left open, a token copied out of an app) erased
 * the account and everything the organisation owned with one POST. Now the
 * person proves it is them: the account's password, or the link we email to
 * the address. The apps already in the stores send no password; they get the
 * email and, as any 2xx tells them, sign out.
 */
@Injectable()
export class AccountDeletionService {
  private readonly _logger = new Logger(AccountDeletionService.name);

  constructor(
    private _userService: UsersService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService,
    private _emailService: EmailService
  ) {}

  async request(
    userId: string,
    password: unknown,
    lang: EmailLang = 'en'
  ): Promise<DeletionRequest> {
    const user = await this._userService.getUserById(userId);
    if (!user) {
      throw new HttpException(DELETE_LINK_INVALID, 400);
    }

    // Only an account with its own password can prove it with one; a
    // password sent for a Google or Apple account is ignored, not checked
    // against the random one such accounts hold.
    if (
      user.providerName === Provider.LOCAL &&
      typeof password === 'string' &&
      password.length > 0
    ) {
      if (
        !user.password ||
        !(await AuthChecker.comparePassword(password, user.password))
      ) {
        throw new HttpException(WRONG_PASSWORD, 400);
      }
      try {
        await this.deleteNow(user.id, user.email, user.tokenVersion);
      } catch (err) {
        if (err instanceof AccountChangedError) {
          throw new HttpException(ACCOUNT_CHANGED, 409);
        }
        throw err;
      }
      return { deleted: true };
    }

    const token = AuthChecker.signJWT(
      {
        id: user.id,
        tokenVersion: user.tokenVersion,
        purpose: DELETE_ACCOUNT_PURPOSE,
      },
      { expiresIn: '1h' }
    );
    const mail = authEmails.deleteAccount[lang];
    const sent = await this._emailService
      .sendEmailSync(
        user.email,
        mail.subject,
        mail.html(`${process.env.FRONTEND_URL}/auth/delete-account/${token}`),
        undefined,
        authEmailFooter[lang]
      )
      .catch((err) => {
        this._logger.error(`delete-account mail not sent: ${err?.message}`);
        return false;
      });
    if (!sent) {
      throw new HttpException(DELETE_MAIL_NOT_SENT, 503);
    }
    return { confirm: 'email' };
  }

  // The link from the email. Returns the id of the deleted account, or null
  // when the link is not one, has expired, or no longer matches the account
  // (password changed, account suspended or already deleted).
  async confirm(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || !token) {
      return null;
    }
    let claims: { id?: unknown; tokenVersion?: unknown; purpose?: unknown };
    try {
      claims = AuthChecker.verifyJWT(token) as typeof claims;
    } catch {
      return null;
    }
    if (
      claims.purpose !== DELETE_ACCOUNT_PURPOSE ||
      typeof claims.id !== 'string' ||
      typeof claims.tokenVersion !== 'number'
    ) {
      return null;
    }
    const user = await this._userService.getUserById(claims.id);
    if (!user || user.tokenVersion !== claims.tokenVersion) {
      return null;
    }
    // Two clicks at once both passed the check above; one deletes. The
    // lock only keeps them apart: the version is checked again inside the
    // deleting transaction, and a failed attempt gives the lock back so the
    // same link can be tried again.
    const lockKey = `account-delete:${user.id}`;
    let locked = false;
    try {
      const lock = await ioRedis.set(lockKey, '1', 'EX', 120, 'NX');
      if (lock !== 'OK') {
        throw new HttpException(DELETE_IN_PROGRESS, 409);
      }
      locked = true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Without Redis the version check in the transaction still decides.
    }
    try {
      await this.deleteNow(user.id, user.email, claims.tokenVersion);
    } catch (err) {
      if (locked) await ioRedis.del(lockKey).catch((): void => undefined);
      if (err instanceof AccountChangedError) {
        return null;
      }
      throw err;
    }
    return user.id;
  }

  // GDPR / RODO right to erasure + Meta data-deletion. Permanently deletes the
  // user and the organizations they solely own (UsersService.deleteAccount).
  private async deleteNow(
    userId: string,
    email: string,
    expectedTokenVersion: number
  ) {
    // Cancel Stripe billing before the DB rows (and with them the customer
    // lookup) are gone. Orchestrated here because StripeService itself
    // injects UsersService: the reverse dependency would be circular.
    // Checked once more before Stripe, which cannot be rolled back; the
    // transaction in deleteAccount checks it again under the row lock.
    const current = await this._userService.getUserById(userId);
    if (!current || current.tokenVersion !== expectedTokenVersion) {
      throw new AccountChangedError();
    }
    const soleOrgIds = await this._userService.getSoleOwnedOrganizations(
      userId
    );
    for (const organizationId of soleOrgIds) {
      await this._stripeService.cancelAllSubscriptionsForDeletedAccount(
        organizationId
      );
    }

    await this._userService.deleteAccount(userId, expectedTokenVersion);
    // Another device signed in as this user kept reading the shared org for
    // up to the 30 s the auth context is cached.
    await bustAuthContextCache(userId);

    // GDPR art. 12: confirm the erasure to the data subject, in writing.
    // Best-effort: the deletion already happened and must not fail on email.
    try {
      await this._notificationService.sendEmail(
        email,
        'Your Postra account has been deleted',
        'Your Postra account and its data - connected channels, scheduled posts and media - have been permanently deleted, and a subscription paid on the Postra website was cancelled. A subscription bought in the App Store goes on until you cancel it in Settings on your iPhone. Billing records required by law are retained in line with our privacy policy. Thanks for trying Postra.'
      );
    } catch (e) {
      /* the account is gone either way */
    }
  }
}
