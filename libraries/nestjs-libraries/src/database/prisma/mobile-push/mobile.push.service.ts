import { Injectable, Logger } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
// Expo takes at most 100 messages per request and 1000 ids per receipts call
// (docs.expo.dev/push-notifications/sending-notifications).
const MESSAGES_PER_REQUEST = 100;
const RECEIPTS_PER_REQUEST = 1000;
// A ticket only says Expo has the message. Whether Apple and Google took it
// (wrong APNs key, FCM sender, a device gone) is in its receipt, ready about
// 15 minutes later and kept by Expo for a day.
const RECEIPT_AFTER_MS = 15 * 60_000;
const RECEIPT_KEPT_MS = 24 * 60 * 60_000;
export const PUSH_RECEIPTS_KEY = 'mobile-push:receipts';
const RECEIPTS_LOCK = 'mobile-push:receipts:lock';
const EXPO_TIMEOUT_MS = 10_000;

type Ticket = { status?: string; id?: string; message?: string; details?: { error?: string } };

/**
 * Push notifications for the Postra Mobile app (companion).
 * Tokens are Expo push tokens; sending goes through the Expo Push API (no key needed).
 * Best-effort by design — callers must never let a push failure break their flow.
 */
@Injectable()
export class MobilePushService {
  private readonly _logger = new Logger('MobilePush');

  constructor(private _pushToken: PrismaRepository<'mobilePushToken'>) {}

  async registerToken(
    userId: string,
    organizationId: string,
    token: string,
    platform: string
  ) {
    if (!token) {
      return undefined;
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
      return undefined;
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
    // Devices of people still in the organisation: a removed, disabled or
    // suspended member's phone kept getting every publication and failure.
    const tokens = await this._pushToken.model.mobilePushToken.findMany({
      where: {
        organizationId,
        user: {
          suspendedAt: null,
          organizations: { some: { organizationId, disabled: false } },
        },
      },
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

    for (let i = 0; i < messages.length; i += MESSAGES_PER_REQUEST) {
      await this.send(messages.slice(i, i + MESSAGES_PER_REQUEST));
    }
  }

  private async send(messages: { to: string }[]) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      // The whole request was refused: nothing reached any phone.
      const codes = (Array.isArray(json?.errors) ? json.errors : [])
        .map((e: any) => e?.code)
        .filter(Boolean)
        .join(', ');
      this._logger.warn(
        `Expo refused ${messages.length} push messages: HTTP ${res.status}${codes ? ` (${codes})` : ''}`
      );
      return;
    }
    const tickets: Ticket[] = Array.isArray(json?.data) ? json.data : [];
    const dead: string[] = [];
    const failed: Record<string, number> = {};
    const now = Date.now();
    const pending: (string | number)[] = [];
    tickets.forEach((ticket, i) => {
      const token = messages[i]?.to;
      if (ticket?.status === 'ok' && ticket.id && token) {
        pending.push(now, JSON.stringify({ id: ticket.id, token }));
      } else if (ticket?.status === 'error') {
        const code = ticket.details?.error || 'unknown';
        if (code === 'DeviceNotRegistered' && token) {
          dead.push(token);
        } else {
          failed[code] = (failed[code] || 0) + 1;
        }
      }
    });
    await this.forget(dead);
    this.warnFailures('push tickets', failed);
    if (pending.length) {
      // Best effort: a receipt queue that is down must not stop the next
      // batch from going out.
      try {
        await ioRedis.zadd(PUSH_RECEIPTS_KEY, ...pending);
      } catch {
        // the receipts of this batch go unread
      }
    }
  }

  /**
   * Reads the receipts of pushes sent at least 15 minutes ago: a device that
   * is gone loses its token, anything else (InvalidCredentials, a wrong FCM
   * sender, MessageTooBig) goes to the log, where it used to vanish. One
   * process at a time; called every minute.
   */
  async checkReceipts(now = Date.now()) {
    if ((await ioRedis.set(RECEIPTS_LOCK, '1', 'EX', 50, 'NX')) !== 'OK') {
      return;
    }
    try {
      await ioRedis.zremrangebyscore(PUSH_RECEIPTS_KEY, 0, now - RECEIPT_KEPT_MS);
      const due = await ioRedis.zrangebyscore(
        PUSH_RECEIPTS_KEY,
        0,
        now - RECEIPT_AFTER_MS,
        'LIMIT',
        0,
        RECEIPTS_PER_REQUEST
      );
      if (!due.length) {
        return;
      }
      const sent = due.map((raw) => JSON.parse(raw) as { id: string; token: string });
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: sent.map((s) => s.id) }),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Kept for the next minute.
        this._logger.warn(`Expo push receipts unavailable: HTTP ${res.status}`);
        return;
      }
      const json: any = await res.json().catch(() => null);
      const receipts: Record<string, Ticket> = json?.data || {};
      const dead: string[] = [];
      const failed: Record<string, number> = {};
      // Only receipts Expo has: one not ready yet is asked for again next
      // minute, until the day Expo keeps them is over.
      const read: string[] = [];
      sent.forEach(({ id, token }, i) => {
        const receipt = receipts[id];
        if (!receipt) {
          return;
        }
        read.push(due[i]);
        if (receipt.status !== 'error') {
          return;
        }
        const code = receipt.details?.error || 'unknown';
        if (code === 'DeviceNotRegistered') {
          dead.push(token);
        } else {
          failed[code] = (failed[code] || 0) + 1;
        }
      });
      await this.forget(dead);
      this.warnFailures('push receipts', failed);
      if (read.length) {
        await ioRedis.zrem(PUSH_RECEIPTS_KEY, ...read);
      }
    } finally {
      await ioRedis.del(RECEIPTS_LOCK).catch(() => undefined);
    }
  }

  private async forget(tokens: string[]) {
    if (tokens.length) {
      await this._pushToken.model.mobilePushToken.deleteMany({
        where: { token: { in: tokens } },
      });
    }
  }

  // Counts per error code, never the tokens.
  private warnFailures(what: string, failed: Record<string, number>) {
    const entries = Object.entries(failed);
    if (entries.length) {
      this._logger.warn(
        `Expo ${what} with errors: ${entries.map(([code, n]) => `${code} ×${n}`).join(', ')}`
      );
    }
  }
}
