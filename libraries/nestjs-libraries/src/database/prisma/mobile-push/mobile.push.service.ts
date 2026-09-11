import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Push notifications for the Postra Mobile app (companion).
 * Tokens are Expo push tokens; sending goes through the Expo Push API (no key needed).
 * Best-effort by design — callers must never let a push failure break their flow.
 */
@Injectable()
export class MobilePushService {
  constructor(private _pushToken: PrismaRepository<'mobilePushToken'>) {}

  async registerToken(
    userId: string,
    organizationId: string,
    token: string,
    platform: string
  ) {
    if (!token) {
      return;
    }

    // The token string is the only proof of device we have, and it leaks —
    // into logs, device backups and support tickets. Do not let a caller claim
    // a token already registered to a different account: that let any signed-in
    // user push their organization's notifications onto someone else's device
    // and silence its real owner. Legitimate device hand-off still works,
    // because the previous user's logout unregisters the token first, freeing
    // it for whoever signs in next on that device.
    const existing = await this._pushToken.model.mobilePushToken.findUnique({
      where: { token },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId) {
      return;
    }

    return this._pushToken.model.mobilePushToken.upsert({
      where: { token },
      create: { userId, organizationId, token, platform: platform || 'unknown' },
      // userId is never changed here: a different owner is rejected above, so
      // this only ever refreshes the same user's org and platform.
      update: { organizationId, platform: platform || 'unknown' },
    });
  }

  async removeToken(token: string, userId: string) {
    if (!token || !userId) {
      return;
    }
    // Scope to the caller: a user may only unregister their own device, never
    // someone else's device by knowing the token string.
    await this._pushToken.model.mobilePushToken.deleteMany({
      where: { token, userId },
    });
  }

  /** Best-effort push to every device registered for an organization. */
  async notifyOrg(
    organizationId: string,
    title: string,
    body: string,
    type: 'success' | 'fail' | 'info' = 'info'
  ) {
    const tokens = await this._pushToken.model.mobilePushToken.findMany({
      where: { organizationId },
      select: { token: true },
    });
    if (!tokens.length) {
      return;
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      sound: 'default',
      priority: 'high',
      data: { type },
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    // Drop tokens Expo reports as no longer registered.
    try {
      const json: any = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      const dead = data
        .map((d: any, i: number) =>
          d?.status === 'error' && d?.details?.error === 'DeviceNotRegistered'
            ? messages[i]?.to
            : null
        )
        .filter((v: string | null): v is string => !!v);
      if (dead.length) {
        await this._pushToken.model.mobilePushToken.deleteMany({
          where: { token: { in: dead } },
        });
      }
    } catch {
      // ignore non-JSON / parse errors
    }
  }
}
