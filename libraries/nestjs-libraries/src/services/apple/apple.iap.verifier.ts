import { X509Certificate } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';
import {
  APPLE_ROOT_CA_G3_PEM,
  appleAppId,
  appleBundleId,
  AppleRenewal,
  AppleTransaction,
} from '@gitroom/nestjs-libraries/services/apple/apple.iap';

export type AppleNotification = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  signedDate?: number;
  transaction?: AppleTransaction;
  renewal?: AppleRenewal;
};

/**
 * Checks that something was signed by the App Store for this app, with
 * Apple's own library: the certificate chain up to Apple's root, the bundle
 * id and the environment.
 *
 * Production is tried first and the test environment second, as Apple asks:
 * a build under review talks to the production server but buys in the
 * sandbox. Whether a sandbox purchase is then honoured is the caller's
 * decision (appleSandboxAllowedFor).
 */
@Injectable()
export class AppleIapVerifier {
  private _verifiers = new Map<Environment, SignedDataVerifier>();

  private environments(): Environment[] {
    return [
      Environment.PRODUCTION,
      Environment.SANDBOX,
      // StoreKit testing in Xcode signs nothing Apple can vouch for, and the
      // library does not check it. For a developer's own machine only.
      ...(process.env.APPLE_IAP_LOCAL_TESTING &&
      process.env.NODE_ENV !== 'production'
        ? [Environment.XCODE]
        : []),
    ];
  }

  private verifier(environment: Environment) {
    let verifier = this._verifiers.get(environment);
    if (!verifier) {
      verifier = new SignedDataVerifier(
        [new X509Certificate(APPLE_ROOT_CA_G3_PEM).raw],
        // Revocation of the signing certificates, checked with Apple (OCSP).
        environment !== Environment.XCODE,
        environment,
        appleBundleId(),
        appleAppId()
      );
      this._verifiers.set(environment, verifier);
    }
    return verifier;
  }

  private async first<T>(
    run: (verifier: SignedDataVerifier) => Promise<T>
  ): Promise<T> {
    let failure: unknown;
    for (const environment of this.environments()) {
      try {
        return await run(this.verifier(environment));
      } catch (err) {
        failure = failure ?? err;
      }
    }
    throw failure;
  }

  /** A transaction as StoreKit hands it to the app (a JWS). Throws if it is not Apple's. */
  transaction(signedTransaction: string): Promise<AppleTransaction> {
    return this.first((v) => v.verifyAndDecodeTransaction(signedTransaction));
  }

  /** An App Store Server Notification (version 2) with what it carries. */
  notification(signedPayload: string): Promise<AppleNotification> {
    return this.first(async (v) => {
      const payload = await v.verifyAndDecodeNotification(signedPayload);
      const { signedTransactionInfo, signedRenewalInfo } = payload.data || {};
      return {
        notificationType: payload.notificationType,
        subtype: payload.subtype,
        notificationUUID: payload.notificationUUID,
        signedDate: payload.signedDate,
        transaction: signedTransactionInfo
          ? await v.verifyAndDecodeTransaction(signedTransactionInfo)
          : undefined,
        renewal: signedRenewalInfo
          ? await v.verifyAndDecodeRenewalInfo(signedRenewalInfo)
          : undefined,
      };
    });
  }
}
