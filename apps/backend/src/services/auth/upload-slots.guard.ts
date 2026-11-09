import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// upload-simple (and the other routes that take the file in the request)
// hold the whole body in memory: multer's memory storage, up to the 220 MB
// nginx lets through for Studio's video exports. A few accounts sending
// several such bodies at once could take the app instance down. A guard
// runs before the file interceptor, so a refused request is never read.
//
// Small bodies (a photo, a design export) pass freely; a large one needs a
// slot: two at a time per organisation, four on the instance.
//
// The backend runs as BACKEND_PROCESSES pm2 workers on the instance
// (ecosystem.config.cjs), each with its own memory, and a request reaches any
// of them. The instance's four are therefore split between the workers, and
// the organisation's two are held in Redis, which every worker shares:
// counted per worker, one organisation could hold two slots in each and
// leave no one else a slot on the instance.
export const SMALL_BODY_BYTES = 12 * 1024 * 1024;
export const SLOTS_PER_ORG = 2;
export const SLOTS_PER_INSTANCE = 4;
// Each organisation slot is a lease with its own end: one whose release
// never ran (the worker died mid-upload) ends on its own, far later than a
// 220 MB body takes to arrive, and refused attempts do not move it.
export const ORG_SLOT_LEASE_MS = 30 * 60 * 1000;

export const slotsPerWorker = () =>
  Math.max(
    1,
    Math.floor(
      SLOTS_PER_INSTANCE /
        Math.max(1, Number(process.env.BACKEND_PROCESSES) || 1)
    )
  );

const orgKey = (org: string) => `upload-slots:${org}`;

// One script, so two workers cannot both see the last free slot. The key is
// a sorted set of leases scored by when they end; ended ones are dropped
// before counting.
export const TAKE_ORG_SLOT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

let total = 0;
// Only when Redis cannot be reached: the organisation counted in this worker.
const localOrg = new Map<string, number>();

export const uploadSlotsInUse = () => ({ total });
// For tests: every slot of this worker free.
export const resetUploadSlots = () => {
  total = 0;
  localOrg.clear();
};

type OrgSlot = { release: () => void } | undefined;

const takeOrgSlot = async (org: string): Promise<OrgSlot> => {
  const lease = randomUUID();
  try {
    const now = Date.now();
    const taken = await ioRedis.eval(
      TAKE_ORG_SLOT,
      1,
      orgKey(org),
      String(now),
      String(now + ORG_SLOT_LEASE_MS),
      String(SLOTS_PER_ORG),
      lease,
      String(ORG_SLOT_LEASE_MS)
    );
    if (Number(taken) !== 1) return undefined;
    return {
      release: () => {
        ioRedis.zrem(orgKey(org), lease).catch((): undefined => undefined);
      },
    };
  } catch {
    const mine = localOrg.get(org) || 0;
    if (mine >= SLOTS_PER_ORG) return undefined;
    localOrg.set(org, mine + 1);
    return {
      release: () => {
        const left = (localOrg.get(org) || 1) - 1;
        if (left > 0) localOrg.set(org, left);
        else localOrg.delete(org);
      },
    };
  }
};

@Injectable()
export class UploadSlotsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const length = Number(request.headers?.['content-length']);
    // No length (a chunked body) counts as large.
    if (Number.isFinite(length) && length > 0 && length <= SMALL_BODY_BYTES) {
      return true;
    }
    const busy = () => {
      response.setHeader?.('Retry-After', '10');
      return new HttpException(
        'Another large upload is still in progress. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    };
    // The worker's share first, synchronously, so two requests in the same
    // tick cannot both take its last slot.
    if (total >= slotsPerWorker()) {
      throw busy();
    }
    total++;

    // Listening before the wait on Redis: a client that goes away during it
    // fires 'close' once, and a listener added afterwards would never run.
    const held: { slot?: OrgSlot } = {};
    let ended = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total = Math.max(0, total - 1);
      held.slot?.release();
    };
    const end = () => {
      ended = true;
      release();
    };
    // 'close' fires when the response ends or the client goes away.
    response.once?.('close', end);
    response.once?.('finish', end);

    const org: string = request.org?.id || 'unknown';
    const orgSlot = await takeOrgSlot(org);
    held.slot = orgSlot;
    if (!orgSlot) {
      release();
      throw busy();
    }
    if (ended) {
      // Gone while we waited: release() already ran without the lease.
      orgSlot.release();
      return false;
    }
    return true;
  }
}
